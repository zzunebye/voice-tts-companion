import { App, PluginSettingTab, Setting, Platform, Notice } from 'obsidian';
import MyPlugin from './main';
import { TTSProvider } from './tts-service';

export interface MyPluginSettings {
  elevenLabsApiKey: string;
  unrealSpeechApiKey: string;
  unrealSpeechVoice: string;
  ttsProvider: TTSProvider;
  enablePersistentCache: boolean;
  maxCacheSize: number;
  maxCacheAgeDays: number;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  elevenLabsApiKey: '',
  unrealSpeechApiKey: '',
  unrealSpeechVoice: 'Sierra',
  ttsProvider: TTSProvider.ELEVEN_LABS,
  enablePersistentCache: true,
  maxCacheSize: 100,
  maxCacheAgeDays: 7
};

export class MyPluginSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('TTS Provider')
      .setDesc('Choose which text-to-speech service to use')
      .addDropdown(dropdown => {
        dropdown
          .addOption(TTSProvider.ELEVEN_LABS, 'ElevenLabs (Online)')
          .addOption(TTSProvider.UNREAL_SPEECH, 'Unreal Speech (Online)')
          .addOption(TTSProvider.NATIVE, Platform.isIosApp ? 'Native iOS (AVSpeechSynthesizer)' : 'Native TTS')
          .setValue(this.plugin.settings.ttsProvider)
          .onChange(async (value: TTSProvider) => {
            this.plugin.settings.ttsProvider = value;
            await this.plugin.saveSettings();
            // Hide/show API key setting based on provider
            this.display();
          });
      });

    if (this.plugin.settings.ttsProvider === TTSProvider.ELEVEN_LABS) {
      new Setting(containerEl)
        .setName('ElevenLabs API Key')
        .setDesc('Enter your ElevenLabs API key')
        .addText((text) =>
          text
            .setPlaceholder('Enter your API key')
            .setValue(this.plugin.settings.elevenLabsApiKey)
            .onChange(async (value) => {
              this.plugin.settings.elevenLabsApiKey = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.ttsProvider === TTSProvider.UNREAL_SPEECH) {
      new Setting(containerEl)
        .setName('Unreal Speech API Key')
        .setDesc('Enter your Unreal Speech API key')
        .addText((text) =>
          text
            .setPlaceholder('Enter your API key')
            .setValue(this.plugin.settings.unrealSpeechApiKey)
            .onChange(async (value) => {
              this.plugin.settings.unrealSpeechApiKey = value;
              await this.plugin.saveSettings();
            })
        );
      
      new Setting(containerEl)
        .setName('Unreal Speech Voice')
        .setDesc('Select the voice to use for Unreal Speech')
        .addDropdown((dropdown) => {
          dropdown
            .addOption('Sierra', 'Sierra')
            .addOption('Scarlett', 'Scarlett')
            .addOption('Dan', 'Dan')
            .addOption('Liv', 'Liv')
            .addOption('Will', 'Will')
            .addOption('Amy', 'Amy')
            .setValue(this.plugin.settings.unrealSpeechVoice || 'Sierra')
            .onChange(async (value) => {
              this.plugin.settings.unrealSpeechVoice = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // Add a heading for cache settings
    containerEl.createEl('h3', { text: 'Audio Cache Settings' });

    new Setting(containerEl)
      .setName('Enable Persistent Cache')
      .setDesc('Keep audio files cached between sessions to reduce API calls and improve performance')
      .addToggle(toggle => 
        toggle
          .setValue(this.plugin.settings.enablePersistentCache)
          .onChange(async value => {
            this.plugin.settings.enablePersistentCache = value;
            await this.plugin.saveSettings();
            // Update the AudioCache settings
            this.plugin.audioCache.setEnabled(value);
            // Refresh the display to show/hide other cache settings
            this.display();
          })
      );

    if (this.plugin.settings.enablePersistentCache) {
      // Add cache statistics display
      const cacheStats = this.plugin.refreshCacheStats();
      const usagePercentage = Math.min(100, Math.round((cacheStats.count / this.plugin.settings.maxCacheSize) * 100));
      
      const cacheStat = new Setting(containerEl)
        .setName('Current Cache Usage')
        .setDesc(`${cacheStats.count} audio files (${cacheStats.size})`);
      
      // Add a progress bar to visualize cache usage
      const progressBarContainer = cacheStat.controlEl.createEl('div', {
        cls: 'cache-progress-container',
        attr: {
          'aria-label': `${usagePercentage}% of maximum cache size used (${cacheStats.count}/${this.plugin.settings.maxCacheSize} files)`,
          'title': `${usagePercentage}% of maximum cache size used (${cacheStats.count}/${this.plugin.settings.maxCacheSize} files)`
        }
      });
      
      progressBarContainer.createEl('div', {
        cls: 'cache-progress-bar',
        attr: {
          style: `width: ${usagePercentage}%;`
        }
      });
      
      // Add a refresh button to update the stats
      cacheStat.addButton(button => 
        button
          .setButtonText('Refresh')
          .setTooltip('Refresh cache statistics')
          .onClick(() => {
            // Refresh the settings display to update the stats
            this.display();
            new Notice('Cache statistics refreshed');
          })
      );
      
      new Setting(containerEl)
        .setName('Maximum Cache Size')
        .setDesc('Maximum number of audio files to keep in the cache')
        .addSlider(slider => 
          slider
            .setLimits(10, 500, 10)
            .setValue(this.plugin.settings.maxCacheSize)
            .setDynamicTooltip()
            .onChange(async value => {
              this.plugin.settings.maxCacheSize = value;
              await this.plugin.saveSettings();
              // Update the AudioCache settings
              this.plugin.audioCache.setMaxCacheSize(value);
            })
        );

      new Setting(containerEl)
        .setName('Cache Expiry (Days)')
        .setDesc('Number of days to keep audio files in the cache before they expire')
        .addSlider(slider => 
          slider
            .setLimits(1, 30, 1)
            .setValue(this.plugin.settings.maxCacheAgeDays)
            .setDynamicTooltip()
            .onChange(async value => {
              this.plugin.settings.maxCacheAgeDays = value;
              await this.plugin.saveSettings();
              // Update the AudioCache settings
              this.plugin.audioCache.setMaxCacheAge(value * 24 * 60 * 60 * 1000);
            })
        );

      new Setting(containerEl)
        .setName('Clear Cache')
        .setDesc('Remove all cached audio files')
        .addButton(button => 
          button
            .setButtonText('Clear Cache')
            .onClick(async () => {
              await this.plugin.audioCache.clearCache();
              new Notice('Audio cache cleared');
              // Refresh the display to update the cache statistics
              this.display();
            })
        );
    }
  }
}