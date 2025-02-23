export async function generateSpeech(text: string, apiKey: string): Promise<Blob> {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/9BWtsMINqrJLrRacOk9x', {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey, // ElevenLabs uses 'xi-api-key' header for authentication
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: text,
            model_id: 'eleven_multilingual_v2', // Adjust based on ElevenLabs documentation
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

export async function generateSpeechForSentences(sentences: string[], apiKey: string): Promise<Blob[]> {
    const audioBlobs: Blob[] = [];

    for (const sentence of sentences) {
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/9BWtsMINqrJLrRacOk9x', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: sentence,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                },
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to generate speech for sentence');
        }

        const blob = await response.blob();
        audioBlobs.push(blob);
    }

    return audioBlobs;
}