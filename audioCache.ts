import { App } from 'obsidian';

/**
 * Interface for the audio cache entry
 */
interface AudioCacheEntry {
    blob: Blob;
    timestamp: number;
    docId: string;
    hash: string;
    size: number; // Add size property to track file size
}

/**
 * Class for managing persistent audio caching
 */
export class AudioCache {
    private cache: Map<string, AudioCacheEntry> = new Map();
    private app: App;
    private maxCacheSize = 100; // Maximum number of entries in the cache
    private maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    private enabled = true; // Whether the cache is enabled
    private totalSize = 0; // Track total size of all cached files in bytes
    
    constructor(app: App) {
        this.app = app;
        this.loadCache();
    }
    
    /**
     * Get the total size of all cached files in bytes
     */
    getTotalSize(): number {
        return this.totalSize;
    }
    
    /**
     * Get the total size of all cached files as a formatted string
     */
    getFormattedSize(): string {
        return this.formatBytes(this.totalSize);
    }
    
    /**
     * Get the number of entries in the cache
     */
    getEntryCount(): number {
        return this.cache.size;
    }
    
    /**
     * Format bytes to a human-readable string
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Set whether the cache is enabled
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        
        // If disabling, clear the cache
        if (!enabled) {
            this.clearCache();
        }
    }
    
    /**
     * Set the maximum cache size
     */
    setMaxCacheSize(size: number): void {
        this.maxCacheSize = size;
        this.pruneCache();
    }
    
    /**
     * Set the maximum cache age in milliseconds
     */
    setMaxCacheAge(ageMs: number): void {
        this.maxCacheAge = ageMs;
        this.pruneCache();
    }
    
    /**
     * Generate a unique hash for a sentence and document
     */
    private generateHash(sentence: string, docId: string): string {
        // Simple hash function for strings
        let hash = 0;
        for (let i = 0; i < sentence.length; i++) {
            const char = sentence.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Combine with docId to make it unique per document
        return `${docId}-${hash}`;
    }
    
    /**
     * Store an audio blob in the cache
     */
    async storeAudio(sentence: string, docId: string, blob: Blob): Promise<string> {
        // If cache is disabled, don't store anything
        if (!this.enabled) {
            return '';
        }
        
        const hash = this.generateHash(sentence, docId);
        const size = blob.size;
        
        // If this hash already exists, subtract its size from the total before replacing
        if (this.cache.has(hash)) {
            this.totalSize -= this.cache.get(hash)!.size;
        }
        
        // Add the new blob's size to the total
        this.totalSize += size;
        
        this.cache.set(hash, {
            blob,
            timestamp: Date.now(),
            docId,
            hash,
            size
        });
        
        // Prune cache if it gets too large
        this.pruneCache();
        
        // Save cache to disk
        await this.saveCache();
        
        return hash;
    }
    
    /**
     * Retrieve an audio blob from the cache
     */
    getAudio(sentence: string, docId: string): Blob | null {
        // If cache is disabled, always return null
        if (!this.enabled) {
            return null;
        }
        
        const hash = this.generateHash(sentence, docId);
        const entry = this.cache.get(hash);
        
        if (!entry) {
            return null;
        }
        
        // Update the timestamp to mark it as recently used
        entry.timestamp = Date.now();
        this.cache.set(hash, entry);
        
        return entry.blob;
    }
    
    /**
     * Check if an audio blob exists in the cache
     */
    hasAudio(sentence: string, docId: string): boolean {
        // If cache is disabled, always return false
        if (!this.enabled) {
            return false;
        }
        
        const hash = this.generateHash(sentence, docId);
        return this.cache.has(hash);
    }
    
    /**
     * Remove old entries from the cache
     */
    private pruneCache(): void {
        // If cache is disabled, clear it
        if (!this.enabled) {
            this.cache.clear();
            this.totalSize = 0;
            return;
        }
        
        // Remove old entries
        const now = Date.now();
        for (const [hash, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.maxCacheAge) {
                this.totalSize -= entry.size;
                this.cache.delete(hash);
            }
        }
        
        // If still too many entries, remove the oldest ones
        if (this.cache.size > this.maxCacheSize) {
            const entries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            // Remove oldest entries until we're under the limit
            while (entries.length > this.maxCacheSize) {
                const [hash, entry] = entries.shift()!;
                this.totalSize -= entry.size;
                this.cache.delete(hash);
            }
        }
    }
    
    /**
     * Save the cache to disk
     */
    private async saveCache(): Promise<void> {
        // If cache is disabled, don't save anything
        if (!this.enabled) {
            return;
        }
        
        try {
            // Convert blobs to base64 strings for storage
            const serializedCache: Record<string, any> = {};
            
            for (const [hash, entry] of this.cache.entries()) {
                const base64 = await this.blobToBase64(entry.blob);
                serializedCache[hash] = {
                    base64,
                    timestamp: entry.timestamp,
                    docId: entry.docId,
                    hash: entry.hash,
                    size: entry.size
                };
            }
            
            // Use the correct Obsidian API method for saving data
            await this.app.vault.adapter.write(
                `${this.app.vault.configDir}/plugins/obsidian-sample-plugin/audio-cache.json`,
                JSON.stringify(serializedCache)
            );
        } catch (error) {
            console.error('Failed to save audio cache:', error);
        }
    }
    
    /**
     * Load the cache from disk
     */
    private async loadCache(): Promise<void> {
        // If cache is disabled, don't load anything
        if (!this.enabled) {
            return;
        }
        
        try {
            // Use the correct Obsidian API method for loading data
            let serializedCache;
            try {
                const cacheData = await this.app.vault.adapter.read(
                    `${this.app.vault.configDir}/plugins/obsidian-sample-plugin/audio-cache.json`
                );
                serializedCache = JSON.parse(cacheData);
            } catch (e) {
                // If the file doesn't exist or can't be parsed, start with an empty cache
                console.log('No existing cache found or cache invalid, starting fresh');
                return;
            }
            
            if (!serializedCache) {
                return;
            }
            
            this.totalSize = 0; // Reset total size before loading
            
            for (const hash in serializedCache) {
                const entry = serializedCache[hash];
                const blob = await this.base64ToBlob(entry.base64, 'audio/mp3');
                const size = entry.size || blob.size; // Use stored size or calculate if not available
                
                this.totalSize += size;
                
                this.cache.set(hash, {
                    blob,
                    timestamp: entry.timestamp,
                    docId: entry.docId,
                    hash: entry.hash,
                    size: size
                });
            }
            
            // Prune the cache after loading
            this.pruneCache();
        } catch (error) {
            console.error('Failed to load audio cache:', error);
        }
    }
    
    /**
     * Convert a blob to a base64 string
     */
    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                // Remove the data URL prefix (e.g., "data:audio/mp3;base64,")
                const base64Data = base64.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * Convert a base64 string to a blob
     */
    private base64ToBlob(base64: string, type: string): Promise<Blob> {
        return new Promise((resolve) => {
            const byteCharacters = atob(base64);
            const byteArrays = [];
            
            for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                const slice = byteCharacters.slice(offset, offset + 512);
                
                const byteNumbers = new Array(slice.length);
                for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                }
                
                const byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
            }
            
            const blob = new Blob(byteArrays, { type });
            resolve(blob);
        });
    }
    
    /**
     * Clear all entries for a specific document
     */
    clearDocumentEntries(docId: string): void {
        for (const [hash, entry] of this.cache.entries()) {
            if (entry.docId === docId) {
                this.totalSize -= entry.size;
                this.cache.delete(hash);
            }
        }
    }
    
    /**
     * Clear the entire cache
     */
    async clearCache(): Promise<void> {
        this.cache.clear();
        this.totalSize = 0;
        await this.saveCache();
    }
} 