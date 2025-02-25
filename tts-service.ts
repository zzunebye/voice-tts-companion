import { Platform } from 'obsidian';

export enum TTSProvider {
    ELEVEN_LABS = 'elevenlabs',
    NATIVE = 'native',
    UNREAL_SPEECH = 'unrealspeech'
}

export interface TTSService {
    generateSpeech(text: string): Promise<Blob>;
    generateSpeechForSentences(sentences: string[]): Promise<Blob[]>;
}

export class ElevenLabsTTS implements TTSService {
    constructor(private apiKey: string) { }

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

export class UnrealSpeechTTS implements TTSService {
    private voiceId: string;

    constructor(private apiKey: string, voiceId = 'Sierra') {
        this.voiceId = voiceId;
    }

    async generateSpeech(text: string): Promise<Blob> {
        if (!text || text.trim() === '') {
            console.warn('Empty text provided to UnrealSpeechTTS.generateSpeech');
            // Return an empty audio blob
            return new Blob([], { type: 'audio/mp3' });
        }

        try {
            // First, make the request to generate speech
            const response = await fetch('https://api.v8.unrealspeech.com/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                redirect: 'follow',
                body: JSON.stringify({
                    Text: text,
                    VoiceId: 'Sierra',
                    Bitrate: '64k',
                    Speed: 0,
                    Pitch: 1.0,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Failed to generate speech: ${response.status} ${response.statusText} ${JSON.stringify(errorData)}`);
            }

            // Parse the response to get the OutputUri
            const responseData = await response.json();
            console.log('Unreal Speech API response:', responseData);
            
            if (!responseData.OutputUri) {
                throw new Error('No output URI found in the response');
            }

            // Fetch the audio file from the provided URL
            const audioResponse = await fetch(responseData.OutputUri);
            if (!audioResponse.ok) {
                throw new Error(`Failed to fetch audio file: ${audioResponse.status} ${audioResponse.statusText}`);
            }

            // Return the audio blob
            return await audioResponse.blob();
        } catch (error) {
            console.error('Error in UnrealSpeechTTS.generateSpeech:', error);
            throw error;
        }
    }

    async generateSpeechForSentences(sentences: string[]): Promise<Blob[]> {
        const audioBlobs: Blob[] = [];
        
        if (!sentences || sentences.length === 0) {
            console.warn('Empty sentences array provided to UnrealSpeechTTS.generateSpeechForSentences');
            return audioBlobs;
        }

        for (const sentence of sentences) {
            try {
                const blob = await this.generateSpeech(sentence);
                audioBlobs.push(blob);
            } catch (error) {
                console.error(`Error generating speech for sentence: "${sentence}"`, error);
                // Add an empty blob to maintain the sequence
                audioBlobs.push(new Blob([], { type: 'audio/mp3' }));
            }
        }
        
        return audioBlobs;
    }
} 