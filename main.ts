import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { AudioControlView, VIEW_TYPE_AUDIO_CONTROL } from './audioView';
import { MyPluginSettings, DEFAULT_SETTINGS, MyPluginSettingTab } from './setting';
import { generateSpeechForSentences } from './api';
import './styles.css';
import { cleanSentence } from 'helpers';
import { PluginState } from 'enum';

export default class MyPlugin extends Plugin {
	currentState: PluginState = PluginState.Idle;
	settings: MyPluginSettings;
	currentAudio: HTMLAudioElement | null = null;
	audioViewLeaf: WorkspaceLeaf | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MyPluginSettingTab(this.app, this));

		// Register the audio control view
		this.registerView(VIEW_TYPE_AUDIO_CONTROL, (leaf) => new AudioControlView(leaf, this));

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

	// async generateAndPlaySpeech(text: string) {
	// 	if (!this.settings.apiKey) {
	// 		new Notice('Please set your ElevenLabs API key in the settings.');
	// 		return;
	// 	}

	// 	try {
	// 		new Notice('Generating speech...');
	// 		const audioBlob = await generateSpeech(text, this.settings.apiKey);
	// 		const url = URL.createObjectURL(audioBlob);

	// 		if (this.currentAudio) {
	// 			this.currentAudio.pause();
	// 			URL.revokeObjectURL(this.currentAudio.src); // Clean up previous URL
	// 		}

	// 		this.currentAudio = new Audio(url);
	// 		this.currentAudio.play();
	// 		this.openAudioControlView();
	// 	} catch (error) {
	// 		new Notice(`Error generating speech: ${error.message}`);
	// 	}
	// }

	// openAudioControlView() {
	// 	if (!this.audioViewLeaf) {
	// 		this.audioViewLeaf = this.app.workspace.getRightLeaf(false);
	// 		this.audioViewLeaf.setViewState({ type: VIEW_TYPE_AUDIO_CONTROL });
	// 	}
	// 	this.app.workspace.revealLeaf(this.audioViewLeaf);
	// }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		if (this.currentAudio) {
			this.currentAudio.pause();
			URL.revokeObjectURL(this.currentAudio.src);
		}
	}

	async generateAndPlaySpeech(text: string) {
		if (this.currentState === PluginState.Generating || this.currentState === PluginState.Playing) {
			new Notice('Please wait for the current operation to finish.');
			return;
		}

		if (!this.settings.apiKey) {
			new Notice('Please set your ElevenLabs API key in the settings.');
			return;
		}

		try {
			this.currentState = PluginState.Generating;
			new Notice('Generating speech...');
			const sentences = this.splitIntoSentences(text);
			const audioBlobs = await generateSpeechForSentences(sentences, this.settings.apiKey);
			this.currentState = PluginState.Idle; // Generation complete

			const audioElements = audioBlobs.map((blob) => new Audio(URL.createObjectURL(blob)));
			this.playSentencesSequentially(audioElements);
			this.openAudioControlView(audioElements);
		} catch (error) {
			new Notice(`Error generating speech: ${error.message}`);
			this.currentState = PluginState.Idle;
		}
	}

	splitIntoSentences(text: string): string[] {
		// Simple sentence splitting; improve as needed
		const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
		return sentences.map(cleanSentence);
	}

	playSentencesSequentially(audioElements: HTMLAudioElement[]) {
		if (this.currentState !== PluginState.Idle) {
			return; // Only play if idle
		}
		this.currentState = PluginState.Playing;
		let index = 0;

		const playNext = () => {
			if (index < audioElements.length) {
				const audio = audioElements[index];
				audio.play();
				audio.onended = () => {
					index++;
					if (index < audioElements.length) {
						playNext();
					} else {
						this.currentState = PluginState.Idle;
					}
				};
			} else {
				this.currentState = PluginState.Idle;
			}
		};

		playNext();
	}
	openAudioControlView(audioElements: HTMLAudioElement[]) {
		if (!this.audioViewLeaf) {
			this.audioViewLeaf = this.app.workspace.getRightLeaf(false);
			this.audioViewLeaf.setViewState({ type: VIEW_TYPE_AUDIO_CONTROL });
		}
		this.app.workspace.revealLeaf(this.audioViewLeaf);

		// Update the view with the new audio elements
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_AUDIO_CONTROL)[0].view as AudioControlView;
		view.setAudioElements(audioElements);
	}





}