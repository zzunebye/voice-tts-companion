import { TTSProvider, TTSService, ElevenLabsTTS, NativeTTS } from './tts-service';

export function createTTSService(provider: TTSProvider, apiKey: string): TTSService {
    console.log(`Creating TTS service for provider: ${provider}`);
    switch (provider) {
        case TTSProvider.ELEVEN_LABS:
            return new ElevenLabsTTS(apiKey);
        case TTSProvider.NATIVE:
            return new NativeTTS();
        default:
            throw new Error(`Unknown TTS provider: ${provider}`);
    }
}

export async function generateSpeech(text: string, provider: TTSProvider, apiKey: string): Promise<Blob> {
    const service = createTTSService(provider, apiKey);
    return await service.generateSpeech(text);
}

export async function generateSpeechForSentences(sentences: string[], provider: TTSProvider, apiKey: string): Promise<Blob[]> {
    console.log(`Generating speech for sentences: ${sentences.length}`);
    console.log(`Provider: ${provider}`);
    console.log(`API Key: ${apiKey}`);
    const service = createTTSService(provider, apiKey);
    return await service.generateSpeechForSentences(sentences);
}