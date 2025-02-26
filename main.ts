import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { AudioControlView, VIEW_TYPE_AUDIO_CONTROL } from './audioView';
import { MyPluginSettings, DEFAULT_SETTINGS, MyPluginSettingTab } from './setting';
import { generateSpeech } from './api';
import './styles.css';
import { cleanSentence } from 'helpers';
import { PluginState } from 'enum';
import { TTSProvider } from 'tts-service';
import { AudioCache } from './audioCache';

interface DocumentState {
	state: PluginState;
	sentences: string[];
	audioElements: (HTMLAudioElement | null)[];
	currentIndex: number;
	isLoading: boolean;
}

export default class MyPlugin extends Plugin {
	currentState: PluginState = PluginState.Idle;
	settings: MyPluginSettings;
	documentStates: Map<string, DocumentState> = new Map();
	currentAudio: HTMLAudioElement | null = null;
	audioViewLeaf: WorkspaceLeaf | null = null;
	audioCache: AudioCache;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MyPluginSettingTab(this.app, this));
		
		// Initialize the audio cache
		this.audioCache = new AudioCache(this.app);
		
		// Configure the audio cache based on settings
		this.audioCache.setEnabled(this.settings.enablePersistentCache);
		this.audioCache.setMaxCacheSize(this.settings.maxCacheSize);
		this.audioCache.setMaxCacheAge(this.settings.maxCacheAgeDays * 24 * 60 * 60 * 1000);

		// Register the audio control view
		this.registerView(VIEW_TYPE_AUDIO_CONTROL, (leaf) => new AudioControlView(leaf, this));

		// Register event for active leaf changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				// Check if we're switching to our audio control view
				const viewType = leaf?.view?.getViewType();
				const isAudioControlView = viewType === VIEW_TYPE_AUDIO_CONTROL;
				
				// If we're switching to the audio control view, don't pause any audio
				if (isAudioControlView) {
					// Just update the audio control view
					this.updateAudioControlView();
					return;
				}
				
				// Get the current active document
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const currentDocId = activeView?.file?.path || null;
				
				// Pause any playing audio in documents that are not the current one
				this.documentStates.forEach((state, docId) => {
					if (docId !== currentDocId && state.state === PluginState.Playing) {
						// Pause the current audio
						const currentAudio = state.audioElements[state.currentIndex];
						if (currentAudio) {
							currentAudio.pause();
						}
						// Update the state
						state.state = PluginState.Paused;
						this.documentStates.set(docId, state);
					}
				});
				
				// Update the audio control view
				this.updateAudioControlView();
				
				// Add play buttons to the active view
				if (activeView) {
					this.addPlayButtonsToActiveView();
				}
			})
		);

		// Register event for file open
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					// Add play buttons to the active view when a file is opened
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (activeView) {
						this.addPlayButtonsToActiveView();
					}
				}
			})
		);

		// Register event for file close
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file) {
					const docId = file.path;
					// Remove from in-memory document states
					this.documentStates.delete(docId);
					// Also clean up the persistent cache for this document
					this.audioCache.clearDocumentEntries(docId);
					this.updateAudioControlView();
				}
			})
		);
		
		// Register event for view mode changes (switching between source and reading mode)
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file) {
					// Add play buttons to the active view
					this.addPlayButtonsToActiveView();
				}
			})
		);

		// Command for entire document
		this.addCommand({
			id: 'generate-speech-entire-document',
			name: 'Generate Speech for Entire Document',
			editorCallback: async (editor) => {
				const text = editor.getValue();
				await this.generateAndPlaySpeech(text);
			},
		});

		// Command for selected text
		this.addCommand({
			id: 'generate-speech-selection',
			name: 'Generate Speech for Selected Text',
			editorCheckCallback: (checking: boolean, editor) => {
				if (checking) {
					return !!editor.getSelection();
				}
				const text = editor.getSelection();
				if (text) {
					this.generateAndPlaySpeech(text);
				}
			},
		});

		// Command to start playback from cursor position
		this.addCommand({
			id: 'start-speech-from-cursor',
			name: 'Start Speech from Cursor Position',
			editorCallback: async (editor) => {
				await this.startSpeechFromCursor(editor);
			}
		});

		// Command to pause playback
		this.addCommand({
			id: 'pause-speech-playback',
			name: 'Pause Speech Playback',
			callback: () => {
				this.pauseAllPlayback();
			}
		});

		// Add ribbon icon for generating speech
		this.addRibbonIcon('volume-2', 'Generate Speech', () => {
			// Get the active Markdown view
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				// Retrieve the document text
				const editor = activeView.editor;
				const text = editor.getValue();

				// Check if the document is empty
				if (text.trim() === '') {
					new Notice('The document is empty.');
					return;
				}

				// Generate and play speech using the existing method
				this.generateAndPlaySpeech(text);
			} else {
				// Display notice if no Markdown file is open
				new Notice('Please open a Markdown file to generate speech.');
			}
		});

		// Add ribbon icon for pausing speech
		this.addRibbonIcon('pause', 'Pause Speech Playback', () => {
			this.pauseAllPlayback();
		});

		// Add context menu items
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle('Generate Speech for Entire Document')
						.setIcon('volume-2')
						.onClick(() => {
							const text = editor.getValue();
							this.generateAndPlaySpeech(text);
						});
				});

				if (editor.getSelection()) {
					menu.addItem((item) => {
						item
							.setTitle('Generate Speech for Selected Text')
							.setIcon('volume-2')
							.onClick(() => {
								const text = editor.getSelection();
								this.generateAndPlaySpeech(text);
							});
					});
				}

				menu.addItem((item) => {
					item
						.setTitle('Start Speech from Cursor Position')
						.setIcon('play-circle')
						.onClick(() => {
							const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (activeView) {
								// Call the method directly
								this.startSpeechFromCursor(editor);
							}
						});
				});
			})
		);
		
		// Add play buttons to the current active view if there is one
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			// Use setTimeout to ensure the view is fully rendered
			setTimeout(() => {
				this.addPlayButtonsToActiveView();
			}, 500);
		}
	}

	onunload() {
		// Pause and clean up all audio elements
		this.documentStates.forEach((state) => {
			state.audioElements.forEach((audio) => {
				if (audio) {
					audio.pause();
					// Revoke object URLs to prevent memory leaks
					URL.revokeObjectURL(audio.src);
				}
			});
		});

		// Clear the in-memory document states (but keep the persistent cache)
		this.documentStates.clear();

		// Clear any reading mode highlights
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.getMode() !== 'source') {
			this.clearReadingModeHighlights(activeView);
		}
		
		// Remove all play buttons
		document.querySelectorAll('.sentence-play-button').forEach(el => el.remove());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async generateAndPlaySpeech(text: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active Markdown view found.');
			return;
		}
		const docId = activeView.file.path;
		const currentDocState = this.documentStates.get(docId) || {
			state: PluginState.Idle,
			sentences: [],
			audioElements: [],
			currentIndex: 0,
			isLoading: false
		};

		if (currentDocState.state === PluginState.Generating || currentDocState.state === PluginState.Playing) {
			new Notice('Please wait for the current operation to finish.');
			return;
		}

		if (this.settings.ttsProvider === TTSProvider.ELEVEN_LABS && !this.settings.elevenLabsApiKey) {
			new Notice('Please set your ElevenLabs API key in the settings.');
			return;
		}

		if (this.settings.ttsProvider === TTSProvider.UNREAL_SPEECH && !this.settings.unrealSpeechApiKey) {
			new Notice('Please set your Unreal Speech API key in the settings.');
			return;
		}

		try {
			currentDocState.state = PluginState.Generating;
			this.documentStates.set(docId, currentDocState);
			new Notice('Preparing speech...');
			
			// Split text into sentences but don't generate audio for all of them yet
			const sentences = this.splitIntoSentences(text);
			
			// Initialize the document state with sentences and null audio elements
			currentDocState.sentences = sentences;
			currentDocState.audioElements = Array(sentences.length).fill(null);
			currentDocState.currentIndex = 0;
			currentDocState.state = PluginState.Idle;
			
			this.documentStates.set(docId, currentDocState);
			
			// Add play buttons to sentences
			this.addPlayButtonsToActiveView();
			
			// Start playing from the beginning
			this.playSentencesSequentially(docId);
			this.openAudioControlView();
		} catch (error) {
			new Notice(`Error preparing speech: ${error.message}`);
			currentDocState.state = PluginState.Idle;
			this.documentStates.set(docId, currentDocState);
		}
	}

	/**
	 * Generates speech for a specific paragraph and plays it.
	 * This function is called when a user clicks on a play button next to a paragraph.
	 * 
	 * @param paragraphText - The text content of the paragraph
	 * @returns Promise<void>
	 */
	async generateAndPlayParagraph(paragraphText: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active Markdown view found.');
			return;
		}
		
		const docId = activeView.file.path;
		let docState = this.documentStates.get(docId);
		
		// If there's already a document state and it's busy, don't interrupt
		if (docState && (docState.state === PluginState.Generating || docState.state === PluginState.Playing)) {
			new Notice('Please wait for the current operation to finish.');
			return;
		}
		
		// Check API keys
		if (this.settings.ttsProvider === TTSProvider.ELEVEN_LABS && !this.settings.elevenLabsApiKey) {
			new Notice('Please set your ElevenLabs API key in the settings.');
			return;
		}

		if (this.settings.ttsProvider === TTSProvider.UNREAL_SPEECH && !this.settings.unrealSpeechApiKey) {
			new Notice('Please set your Unreal Speech API key in the settings.');
			return;
		}
		
		try {
			// If no document state exists yet, create one
			if (!docState) {
				docState = {
					state: PluginState.Idle,
					sentences: [],
					audioElements: [],
					currentIndex: 0,
					isLoading: false
				};
			}
			
			// Set state to generating
			docState.state = PluginState.Generating;
			this.documentStates.set(docId, docState);
			new Notice('Preparing speech for paragraph...');
			
			// Split paragraph into sentences
			const paragraphSentences = this.splitIntoSentences(paragraphText);
			
			// If we already have sentences in the document state, we need to find where to insert these
			if (docState.sentences.length > 0) {
				// Find the first sentence of the paragraph in the existing sentences
				const firstSentence = paragraphSentences[0];
				let startIndex = -1;
				
				for (let i = 0; i < docState.sentences.length; i++) {
					if (docState.sentences[i].includes(firstSentence) || firstSentence.includes(docState.sentences[i])) {
						startIndex = i;
						break;
					}
				}
				
				// If we found the paragraph in the existing sentences, start playback from there
				if (startIndex >= 0) {
					docState.state = PluginState.Idle;
					this.documentStates.set(docId, docState);
					this.startPlaybackFromIndex(docId, startIndex);
					return;
				}
				
				// If we didn't find the paragraph, append it to the existing sentences
				const currentLength = docState.sentences.length;
				docState.sentences = [...docState.sentences, ...paragraphSentences];
				docState.audioElements = [...docState.audioElements, ...Array(paragraphSentences.length).fill(null)];
				docState.currentIndex = currentLength; // Start from the first sentence of the new paragraph
			} else {
				// If no sentences exist yet, just use the paragraph sentences
				docState.sentences = paragraphSentences;
				docState.audioElements = Array(paragraphSentences.length).fill(null);
				docState.currentIndex = 0;
			}
			
			// Set state back to idle before starting playback
			docState.state = PluginState.Idle;
			this.documentStates.set(docId, docState);
			
			// Open the audio control view
			this.openAudioControlView();
			
			// Start playing from the current index
			this.playSentencesSequentially(docId);
		} catch (error) {
			new Notice(`Error preparing speech: ${error.message}`);
			if (docState) {
				docState.state = PluginState.Idle;
				this.documentStates.set(docId, docState);
			}
		}
	}

	/**
	 * Generates speech from the provided text and plays it back.
	 * 
	 * This function checks for an active Markdown view and the document ID,
	 * verifies the current state, and ensures the API key is set. It then
	 * generates audio blobs for each sentence using the ElevenLabs API,
	 * updates the document state, and starts playback sequentially.
	 * 
	 * Errors during the process are caught and notified to the user.
	 */
	splitIntoSentences(text: string): string[] {
		// Simple sentence splitting; improve as needed
		const sentences = text.match(/[^.!?*]+[.!?]+/g) || [text];
		return sentences.map(cleanSentence);
	}

	findSentencePosition(text: string, sentence: string): { start: number; end: number } | null {
		const cleanedSentence = cleanSentence(sentence);
		const startPos = text.indexOf(cleanedSentence);
		if (startPos === -1) return null;
		return {
			start: startPos,
			end: startPos + cleanedSentence.length
		};
	}

	highlightCurrentSentence(docId: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const docState = this.documentStates.get(docId);

		if (!activeView || !docState || docState.currentIndex >= docState.audioElements.length) {
			return;
		}

		// Get the current sentence
		const currentSentence = docState.sentences[docState.currentIndex];
		if (!currentSentence) return;

		// Check if we're in editing mode or reading mode
		if (activeView.getMode() === 'source') {
			// Editing mode - use the editor selection method
			const editor = activeView.editor;
			const text = editor.getValue();
			const position = this.findSentencePosition(text, currentSentence);
			if (!position) return;

			const startPos = editor.offsetToPos(position.start);
			const endPos = editor.offsetToPos(position.end);

			editor.setSelection(startPos, endPos);
			editor.scrollIntoView({ from: startPos, to: endPos }, true);
			
			// Make sure play buttons are added
			this.addPlayButtonsToSourceMode(activeView);
		} else {
			// Reading mode - use DOM manipulation to highlight the text
			this.highlightSentenceInReadingMode(activeView, currentSentence);
			
			// Make sure play buttons are added
			this.addPlayButtonsToReadingMode(activeView);
		}
	}

	highlightSentenceInReadingMode(view: MarkdownView, sentence: string) {
		// Get the preview mode content
		const previewEl = view.previewMode.containerEl.querySelector('.markdown-preview-view');
		if (!previewEl) return;

		// First, remove any existing highlights
		const existingHighlights = previewEl.querySelectorAll('.sentence-highlight');
		existingHighlights.forEach(el => {
			const parent = el.parentNode;
			if (parent) {
				// Replace the highlight span with its text content
				parent.replaceChild(document.createTextNode(el.textContent || ''), el);
				// Normalize to merge adjacent text nodes
				parent.normalize();
			}
		});

		// Clean the sentence for better matching
		const cleanedSentence = cleanSentence(sentence);
		if (!cleanedSentence) return;

		// Find text nodes that contain the sentence
		const walker = document.createTreeWalker(
			previewEl,
			NodeFilter.SHOW_TEXT,
			null
		);

		let node;
		let found = false;

		while ((node = walker.nextNode()) && !found) {
			const textContent = node.textContent || '';
			const index = textContent.indexOf(cleanedSentence);
			
			if (index !== -1) {
				// Split the text node into three parts: before, highlight, after
				const beforeText = textContent.substring(0, index);
				const highlightText = textContent.substring(index, index + cleanedSentence.length);
				const afterText = textContent.substring(index + cleanedSentence.length);
				
				const parentNode = node.parentNode;
				if (!parentNode) continue;
				
				// Create text node for content before the sentence
				if (beforeText) {
					parentNode.insertBefore(document.createTextNode(beforeText), node);
				}
				
				// Create highlighted span for the sentence
				const highlightSpan = document.createElement('span');
				highlightSpan.className = 'sentence-highlight';
				highlightSpan.textContent = highlightText;
				highlightSpan.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
				highlightSpan.style.borderRadius = '3px';
				parentNode.insertBefore(highlightSpan, node);
				
				// Create text node for content after the sentence
				if (afterText) {
					parentNode.insertBefore(document.createTextNode(afterText), node);
				}
				
				// Remove the original text node
				parentNode.removeChild(node);
				
				// Scroll the highlighted element into view
				highlightSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
				
				found = true;
			}
		}
	}

	// Add play buttons to all sentences in reading mode
	addPlayButtonsToReadingMode(view: MarkdownView) {
		const previewEl = view.previewMode.containerEl.querySelector('.markdown-preview-view');
		if (!previewEl) return;
		
		// Remove any existing play buttons
		const existingButtons = previewEl.querySelectorAll('.sentence-play-button');
		existingButtons.forEach(el => el.remove());
		
		// Get the document ID
		const docId = view.file?.path;
		if (!docId) return;
		
		// Find all paragraphs, list items, and headings
		const textElements = previewEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
		
		// Get the document state if it exists
		const docState = this.documentStates.get(docId);
		
		textElements.forEach(element => {
			// Get the text content
			const text = element.textContent || '';
			if (!text.trim()) return; // Skip empty elements
			
			// Create play button
			const playButton = document.createElement('button');
			playButton.className = 'sentence-play-button';
			playButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
			playButton.setAttribute('aria-label', 'Play this paragraph');
			
			// If we have a document state with sentences, try to find the first sentence index
			if (docState && docState.sentences.length > 0) {
				// Find the first sentence in this element
				let firstSentenceIndex = -1;
				
				for (let i = 0; i < docState.sentences.length; i++) {
					const sentence = docState.sentences[i];
					const cleanedSentence = cleanSentence(sentence);
					
					if (cleanedSentence && text.includes(cleanedSentence)) {
						firstSentenceIndex = i;
						break;
					}
				}
				
				// If we found a sentence, set the index and use startPlaybackFromIndex
				if (firstSentenceIndex !== -1) {
					playButton.setAttribute('data-sentence-index', firstSentenceIndex.toString());
					playButton.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.startPlaybackFromIndex(docId, firstSentenceIndex);
					};
				} else {
					// If no sentence found, generate speech for this paragraph
					playButton.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.generateAndPlayParagraph(text);
					};
				}
			} else {
				// If no document state or no sentences, generate speech for this paragraph
				playButton.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.generateAndPlayParagraph(text);
				};
			}
			
			// Add the button directly to the paragraph element
			element.appendChild(playButton);
		});
	}

	// Add play buttons to sentences in source mode
	addPlayButtonsToSourceMode(view: MarkdownView) {
		const editor = view.editor;
		const docId = view.file?.path;
		if (!docId) return;
		
		// Get the editor container
		const editorContainer = view.containerEl.querySelector('.cm-editor');
		if (!editorContainer) return;
		
		// Remove any existing play buttons
		const existingButtons = editorContainer.querySelectorAll('.sentence-play-button');
		existingButtons.forEach(el => el.remove());
		
		// Get the text content
		const text = editor.getValue();
		
		// Get the document state if it exists
		const docState = this.documentStates.get(docId);
		
		// Find paragraphs in the text (separated by empty lines)
		const paragraphs = text.split(/\n\s*\n/);
		let offset = 0;
		
		paragraphs.forEach(paragraph => {
			if (!paragraph.trim()) {
				// Update offset for empty paragraphs
				offset += paragraph.length + 2; // +2 for the newlines
				return;
			}
			
			// Calculate the absolute position in the document for the start of the paragraph
			const absoluteOffset = offset;
			const startPos = editor.offsetToPos(absoluteOffset);
			
			// Find the line element in the DOM
			const lineElement = editorContainer.querySelector(`.cm-line:nth-child(${startPos.line + 1})`);
			if (!lineElement) {
				offset += paragraph.length + 2; // +2 for the newlines
				return;
			}
			
			// Create play button
			const playButton = document.createElement('button');
			playButton.className = 'sentence-play-button';
			playButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
			playButton.setAttribute('aria-label', 'Play this paragraph');
			
			// If we have a document state with sentences, try to find the first sentence index
			if (docState && docState.sentences.length > 0) {
				// Find the first sentence in this paragraph
				let firstSentenceIndex = -1;
				
				for (let i = 0; i < docState.sentences.length; i++) {
					const sentence = docState.sentences[i];
					const cleanedSentence = cleanSentence(sentence);
					
					if (cleanedSentence && paragraph.includes(cleanedSentence)) {
						firstSentenceIndex = i;
						break;
					}
				}
				
				// If we found a sentence, set the index and use startPlaybackFromIndex
				if (firstSentenceIndex !== -1) {
					playButton.setAttribute('data-sentence-index', firstSentenceIndex.toString());
					playButton.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.startPlaybackFromIndex(docId, firstSentenceIndex);
					};
				} else {
					// If no sentence found, generate speech for this paragraph
					playButton.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.generateAndPlayParagraph(paragraph);
					};
				}
			} else {
				// If no document state or no sentences, generate speech for this paragraph
				playButton.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.generateAndPlayParagraph(paragraph);
				};
			}
			
			// Add the button to the line element
			lineElement.appendChild(playButton);
			
			// Update offset for the next paragraph
			offset += paragraph.length + 2; // +2 for the newlines
		});
	}

	// Add play buttons to the active view
	addPlayButtonsToActiveView() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;
		
		// Check if we're in editing mode or reading mode
		if (activeView.getMode() === 'source') {
			this.addPlayButtonsToSourceMode(activeView);
		} else {
			this.addPlayButtonsToReadingMode(activeView);
		}
	}

	playSentencesSequentially(docId: string) {
		const docState = this.documentStates.get(docId);
		if (!docState || docState.state !== PluginState.Idle) {
			return;
		}

		docState.state = PluginState.Playing;
		this.documentStates.set(docId, docState);
		
		// Highlight the current sentence before starting playback
		this.highlightCurrentSentence(docId);
		
		// Start playing from the current index
		this.playNextSentence(docId);
	}

	openAudioControlView() {
		if (!this.audioViewLeaf) {
			this.audioViewLeaf = this.app.workspace.getRightLeaf(false);
			if (this.audioViewLeaf) {
				this.audioViewLeaf.setViewState({ type: VIEW_TYPE_AUDIO_CONTROL });
			}
		}
		if (this.audioViewLeaf) {
			this.app.workspace.revealLeaf(this.audioViewLeaf);
		}
		this.updateAudioControlView();
	}

	updateAudioControlView() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const docId = activeView?.file?.path || null;
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_AUDIO_CONTROL)[0]?.view as AudioControlView;
		if (view && docId) {
			view.updateForDocument(docId);
		}
	}

	// Load audio for a specific sentence
	async loadAudioForSentence(docId: string, index: number): Promise<HTMLAudioElement | null> {
		const docState = this.documentStates.get(docId);
		if (!docState || index >= docState.sentences.length) {
			return null;
		}

		// If audio is already loaded in memory, return it
		if (docState.audioElements[index]) {
			return docState.audioElements[index];
		}

		try {
			const sentence = docState.sentences[index];
			let audioBlob: Blob;
			
			// Check if persistent cache is enabled and the audio is in the cache
			if (this.settings.enablePersistentCache && this.audioCache.hasAudio(sentence, docId)) {
				// Use the cached audio blob
				const cachedBlob = this.audioCache.getAudio(sentence, docId);
				if (cachedBlob) {
					audioBlob = cachedBlob;
				} else {
					// Generate speech for this sentence
					audioBlob = await generateSpeech(sentence, this.settings.ttsProvider, this.settings);
					
					// Store in persistent cache if enabled
					if (this.settings.enablePersistentCache) {
						await this.audioCache.storeAudio(sentence, docId, audioBlob);
					}
				}
			} else {
				// Generate speech for this sentence
				audioBlob = await generateSpeech(sentence, this.settings.ttsProvider, this.settings);
				
				// Store in persistent cache if enabled
				if (this.settings.enablePersistentCache) {
					await this.audioCache.storeAudio(sentence, docId, audioBlob);
				}
			}
			
			// Create audio element
			const audio = new Audio(URL.createObjectURL(audioBlob));
			
			// Store in document state (in-memory cache)
			docState.audioElements[index] = audio;
			this.documentStates.set(docId, docState);
			
			return audio;
		} catch (error) {
			console.error(`Error loading audio for sentence ${index}:`, error);
			return null;
		}
	}

	// Preload the next few sentences in the background
	async preloadUpcomingSentences(docId: string, currentIndex: number, count = 1) {
		const docState = this.documentStates.get(docId);
		if (!docState) return;

		// Preload the next 'count' sentences
		for (let i = 1; i <= count; i++) {
			const nextIndex = currentIndex + i;
			if (nextIndex < docState.sentences.length && !docState.audioElements[nextIndex]) {
				this.loadAudioForSentence(docId, nextIndex).catch(err => 
					console.error(`Error preloading sentence ${nextIndex}:`, err)
				);
			}
		}
	}

	async playNextSentence(docId: string) {
		const docState = this.documentStates.get(docId);
		if (!docState || docState.state !== PluginState.Playing) {
			return;
		}

		const index = docState.currentIndex;
		
		// Check if we've reached the end
		if (index >= docState.sentences.length) {
			docState.state = PluginState.Idle;
			this.documentStates.set(docId, docState);
			this.updateAudioControlView();
			
			// Clear selection/highlighting when finished
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				if (activeView.getMode() === 'source') {
					// Clear selection in editing mode
					activeView.editor.setSelection(activeView.editor.getCursor());
				} else {
					// Clear highlighting in reading mode
					this.clearReadingModeHighlights(activeView);
				}
			}
			return;
		}

		// Show loading indicator if needed
		if (!docState.audioElements[index]) {
			docState.isLoading = true;
			this.documentStates.set(docId, docState);
			this.updateAudioControlView();
			new Notice(`Loading sentence ${index + 1}/${docState.sentences.length}...`);
		}

		// Load the audio for the current sentence
		const audio = await this.loadAudioForSentence(docId, index);
		
		// Hide loading indicator
		docState.isLoading = false;
		this.documentStates.set(docId, docState);
		this.updateAudioControlView();

		if (!audio) {
			// Skip to next sentence if audio couldn't be loaded
			docState.currentIndex++;
			this.documentStates.set(docId, docState);
			this.playNextSentence(docId);
			return;
		}

		// Preload the next few sentences in the background
		this.preloadUpcomingSentences(docId, index);

		// Set up event handlers
		audio.ontimeupdate = () => {
			this.highlightCurrentSentence(docId);
		};

		// Play the audio
		audio.play();
		this.highlightCurrentSentence(docId);

		// When audio finishes, move to the next sentence
		audio.onended = () => {
			docState.currentIndex++;
			this.documentStates.set(docId, docState);
			this.playNextSentence(docId);
		};
	}

	// Helper method to clear reading mode highlights
	clearReadingModeHighlights(view: MarkdownView) {
		const previewEl = view.previewMode.containerEl.querySelector('.markdown-preview-view');
		if (!previewEl) return;

		const existingHighlights = previewEl.querySelectorAll('.sentence-highlight');
		existingHighlights.forEach(el => {
			const parent = el.parentNode;
			if (parent) {
				// Replace the highlight span with its text content
				parent.replaceChild(document.createTextNode(el.textContent || ''), el);
				// Normalize to merge adjacent text nodes
				parent.normalize();
			}
		});
	}

	// Start playback from a specific sentence index
	startPlaybackFromIndex(docId: string, index: number) {
		const docState = this.documentStates.get(docId);
		if (!docState || index >= docState.sentences.length) {
			return;
		}

		// Pause any currently playing audio
		if (docState.state === PluginState.Playing) {
			const currentAudio = docState.audioElements[docState.currentIndex];
			if (currentAudio) {
				currentAudio.pause();
			}
		}

		// Set the new index
		docState.currentIndex = index;
		docState.state = PluginState.Idle;
		this.documentStates.set(docId, docState);

		// Highlight the current sentence before starting playback
		this.highlightCurrentSentence(docId);

		// Start playing from this index
		this.playSentencesSequentially(docId);
	}

	// Helper method to start speech from cursor position
	async startSpeechFromCursor(editor: any) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active Markdown view found.');
			return;
		}
		
		const docId = activeView.file.path;
		const docState = this.documentStates.get(docId);
		
		// If no speech has been generated yet, generate it for the entire document
		if (!docState || docState.sentences.length === 0) {
			const text = editor.getValue();
			await this.generateAndPlaySpeech(text);
			return;
		}
		
		// Find the sentence that contains the cursor
		const cursorPos = editor.getCursor();
		const cursorOffset = editor.posToOffset(cursorPos);
		const text = editor.getValue();
		
		// Find which sentence contains the cursor
		let sentenceIndex = 0;
		
		for (let i = 0; i < docState.sentences.length; i++) {
			const sentence = docState.sentences[i];
			const position = this.findSentencePosition(text, sentence);
			
			if (position && cursorOffset >= position.start && cursorOffset <= position.end) {
				sentenceIndex = i;
				break;
			}
			
			if (position && position.start > cursorOffset) {
				break;
			}
			
			sentenceIndex = i;
		}
		
		// Start playback from this sentence
		this.startPlaybackFromIndex(docId, sentenceIndex);
		new Notice(`Starting playback from sentence ${sentenceIndex + 1}`);
	}

	pauseAllPlayback() {
		let pausedAny = false;
		
		this.documentStates.forEach((state, docId) => {
			if (state.state === PluginState.Playing) {
				// Pause the current audio
				const currentAudio = state.audioElements[state.currentIndex];
				if (currentAudio) {
					currentAudio.pause();
				}
				
				// Update the state
				state.state = PluginState.Paused;
				this.documentStates.set(docId, state);
				pausedAny = true;
				
				// Keep the current sentence highlighted when paused
				this.highlightCurrentSentence(docId);
			}
		});
		
		if (pausedAny) {
			new Notice('Playback paused');
		}
		
		this.updateAudioControlView();
	}

	// Refresh the cache statistics
	refreshCacheStats(): { size: string; count: number } {
		return {
			size: this.audioCache.getFormattedSize(),
			count: this.audioCache.getEntryCount()
		};
	}
}