export function cleanSentence(sentence: string): string {
    // Remove leading -, #, and spaces
    return sentence.replace(/^[-#\s]+/, '').trim();
}