// Durable, local-only application preferences. Secrets and Purser credentials do
// not belong here; a funding reference is an opaque selector resolved later by
// an authenticated Purser binding.
import { readJson, writeJsonAtomic, pick } from './json-file';
import type { CoworkSettings } from '../../shared/types';

export class SettingsStore {
  private settings: CoworkSettings;

  constructor(private readonly filePath: string) {
    this.settings = this.read();
  }

  private read(): CoworkSettings {
    const parsed = (readJson(this.filePath) ?? {}) as Partial<CoworkSettings>;
    const configured = parsed.purserGatewayConfigured === true;
    return {
      defaultFundingRef: typeof parsed.defaultFundingRef === 'string' ? parsed.defaultFundingRef : null,
      // Chat usage is deliberately opt-in, even when the user has a default
      // funding reference for Cowork projects.
      trackChatsByDefault: parsed.trackChatsByDefault === true,
      purserGatewayConfigured: configured,
    };
  }

  snapshot(): CoworkSettings {
    return { ...this.settings };
  }

  markPurserConfigured(): CoworkSettings {
    this.settings.purserGatewayConfigured = true;
    writeJsonAtomic(this.filePath, this.settings);
    return this.snapshot();
  }

  update(patch: Partial<CoworkSettings>): CoworkSettings {
    Object.assign(this.settings, pick(patch, ['defaultFundingRef', 'trackChatsByDefault'] as const));
    this.settings.defaultFundingRef = this.settings.defaultFundingRef?.trim() || null;
    writeJsonAtomic(this.filePath, this.settings);
    return this.snapshot();
  }
}
