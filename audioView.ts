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
    statusText: HTMLDivElement | null = null;

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

        // Calculate total duration of loaded audio elements
        const totalDuration = docState.audioElements.reduce((sum: number, audio: HTMLAudioElement | null) => {
            return sum + (audio?.duration || 0);
        }, 0);

        // Calculate current position
        let currentPosition = 0;
        
        // If playback is complete, set position to total duration
        if (docState.currentIndex >= docState.sentences.length) {
            currentPosition = totalDuration;
        } else {
            // Otherwise calculate based on current index
            for (let i = 0; i < docState.currentIndex; i++) {
                currentPosition += docState.audioElements[i]?.duration || 0;
            }
            currentPosition += docState.audioElements[docState.currentIndex]?.currentTime || 0;
        }

        return { totalDuration, currentPosition };
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('h4', { text: 'Audio Controls' });

        // Create status text
        this.statusText = container.createEl('div', {
            cls: 'audio-status-text',
            text: 'Ready'
        });

        // Create progress bar
        this.progressBar = container.createEl('progress', {
            cls: 'audio-progress',
            attr: { value: '0', max: '100' }
        });
        
        this.progressText = container.createEl('div', { 
            text: '00:00 / 00:00',
            cls: 'audio-progress-text'
        });

        const controlsContainer = container.createEl('div', { cls: 'audio-controls-container' });

        const prevSentenceButton = controlsContainer.createEl('button', { text: 'Prev', cls: 'prev-sentence' });
        const playPauseButton = controlsContainer.createEl('button', { text: 'Play', cls: 'play-pause' });
        const nextSentenceButton = controlsContainer.createEl('button', { text: 'Next', cls: 'next-sentence' });

        prevSentenceButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState) return;

            if (docState.currentIndex > 0) {
                // Pause current audio if it exists
                const currentAudio = docState.audioElements[docState.currentIndex];
                if (currentAudio) {
                    currentAudio.pause();
                }
                
                // Move to previous sentence
                docState.currentIndex--;
                this.plugin.documentStates.set(this.currentDocId!, docState);
                
                // If we're playing, continue with the previous sentence
                if (docState.state === PluginState.Playing) {
                    this.plugin.playNextSentence(this.currentDocId!);
                } else {
                    // Update the UI and highlight the current sentence even when not playing
                    this.updateControls();
                    this.plugin.highlightCurrentSentence(this.currentDocId!);
                }
            }
        });

        playPauseButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState) return;

            if (docState.state === PluginState.Playing) {
                const currentAudio = docState.audioElements[docState.currentIndex];
                if (currentAudio) {
                    currentAudio.pause();
                }
                docState.state = PluginState.Paused;
                this.plugin.documentStates.set(this.currentDocId!, docState);
                // Keep the current sentence highlighted when paused
                this.plugin.highlightCurrentSentence(this.currentDocId!);
            } else if (docState.state === PluginState.Paused || docState.state === PluginState.Idle) {
                // If we've reached the end, start from the beginning
                if (docState.currentIndex >= docState.sentences.length) {
                    docState.currentIndex = 0;
                    this.plugin.documentStates.set(this.currentDocId!, docState);
                }
                
                // If we're starting from idle, start playing from the current index
                if (docState.state === PluginState.Idle) {
                    this.plugin.playSentencesSequentially(this.currentDocId!);
                } else {
                    // If we're resuming from pause, just play the current audio
                    const currentAudio = docState.audioElements[docState.currentIndex];
                    if (currentAudio) {
                        // Highlight the current sentence before resuming playback
                        this.plugin.highlightCurrentSentence(this.currentDocId!);
                        currentAudio.play();
                        docState.state = PluginState.Playing;
                        this.plugin.documentStates.set(this.currentDocId!, docState);
                    }
                }
            }
            this.updatePlayPauseButton();
        });

        nextSentenceButton.addEventListener('click', () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState) return;

            if (docState.currentIndex < docState.sentences.length - 1) {
                // Pause current audio if it exists
                const currentAudio = docState.audioElements[docState.currentIndex];
                if (currentAudio) {
                    currentAudio.pause();
                }
                
                // Move to next sentence
                docState.currentIndex++;
                this.plugin.documentStates.set(this.currentDocId!, docState);
                
                // If we're playing, continue with the next sentence
                if (docState.state === PluginState.Playing) {
                    this.plugin.playNextSentence(this.currentDocId!);
                } else {
                    // Update the UI and highlight the current sentence even when not playing
                    this.updateControls();
                    this.plugin.highlightCurrentSentence(this.currentDocId!);
                }
            }
        });

        // Update progress
        const updateProgress = () => {
            const docState = this.currentDocId ? this.plugin.documentStates.get(this.currentDocId) : null;
            if (!docState || !this.progressBar || !this.progressText || !this.statusText) return;

            // Update status text
            if (docState.isLoading) {
                this.statusText.setText(`Loading sentence ${docState.currentIndex + 1}/${docState.sentences.length}...`);
            } else if (docState.currentIndex >= docState.sentences.length) {
                this.statusText.setText(`Playback complete (${docState.sentences.length} sentences)`);
            } else if (docState.state === PluginState.Playing) {
                this.statusText.setText(`Playing sentence ${docState.currentIndex + 1}/${docState.sentences.length}`);
            } else if (docState.state === PluginState.Paused) {
                this.statusText.setText(`Paused at sentence ${docState.currentIndex + 1}/${docState.sentences.length}`);
            } else {
                this.statusText.setText(`Ready (${docState.sentences.length} sentences)`);
            }

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
        const nextSentenceButton = this.containerEl.querySelector('.next-sentence') as HTMLButtonElement;
        const prevSentenceButton = this.containerEl.querySelector('.prev-sentence') as HTMLButtonElement;
        
        if (!playPauseButton || !nextSentenceButton || !prevSentenceButton) return;

        if (!docState || docState.sentences.length === 0) {
            playPauseButton.disabled = true;
            nextSentenceButton.disabled = true;
            prevSentenceButton.disabled = true;
            playPauseButton.textContent = 'Play';
            return;
        }

        // Enable/disable previous sentence button
        prevSentenceButton.disabled = docState.currentIndex <= 0 || 
                                     docState.state === PluginState.Generating || 
                                     docState.isLoading;

        // Enable/disable next sentence button
        nextSentenceButton.disabled = docState.currentIndex >= docState.sentences.length - 1 || 
                                     docState.state === PluginState.Generating || 
                                     docState.isLoading;

        // Enable/disable play/pause button
        playPauseButton.disabled = docState.state === PluginState.Generating || 
                                  (docState.isLoading && docState.state !== PluginState.Playing);
        
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

        // If we're at the end, show "Restart" instead of "Play"
        if (docState.currentIndex >= docState.sentences.length) {
            playPauseButton.textContent = 'Restart';
            playPauseButton.disabled = docState.sentences.length === 0 || docState.isLoading;
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
                playPauseButton.disabled = docState.sentences.length === 0 || docState.isLoading;
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
            docState.audioElements.forEach(audio => audio?.pause());
        }
    }
}