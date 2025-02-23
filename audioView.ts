/* eslint-disable @typescript-eslint/no-inferrable-types */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import MyPlugin from './main';
import { PluginState } from 'enum';

export const VIEW_TYPE_AUDIO_CONTROL = 'my-audio-view';

export class AudioControlView extends ItemView {
    getViewType(): string {
        return VIEW_TYPE_AUDIO_CONTROL;
    }
    getDisplayText(): string {
        return 'Audio Controls';
    }
    plugin: MyPlugin;
    audioElements: HTMLAudioElement[] = [];
    currentIndex: number = 0;

    constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    setAudioElements(audioElements: HTMLAudioElement[]) {
        this.audioElements = audioElements;
        this.currentIndex = 0;

        // Attach event listeners to audio elements
        this.audioElements.forEach((audio, index) => {
            audio.addEventListener('play', () => {
                if (index === this.currentIndex) {
                    this.plugin.currentState = PluginState.Playing;
                    this.updatePlayPauseButton();
                }
            });
            audio.addEventListener('pause', () => {
                if (index === this.currentIndex) {
                    this.plugin.currentState = PluginState.Paused;
                    this.updatePlayPauseButton();
                }
            });
            audio.addEventListener('ended', () => {
                if (this.currentIndex < this.audioElements.length - 1) {
                    this.currentIndex++;
                    this.audioElements[this.currentIndex].play();
                } else {
                    this.plugin.currentState = PluginState.Idle;
                    this.updatePlayPauseButton();
                }
            });
        });

        this.updatePlayPauseButton(); // Ensure the button reflects the initial state
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('h4', { text: 'Audio Controls' });

        const rewindButton = container.createEl('button', { text: '<< 15s' });
        const playPauseButton = container.createEl('button', { text: 'Play' });
        const forwardButton = container.createEl('button', { text: '>> 15s' });
        const nextSentenceButton = container.createEl('button', { text: 'Next Sentence' });

        // Optional: Progress bar
        const progress = container.createEl('div', { text: '00:00 / 00:00' });

        // Add event listeners
        rewindButton.addEventListener('click', () => {
            if (this.audioElements[this.currentIndex]) {
                this.audioElements[this.currentIndex].currentTime = Math.max(0, this.audioElements[this.currentIndex].currentTime - 15);
            }
        });
        playPauseButton.addEventListener('click', () => {
            if (this.plugin.currentState === PluginState.Playing) {
                this.audioElements[this.currentIndex].pause();
                this.plugin.currentState = PluginState.Paused;
                this.updatePlayPauseButton();
            } else if (this.plugin.currentState === PluginState.Paused || this.plugin.currentState === PluginState.Idle) {
                if (this.audioElements[this.currentIndex]) {
                    this.audioElements[this.currentIndex].play();
                    this.plugin.currentState = PluginState.Playing;
                    this.updatePlayPauseButton();
                }
            }
        });

        this.updatePlayPauseButton();

        forwardButton.addEventListener('click', () => {
            if (this.audioElements[this.currentIndex]) {
                this.audioElements[this.currentIndex].currentTime = Math.min(
                    this.audioElements[this.currentIndex].duration,
                    this.audioElements[this.currentIndex].currentTime + 15
                );
            }
        });

        nextSentenceButton.addEventListener('click', () => {
            if (this.currentIndex < this.audioElements.length - 1) {
                this.audioElements[this.currentIndex].pause();
                this.currentIndex++;
                this.audioElements[this.currentIndex].play();
                this.plugin.currentState = PluginState.Playing;
                this.updatePlayPauseButton();
            }
        });

        // Update progress
        if (this.audioElements.length > 0) {
            this.audioElements.forEach((audio) => {
                audio.addEventListener('timeupdate', () => {
                    if (audio === this.audioElements[this.currentIndex]) {
                        const current = this.formatTime(audio.currentTime);
                        const duration = this.formatTime(audio.duration);
                        progress.setText(`${current} / ${duration}`);
                    }
                });
                audio.addEventListener('ended', () => {
                    if (this.currentIndex < this.audioElements.length - 1) {
                        this.currentIndex++;
                        this.audioElements[this.currentIndex].play();
                    } else {
                        playPauseButton.setText('Play');
                    }
                });
            });
        }


    }

    updateControls() {
        // Logic to update controls based on current state
    }

    formatTime(seconds: number): string {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec < 10 ? '0' + sec : sec}`;
    }
    updatePlayPauseButton() {
        const playPauseButton = this.containerEl.querySelector('button.play-pause') as HTMLButtonElement;
        if (playPauseButton) {
            switch (this.plugin.currentState) {
                case PluginState.Playing:
                    playPauseButton.textContent = 'Pause';
                    playPauseButton.disabled = false;
                    break;
                case PluginState.Paused:
                case PluginState.Idle:
                    playPauseButton.textContent = 'Play';
                    playPauseButton.disabled = false;
                    break;
                case PluginState.Generating:
                    playPauseButton.textContent = 'Generating...';
                    playPauseButton.disabled = true;
                    break;
            }
        }
    }


    async onClose() {
        this.audioElements.forEach((audio) => audio.pause());
    }

}