/**
 * Multi-Tenant WhatsApp Integration Service
 *
 * Enforces strict per-clinic isolation:
 * - Loads integration credentials exclusively for the authenticated clinic.
 * - Decrypts tokens on-the-fly in memory using authenticated AES-256-GCM.
 * - Transmits messages using that clinic's verified Phone Number ID and Bearer token.
 * - Never leaks credentials in error logs, audit records, or API responses.
 * - Validates credentials against Meta Cloud API without sending messages.
 * - Never marks credentials valid solely because they were saved.
 */

import { prisma } from '../database/prisma/client';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/encryption';
import { logger } from '../config/logger';

export interface ClinicWhatsAppIntegration {
  id: string;
  clinicId: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  accessToken: string | null;
  keyVersion: string;
  enabled: boolean;
  status: 'unconfigured' | 'unvalidated' | 'valid' | 'invalid' | 'expired';
  tokenExpiresAt: Date | null;
  lastValidatedAt: Date | null;
  lastError: string | null;
}

export interface SendMessageOptions {
  clinicId: string;
  toPhone: string;
  body: string;
  customFetch?: typeof fetch;
  timeoutMs?: number;
}

export interface SendMessageResult {
  success: boolean;
  deliveryStatus: 'sent' | 'logged_locally' | 'failed';
  providerStatus: 'sent' | 'not_configured' | 'auth_error' | 'rate_limited' | 'provider_error';
  providerMessageId?: string;
  message: string;
}

export interface ValidateIntegrationResult {
  valid: boolean;
  status: 'valid' | 'invalid' | 'unvalidated' | 'unconfigured' | 'expired';
  message: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
}

export class WhatsAppService {
  /**
   * Retrieves the WhatsApp integration for a specific clinic, decrypting the token if present.
   */
  async getClinicIntegration(clinicId: string): Promise<ClinicWhatsAppIntegration | null> {
    if (!clinicId) return null;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, phone_number_id, waba_id, encrypted_access_token, key_version,
              enabled, status, token_expires_at, last_validated_at, last_error
       FROM api.clinic_whatsapp_integrations
       WHERE clinic_id = $1::uuid`,
      clinicId
    );

    if (!rows || rows.length === 0) {
      // Check fallback on api.clinics.settings (backward compatibility)
      const clinicRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
        clinicId
      );
      const s = clinicRows[0]?.settings ?? {};
      const phoneId = s.phone_number_id || s.whatsapp_phone_number_id || s.meta_phone_number_id || null;
      if (!phoneId) return null;

      return {
        id: 'legacy-fallback',
        clinicId,
        phoneNumberId: phoneId,
        wabaId: s.waba_id || null,
        accessToken: null,
        keyVersion: 'v1',
        enabled: true,
        status: 'unconfigured',
        tokenExpiresAt: null,
        lastValidatedAt: null,
        lastError: null,
      };
    }

    const r = rows[0];
    let decryptedToken: string | null = null;

    if (r.encrypted_access_token) {
      try {
        decryptedToken = decryptSecret(r.encrypted_access_token, r.key_version || 'v1');
      } catch (err: any) {
        logger.error('Failed to decrypt WhatsApp access token for clinic', {
          clinicId,
          error: err.message,
        });
      }
    }

    return {
      id: r.id,
      clinicId: r.clinic_id,
      phoneNumberId: r.phone_number_id,
      wabaId: r.waba_id,
      accessToken: decryptedToken,
      keyVersion: r.key_version || 'v1',
      enabled: Boolean(r.enabled),
      status: r.status || 'unconfigured',
      tokenExpiresAt: r.token_expires_at ? new Date(r.token_expires_at) : null,
      lastValidatedAt: r.last_validated_at ? new Date(r.last_validated_at) : null,
      lastError: r.last_error,
    };
  }

  /**
   * Updates or creates the WhatsApp integration for a clinic.
   * Encrypts the access token before saving.
   * Sets status to 'unvalidated' if a new token is provided — NEVER marks 'valid' solely because of save.
   */
  async updateClinicIntegration(
    clinicId: string,
    params: {
      phoneNumberId?: string;
      wabaId?: string;
      accessToken?: string;
      enabled?: boolean;
    }
  ): Promise<{
    clinicId: string;
    phoneNumberId: string | null;
    wabaId: string | null;
    enabled: boolean;
    status: string;
    hasToken: boolean;
    maskedToken: string;
  }> {
    const existingRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT encrypted_access_token, key_version, status, phone_number_id, waba_id, enabled
       FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1::uuid`,
      clinicId
    );
    const existingRow = existingRows && existingRows[0];
    const existing = await this.getClinicIntegration(clinicId);

    let encryptedToken = existingRow?.encrypted_access_token ?? null;
    let keyVersion = existingRow?.key_version || 'v1';
    let newStatus = existingRow?.status || existing?.status || 'unconfigured';

    if (params.accessToken !== undefined) {
      if (params.accessToken.trim().length > 0) {
        const encrypted = encryptSecret(params.accessToken.trim());
        encryptedToken = encrypted.ciphertext;
        keyVersion = encrypted.keyVersion;
        // IMPORTANT: Newly saved tokens are 'unvalidated' until verified against Meta Cloud API
        newStatus = 'unvalidated';
      } else {
        encryptedToken = null;
        newStatus = 'unconfigured';
      }
    }

    const phoneNumberId = params.phoneNumberId !== undefined ? (params.phoneNumberId.trim() || null) : existing?.phoneNumberId || null;
    const wabaId = params.wabaId !== undefined ? (params.wabaId.trim() || null) : existing?.wabaId || null;
    const enabled = params.enabled !== undefined ? params.enabled : (existing ? existing.enabled : true);

    // Enforce uniqueness across other clinics before persisting
    if (phoneNumberId) {
      const conflictRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT clinic_id FROM api.clinic_whatsapp_integrations
         WHERE phone_number_id = $1 AND clinic_id != $2::uuid`,
        phoneNumberId,
        clinicId
      );
      if (conflictRows && conflictRows.length > 0) {
        throw new Error(`Phone number ID '${phoneNumberId}' is already assigned to another clinic.`);
      }
    }

    await prisma.$queryRawUnsafe(
      `INSERT INTO api.clinic_whatsapp_integrations (
         clinic_id, phone_number_id, waba_id, encrypted_access_token, key_version, enabled, status, updated_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7, NOW()
       )
       ON CONFLICT (clinic_id) DO UPDATE SET
         phone_number_id = EXCLUDED.phone_number_id,
         waba_id = EXCLUDED.waba_id,
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         key_version = EXCLUDED.key_version,
         enabled = EXCLUDED.enabled,
         status = EXCLUDED.status,
         updated_at = NOW();`,
      clinicId,
      phoneNumberId,
      wabaId,
      encryptedToken,
      keyVersion,
      enabled,
      newStatus
    );

    // Synchronize canonical phone_number_id in api.clinics.settings
    if (phoneNumberId !== undefined) {
      const clinicRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
        clinicId
      );
      const s = clinicRows[0]?.settings ?? {};
      s.phone_number_id = phoneNumberId;
      s.whatsapp_phone_number_id = phoneNumberId;
      s.meta_phone_number_id = phoneNumberId;
      if (wabaId) s.waba_id = wabaId;

      await prisma.$queryRawUnsafe(
        `UPDATE api.clinics SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
        clinicId,
        JSON.stringify(s)
      );
    }

    const updated = await this.getClinicIntegration(clinicId);
    return {
      clinicId,
      phoneNumberId: updated?.phoneNumberId || null,
      wabaId: updated?.wabaId || null,
      enabled: updated?.enabled ?? true,
      status: updated?.status || 'unconfigured',
      hasToken: Boolean(updated?.accessToken),
      maskedToken: maskSecret(updated?.accessToken),
    };
  }

  /**
   * Validates integration credentials by querying Meta Graph API for Phone Number ID details.
   * Does NOT send any WhatsApp message.
   * Never leaks tokens in error messages or logs.
   */
  async validateIntegration(clinicId: string, customFetch?: typeof fetch): Promise<ValidateIntegrationResult> {
    const fetchFn = customFetch || fetch;
    const integration = await this.getClinicIntegration(clinicId);

    if (!integration || !integration.phoneNumberId || !integration.accessToken) {
      return {
        valid: false,
        status: 'unconfigured',
        message: 'Cannot validate: Both a Phone Number ID and an Access Token must be configured first.',
      };
    }

    const endpoint = `https://graph.facebook.com/v20.0/${integration.phoneNumberId}?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status`;

    try {
      const response = await fetchFn(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Accept': 'application/json',
        },
      });

      const data: any = await response.json().catch(() => ({}));

      if (response.ok && data.id) {
        await prisma.$queryRawUnsafe(
          `UPDATE api.clinic_whatsapp_integrations
           SET status = 'valid', last_validated_at = NOW(), last_error = null, updated_at = NOW()
           WHERE clinic_id = $1::uuid`,
          clinicId
        );

        return {
          valid: true,
          status: 'valid',
          message: 'WhatsApp integration credentials validated successfully with Meta.',
          verifiedName: data.verified_name,
          displayPhoneNumber: data.display_phone_number,
          qualityRating: data.quality_rating,
          codeVerificationStatus: data.code_verification_status,
        };
      }

      const status = response.status;
      const errorObj = data.error || {};
      const errorCode = errorObj.code;

      let safeErrorMessage = 'Meta Cloud API rejected the credentials or Phone Number ID.';
      const newStatus: 'invalid' = 'invalid';

      if (status === 401 || errorCode === 190) {
        safeErrorMessage = 'Meta authorization failed: The access token is invalid, expired, or revoked.';
      } else if (status === 403 || errorCode === 200 || errorCode === 10) {
        safeErrorMessage = 'Insufficient permissions: Token lacks permission for this WhatsApp Phone Number ID (requires whatsapp_business_messaging or management permissions).';
      } else if (status === 400 || status === 404) {
        safeErrorMessage = 'Invalid configuration: Phone Number ID was not found on Meta or does not match this WhatsApp Business Account.';
      }

      await prisma.$queryRawUnsafe(
        `UPDATE api.clinic_whatsapp_integrations
         SET status = $2, last_error = $3, updated_at = NOW()
         WHERE clinic_id = $1::uuid`,
        clinicId,
        newStatus,
        safeErrorMessage
      );

      return {
        valid: false,
        status: newStatus,
        message: safeErrorMessage,
      };
    } catch (err: any) {
      const isNetworkError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'ETIMEDOUT' ||
        err.name === 'AbortError' ||
        (err.message && /connect|network|fetch|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(err.message));
      const safeMessage = isNetworkError
        ? 'Network error contacting Meta API. Validation cannot be completed at this time.'
        : 'An error occurred while validating credentials with Meta.';

      await prisma.$queryRawUnsafe(
        `UPDATE api.clinic_whatsapp_integrations
         SET last_error = $2, updated_at = NOW()
         WHERE clinic_id = $1::uuid`,
        clinicId,
        safeMessage
      );

      return {
        valid: false,
        status: integration.status, // Preserve current unvalidated status
        message: safeMessage,
      };
    }
  }

  /**
   * Sends an outbound WhatsApp message via Meta Cloud API using the clinic's credentials.
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const { clinicId, toPhone, body, customFetch, timeoutMs = 8000 } = options;
    const fetchFn = customFetch || fetch;

    const integration = await this.getClinicIntegration(clinicId);

    // If clinic does not have credentials configured
    if (!integration || !integration.phoneNumberId || !integration.accessToken) {
      return {
        success: false,
        deliveryStatus: 'logged_locally',
        providerStatus: 'not_configured',
        message: 'Message saved to chart. Live WhatsApp dispatch is not configured for this clinic.',
      };
    }

    // If integration is disabled (safe test mode)
    if (!integration.enabled) {
      return {
        success: false,
        deliveryStatus: 'logged_locally',
        providerStatus: 'not_configured',
        message: 'Message saved to chart. Live WhatsApp dispatch is disabled for this clinic (Safe Test Mode active).',
      };
    }

    // Reject unless status is valid
    if (integration.status !== 'valid') {
      return {
        success: false,
        deliveryStatus: 'failed',
        providerStatus: 'auth_error',
        message: `WhatsApp integration is not validated (current status: ${integration.status}). Outbound dispatch rejected.`,
      };
    }

    // Reject if token is expired
    if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() <= Date.now()) {
      return {
        success: false,
        deliveryStatus: 'failed',
        providerStatus: 'auth_error',
        message: 'WhatsApp access token has expired. Outbound dispatch rejected.',
      };
    }

    // Clean recipient phone number (remove whitespace, dashes, plus sign for Meta API)
    const cleanPhone = toPhone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      return {
        success: false,
        deliveryStatus: 'failed',
        providerStatus: 'provider_error',
        message: `Invalid recipient phone number: ${toPhone}`,
      };
    }

    const endpoint = `https://graph.facebook.com/v20.0/${integration.phoneNumberId}/messages`;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: {
            preview_url: false,
            body,
          },
        }),
      });

      const data: any = await response.json().catch(() => ({}));

      if (response.ok && data.messages?.[0]?.id) {
        const wamid = data.messages[0].id;
        return {
          success: true,
          deliveryStatus: 'sent',
          providerStatus: 'sent',
          providerMessageId: wamid,
          message: 'Message dispatched successfully to WhatsApp.',
        };
      }

      // Handle provider errors safely without leaking tokens
      const status = response.status;
      const errorMsg = data.error?.message || 'Unknown Meta Cloud API error';

      if (status === 401 || status === 403) {
        // Record auth failure on integration record
        await prisma.$queryRawUnsafe(
          `UPDATE api.clinic_whatsapp_integrations
           SET status = 'invalid', last_error = $2, updated_at = NOW()
           WHERE clinic_id = $1::uuid`,
          clinicId,
          'Meta authorization failed: invalid or expired access token'
        );

        return {
          success: false,
          deliveryStatus: 'failed',
          providerStatus: 'auth_error',
          message: 'Meta WhatsApp authorization failed. Please check clinic credentials.',
        };
      }

      if (status === 429) {
        return {
          success: false,
          deliveryStatus: 'failed',
          providerStatus: 'rate_limited',
          message: 'WhatsApp rate limit exceeded. Please retry in a few moments.',
        };
      }

      return {
        success: false,
        deliveryStatus: 'failed',
        providerStatus: 'provider_error',
        message: `WhatsApp provider rejected message: ${errorMsg}`,
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError' || err.code === 'ABORT_ERR' || /abort|timeout/i.test(err.message || '');

      logger.error('WhatsApp dispatch network error', {
        clinicId,
        recipient: cleanPhone,
        isTimeout,
        error: err.message,
      });

      return {
        success: false,
        deliveryStatus: 'failed',
        providerStatus: 'provider_error',
        message: isTimeout
          ? `Network timeout: Meta WhatsApp Cloud API did not respond within ${Math.round(timeoutMs / 1000)} seconds`
          : (err.message || 'Network error connecting to WhatsApp provider'),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export const whatsAppService = new WhatsAppService();
