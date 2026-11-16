/**
 * Receptionist Mode & WhatsApp Integration Status Suite
 *
 * Verifies the receptionist UI status indication:
 * - Live Mode Active: When integrationEnabled === true && integrationStatus === 'valid'
 * - Safe Test Mode: When integration is disabled, unconfigured, or invalid
 */

import { describe, it, expect } from 'vitest';

export interface ReceptionistSettingsDisplay {
  receptionist_enabled: boolean;
  integrationEnabled?: boolean;
  integrationStatus?: 'unconfigured' | 'unvalidated' | 'valid' | 'invalid' | 'expired';
}

export function determineReceptionistMode(settings: ReceptionistSettingsDisplay | null): {
  isLiveMode: boolean;
  badgeText: string;
  badgeColor: string;
  showConfigurePrompt: boolean;
} {
  const isLive = Boolean(settings?.integrationEnabled && settings?.integrationStatus === 'valid');

  if (isLive) {
    return {
      isLiveMode: true,
      badgeText: 'Live mode active: Patient replies are dispatched directly via verified WhatsApp Cloud API',
      badgeColor: 'var(--success)',
      showConfigurePrompt: false,
    };
  }

  return {
    isLiveMode: false,
    badgeText: 'Safe test mode: Replies recorded in patient chart (Live WhatsApp dispatch uses configured credentials)',
    badgeColor: 'var(--text-muted)',
    showConfigurePrompt: true,
  };
}

describe('Frontend: Receptionist Mode Indication Logic', () => {
  it('identifies Live Mode when WhatsApp integration is enabled and valid', () => {
    const settings: ReceptionistSettingsDisplay = {
      receptionist_enabled: true,
      integrationEnabled: true,
      integrationStatus: 'valid',
    };

    const mode = determineReceptionistMode(settings);
    expect(mode.isLiveMode).toBe(true);
    expect(mode.badgeText).toContain('Live mode active');
    expect(mode.badgeText).toContain('verified WhatsApp Cloud API');
    expect(mode.showConfigurePrompt).toBe(false);
  });

  it('identifies Safe Test Mode when WhatsApp integration is disabled', () => {
    const settings: ReceptionistSettingsDisplay = {
      receptionist_enabled: true,
      integrationEnabled: false,
      integrationStatus: 'valid',
    };

    const mode = determineReceptionistMode(settings);
    expect(mode.isLiveMode).toBe(false);
    expect(mode.badgeText).toContain('Safe test mode');
    expect(mode.showConfigurePrompt).toBe(true);
  });

  it('identifies Safe Test Mode when WhatsApp integration status is unconfigured', () => {
    const settings: ReceptionistSettingsDisplay = {
      receptionist_enabled: true,
      integrationEnabled: true,
      integrationStatus: 'unconfigured',
    };

    const mode = determineReceptionistMode(settings);
    expect(mode.isLiveMode).toBe(false);
    expect(mode.badgeText).toContain('Safe test mode');
    expect(mode.showConfigurePrompt).toBe(true);
  });

  it('identifies Safe Test Mode when WhatsApp integration status is invalid', () => {
    const settings: ReceptionistSettingsDisplay = {
      receptionist_enabled: true,
      integrationEnabled: true,
      integrationStatus: 'invalid',
    };

    const mode = determineReceptionistMode(settings);
    expect(mode.isLiveMode).toBe(false);
    expect(mode.badgeText).toContain('Safe test mode');
    expect(mode.showConfigurePrompt).toBe(true);
  });

  it('identifies Safe Test Mode when settings are null or empty', () => {
    const mode = determineReceptionistMode(null);
    expect(mode.isLiveMode).toBe(false);
    expect(mode.badgeText).toContain('Safe test mode');
    expect(mode.showConfigurePrompt).toBe(true);
  });
});
