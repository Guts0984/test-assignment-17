-- Inbound channel events are stored first (Postgres is the truth), then processed by a BullMQ job.
-- A repeat of the same (channel booking number, version, type) is the same row: that is the idempotency.
CREATE TABLE channel_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_ref text NOT NULL,
  version int NOT NULL,
  type text NOT NULL,
  room_type_id uuid NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result text,
  error text,
  CONSTRAINT channel_inbox_event UNIQUE (channel_ref, version, type)
);
CREATE INDEX channel_inbox_pending ON channel_inbox (received_at) WHERE processed_at IS NULL;
