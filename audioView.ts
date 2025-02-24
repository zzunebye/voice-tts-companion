/* eslint-disable @typescript-eslint/no-inferrable-types */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import MyPlugin from './main';
import { PluginState } from 'enum';

export const VIEW_TYPE_AUDIO_CONTROL = 'my-audio-view';

export class AudioControlView extends ItemView {
    plugin: MyPlugin;
    currentDocId: string | null = null;
    progressBar: HTMLProgressElement | null = null;
    progressText: HTMLDivElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_AUDIO_CONTROL;
    }

    getDisplayText(): string {
        return 'Audio Controls';
    }

    updateForDocument(docId: string | null) {
        this.currentDocId = docId;
        this.updateControls();
    }

    calculateTotalProgress(docState: any): { totalDuration: number; currentPosition: number } {
        if (!docState || !docState.audioElements.length) {
            return { totalDuration: 0, currentPosition: 0 };
        }

        const totalDuration = docState.audioElements.reduce((sum: number, audio: HTMLAudioElement) => {
            return sum + (audio.duration || 0);
        }, 0);

        const currentPosition = docState.audioElements.slice(0, docState.currentIndex).reduce((sum: number, audio: HTMLAudioElement) => {
            return sum + (audio.duration || 0);
        }, 0) + (docState.audioElements[docState.currentIndex]?.currentTime || 0);

        return { totalDuration, currentPosition };
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('h4', { text: 'Audio Controls' });

        // Create progress bar
        this.progressBar = container.createEl('progress', {
            cls: 'audio-progress',
            attr: { value: '0', max: '100' }
        });
        
        this.progressText = container.createEl('div', { 
            text: '00:00 / 00:00',
            cls: 'audio-progress-text'
        });

        const rewindButton = container.createEl('button', { text: '<< 15s' });
        const playPauseButton = container.createEl('button', { text: 'Play', cls: 'play-pause' });
        const forwardButton = container.createEl('button', { text: '>> 15s' });
        const nextSentenceButton = container.createEl('button', { text: 'Next Sentence' });

        rewindButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (docState && docState.audioElements[docState.currentIndex]) {
                const audio = docState.audioElements[docState.currentIndex];
                audio.currentTime = Math.max(0, audio.currentTime - 15);
            }
        });

        playPauseButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState) return;

            if (docState.state === PluginState.Playing) {
                docState.audioElements[docState.currentIndex].pause();
                docState.state = PluginState.Paused;
            } else if (docState.state === PluginState.Paused || docState.state === PluginState.Idle) {
                if (docState.audioElements[docState.currentIndex]) {
                    docState.audioElements[docState.currentIndex].play();
                    docState.state = PluginState.Playing;
                }
            }
            this.plugin.documentStates.set(this.currentDocId!, docState);
            this.updatePlayPauseButton();
        });

        forwardButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (docState && docState.audioElements[docState.currentIndex]) {
                const audio = docState.audioElements[docState.currentIndex];
                audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
            }
        });

        nextSentenceButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState) return;

            if (docState.currentIndex < docState.audioElements.length - 1) {
                docState.audioElements[docState.currentIndex].pause();
                docState.currentIndex++;
                docState.audioElements[docState.currentIndex].play();
                docState.state = PluginState.Playing;
                this.plugin.documentStates.set(this.currentDocId!, docState);
                this.updatePlayPauseButton();
            }
        });

        // Update progress
        const updateProgress = () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState || !this.progressBar || !this.progressText) return;

            const { totalDuration, currentPosition } = this.calculateTotalProgress(docState);
            
            if (this.progressBar) {
                this.progressBar.max = totalDuration;
                this.progressBar.value = currentPosition;
            }
            
            this.progressText.setText(`${this.formatTime(currentPosition)} / ${this.formatTime(totalDuration)}`);
        };

        // Set up progress update interval
        const progressInterval = setInterval(updateProgress, 100);
        this.register(() => clearInterval(progressInterval));

        this.updateControls();
    }

    updateControls() {
        const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
        const playPauseButton = this.containerEl.querySelector('.play-pause') as HTMLButtonElement;
        if (!playPauseButton) return;

        if (!docState || docState.audioElements.length === 0) {
            playPauseButton.disabled = true;
            playPauseButton.textContent = 'Play';
            return;
        }

        playPauseButton.disabled = docState.state === PluginState.Generating;
        this.updatePlayPauseButton();
    }

    updatePlayPauseButton() {
        const playPauseButton = this.containerEl.querySelector('.play-pause') as HTMLButtonElement;
        if (!playPauseButton) return;

        const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
        if (!docState) {
            playPauseButton.textContent = 'Play';
            playPauseButton.disabled = true;
            return;
        }

        switch (docState.state) {
            case PluginState.Playing:
                playPauseButton.textContent = 'Pause';
                playPauseButton.disabled = false;
                break;
            case PluginState.Paused:
            case PluginState.Idle:
                playPauseButton.textContent = 'Play';
                playPauseButton.disabled = docState.audioElements.length === 0;
                break;
            case PluginState.Generating:
                playPauseButton.textContent = 'Generating...';
                playPauseButton.disabled = true;
                break;
        }
    }

    formatTime(seconds: number): string {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec < 10 ? '0' + sec : sec}`;
    }

    async onClose() {
        const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
        if (docState) {
            docState.audioElements.forEach(audio => audio.pause());
        }
    }
}