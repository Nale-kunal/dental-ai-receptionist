-- Migration 007: Add revoked_tokens table for persistent, cross-instance refresh token revocation
CREATE TABLE IF NOT EXISTS api.revoked_tokens (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revoked_tokens_expires_at_idx ON api.revoked_tokens(expires_at);
