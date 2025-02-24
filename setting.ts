import { App, PluginSettingTab, Setting, Platform } from 'obsidian';
import MyPlugin from './main';
import { TTSProvider } from './tts-service';

export interface MyPluginSettings {
  apiKey: string;
  ttsProvider: TTSProvider;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  apiKey: '',
  ttsProvider: TTSProvider.ELEVEN_LABS
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
            .setValue(this.plugin.settings.apiKey)
            .onChange(async (value) => {
              this.plugin.settings.apiKey = value;
              await this.plugin.saveSettings();
            })
        );
    }
  }
}