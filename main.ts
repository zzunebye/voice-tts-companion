import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { AudioControlView, VIEW_TYPE_AUDIO_CONTROL } from './audioView';
import { MyPluginSettings, DEFAULT_SETTINGS, MyPluginSettingTab } from './setting';
import { generateSpeech } from './api';
import './styles.css';
import { cleanSentence } from 'helpers';
import { PluginState } from 'enum';
import { TTSProvider } from 'tts-service';

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

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MyPluginSettingTab(this.app, this));

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
			})
		);

		// Register event for file close
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file) {
					const docId = file.path;
					this.documentStates.delete(docId);
					this.updateAudioControlView();
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
	}

	onunload() {
		// Pause and clean up all audio elements
		this.documentStates.forEach((state) => {
			state.audioElements.forEach((audio) => {
				audio?.pause();
				URL.revokeObjectURL(audio?.src || '');
			});
		});

		// Clear any reading mode highlights
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.getMode() !== 'source') {
			this.clearReadingModeHighlights(activeView);
		}
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
		} else {
			// Reading mode - use DOM manipulation to highlight the text
			this.highlightSentenceInReadingMode(activeView, currentSentence);
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

		// If audio is already loaded, return it
		if (docState.audioElements[index]) {
			return docState.audioElements[index];
		}

		try {
			// Generate speech for this sentence
			const sentence = docState.sentences[index];
			const audioBlob = await generateSpeech(sentence, this.settings.ttsProvider, this.settings);
			
			// Create audio element
			const audio = new Audio(URL.createObjectURL(audioBlob));
			
			// Store in document state
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
}