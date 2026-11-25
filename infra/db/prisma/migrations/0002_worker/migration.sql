-- Last successful channel push per room type (debounce + last version); the version sequence is in 0001
CREATE TABLE "channel_push_state" (
    "room_type_id" UUID NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,
    "last_version" BIGINT NOT NULL,

    CONSTRAINT "channel_push_state_pkey" PRIMARY KEY ("room_type_id")
);
