import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { AudioControlView, VIEW_TYPE_AUDIO_CONTROL } from './audioView';
import { MyPluginSettings, DEFAULT_SETTINGS, MyPluginSettingTab } from './setting';
import { generateSpeechForSentences } from './api';
import './styles.css';
import { cleanSentence } from 'helpers';
import { PluginState } from 'enum';
import { TTSProvider } from 'tts-service';

interface DocumentState {
	state: PluginState;
	audioElements: HTMLAudioElement[];
	currentIndex: number;
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
			this.app.workspace.on('active-leaf-change', () => {
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
			})
		);
	}

	onunload() {
		this.documentStates.forEach((state) => {
			state.audioElements.forEach((audio) => {
				audio.pause();
				URL.revokeObjectURL(audio.src);
			});
		});
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
			audioElements: [],
			currentIndex: 0
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
			new Notice('Generating speech...');
			const sentences = this.splitIntoSentences(text);
			const audioBlobs = await generateSpeechForSentences(sentences, this.settings.ttsProvider, this.settings);
			currentDocState.state = PluginState.Idle;
			currentDocState.audioElements = audioBlobs.map((blob) => new Audio(URL.createObjectURL(blob)));
			currentDocState.currentIndex = 0;
			this.documentStates.set(docId, currentDocState);
			this.playSentencesSequentially(docId);
			this.openAudioControlView();
		} catch (error) {
			new Notice(`Error generating speech: ${error.message}`);
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

		const editor = activeView.editor;
		const text = editor.getValue();
		const sentences = this.splitIntoSentences(text);
		const currentSentence = sentences[docState.currentIndex];

		if (!currentSentence) return;

		const position = this.findSentencePosition(text, currentSentence);
		if (!position) return;

		const startPos = editor.offsetToPos(position.start);
		const endPos = editor.offsetToPos(position.end);

		editor.setSelection(startPos, endPos);
		editor.scrollIntoView({ from: startPos, to: endPos }, true);
	}

	playSentencesSequentially(docId: string) {
		const docState = this.documentStates.get(docId);
		if (!docState || docState.state !== PluginState.Idle) {
			return;
		}

		docState.state = PluginState.Playing;
		this.documentStates.set(docId, docState);
		let index = docState.currentIndex;

		const playNext = () => {
			if (index < docState.audioElements.length) {
				const audio = docState.audioElements[index];

				// Set up timeupdate event for continuous highlighting
				audio.ontimeupdate = () => {
					this.highlightCurrentSentence(docId);
				};

				audio.play();
				this.highlightCurrentSentence(docId);

				audio.onended = () => {
					index++;
					docState.currentIndex = index;
					this.documentStates.set(docId, docState);
					if (index < docState.audioElements.length) {
						playNext();
					} else {
						docState.state = PluginState.Idle;
						this.documentStates.set(docId, docState);
						this.updateAudioControlView();

						// Clear selection when finished
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (activeView) {
							activeView.editor.setSelection(activeView.editor.getCursor());
						}
					}
				};
			}
		};

		playNext();
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
}