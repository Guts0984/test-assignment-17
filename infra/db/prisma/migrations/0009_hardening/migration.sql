-- A booking changed after its free-cancellation period ended keeps the deadline it had (no escaping the penalty by moving the dates).
ALTER TABLE booking ADD COLUMN cancel_deadline timestamptz;
-- Signing out revokes the access token for the rest of its life.
CREATE TABLE revoked_token (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX revoked_token_expiry ON revoked_token (expires_at);
