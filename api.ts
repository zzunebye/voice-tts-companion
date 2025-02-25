import { MyPluginSettings } from 'setting';
import { TTSProvider, TTSService, ElevenLabsTTS, NativeTTS, UnrealSpeechTTS } from './tts-service';

export function createTTSService(provider: TTSProvider, apiKey: string, settings: MyPluginSettings): TTSService {
    console.log(`Creating TTS service for provider: ${provider}`);
    switch (provider) {
        case TTSProvider.ELEVEN_LABS:
            return new ElevenLabsTTS(settings.elevenLabsApiKey);
        case TTSProvider.NATIVE:
            return new NativeTTS();
        case TTSProvider.UNREAL_SPEECH:
            return new UnrealSpeechTTS(settings.unrealSpeechApiKey, settings.unrealSpeechVoice);
        default:
            throw new Error(`Unknown TTS provider: ${provider}`);
    }
}

export async function generateSpeech(text: string, provider: TTSProvider, settings: MyPluginSettings): Promise<Blob> {
    const service = createTTSService(provider, "", settings);
    return await service.generateSpeech(text);
}

export async function generateSpeechForSentences(sentences: string[], provider: TTSProvider, settings: MyPluginSettings): Promise<Blob[]> {
    console.log(`Generating speech for sentences: ${sentences.length}`);
    console.log(`Provider: ${provider}`);
    
    // Create the service with the correct settings
    const service = createTTSService(provider, "", settings);
    return await service.generateSpeechForSentences(sentences);
}