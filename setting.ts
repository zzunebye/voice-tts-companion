import { App, PluginSettingTab, Setting, Platform } from 'obsidian';
import MyPlugin from './main';
import { TTSProvider } from './tts-service';

export interface MyPluginSettings {
  elevenLabsApiKey: string;
  unrealSpeechApiKey: string;
  unrealSpeechVoice: string;
  ttsProvider: TTSProvider;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  elevenLabsApiKey: '',
  unrealSpeechApiKey: '',
  unrealSpeechVoice: 'Sierra',
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
  }
}