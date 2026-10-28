-- Migration 006: Add stream_tickets table for cross-instance, atomic, single-use SSE connection tickets
CREATE TABLE IF NOT EXISTS api.stream_tickets (
  jti text PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES api.clinics(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  email text,
  tenant_id text,
  roles text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS stream_tickets_expires_at_idx ON api.stream_tickets(expires_at);
CREATE INDEX IF NOT EXISTS stream_tickets_clinic_idx ON api.stream_tickets(clinic_id);
