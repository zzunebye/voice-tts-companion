import { Platform } from 'obsidian';

export enum TTSProvider {
    ELEVEN_LABS = 'elevenlabs',
    NATIVE = 'native'
}

export interface TTSService {
    generateSpeech(text: string): Promise<Blob>;
    generateSpeechForSentences(sentences: string[]): Promise<Blob[]>;
}

export class ElevenLabsTTS implements TTSService {
    constructor(private apiKey: string) {}

    async generateSpeech(text: string): Promise<Blob> {
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/9BWtsMINqrJLrRacOk9x', {
            method: 'POST',
            headers: {
                'xi-api-key': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                },
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to generate speech');
        }

        return await response.blob();
    }

    async generateSpeechForSentences(sentences: string[]): Promise<Blob[]> {
        const audioBlobs: Blob[] = [];
        for (const sentence of sentences) {
            const blob = await this.generateSpeech(sentence);
            audioBlobs.push(blob);
        }
        return audioBlobs;
    }
}

export class NativeTTS implements TTSService {
    private speechSynthesis: SpeechSynthesis;
    private audioContext: AudioContext;

    constructor() {
        if (Platform.isDesktopApp) {
            // Desktop app - use Web Speech API
            this.speechSynthesis = window.speechSynthesis;
            this.audioContext = new AudioContext();
        } else if (Platform.isMobileApp && Platform.isIosApp) {
            // iOS app - use AVSpeechSynthesizer
            // Note: This will need to be implemented in the mobile app's native layer
            throw new Error('iOS native TTS not implemented yet');
        }
    }

    private async speechToBlob(utterance: SpeechSynthesisUtterance): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const mediaRecorder = new MediaRecorder(this.audioContext.createMediaStreamDestination().stream);
            const chunks: Blob[] = [];

            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/wav' }));
            mediaRecorder.onerror = (e) => reject(e);

            mediaRecorder.start();
            this.speechSynthesis.speak(utterance);

            utterance.onend = () => mediaRecorder.stop();
            utterance.onerror = (e) => {
                mediaRecorder.stop();
                reject(e);
            };
        });
    }

    async generateSpeech(text: string): Promise<Blob> {
        const utterance = new SpeechSynthesisUtterance(text);
        return await this.speechToBlob(utterance);
    }

    async generateSpeechForSentences(sentences: string[]): Promise<Blob[]> {
        const blobs: Blob[] = [];
        for (const sentence of sentences) {
            const blob = await this.generateSpeech(sentence);
            blobs.push(blob);
        }
        return blobs;
    }
} 