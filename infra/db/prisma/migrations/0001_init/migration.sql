-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('held', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'expired');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('web', 'channel');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('clean', 'dirty', 'inspected', 'out_of_order');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'revenue', 'frontdesk', 'housekeeper', 'head_housekeeper');

-- CreateEnum
CREATE TYPE "FolioKind" AS ENUM ('charge', 'payment', 'refund', 'storno');

-- CreateTable
CREATE TABLE "hotel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "check_in_time" TEXT NOT NULL,
    "check_out_time" TEXT NOT NULL,
    "audit_time" TEXT NOT NULL,
    "cancel_free_days" INTEGER NOT NULL DEFAULT 2,
    "cancel_free_until" TEXT NOT NULL DEFAULT '14:00',
    "last_closed_date" DATE NOT NULL,

    CONSTRAINT "hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hotel_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "max_guests" INTEGER NOT NULL,
    "overbooking_allowance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hotel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'clean',
    "housekeeper_id" UUID,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_out_of_order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_out_of_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "room_type_id" UUID NOT NULL,
    "night" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "ooo" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "overbooked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("room_type_id","night")
);

-- CreateTable
CREATE TABLE "inventory_journal" (
    "id" BIGSERIAL NOT NULL,
    "room_type_id" UUID NOT NULL,
    "night" DATE NOT NULL,
    "d_sold" INTEGER NOT NULL DEFAULT 0,
    "d_held" INTEGER NOT NULL DEFAULT 0,
    "d_ooo" INTEGER NOT NULL DEFAULT 0,
    "d_overbooked" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "doc_id" UUID,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate" (
    "room_type_id" UUID NOT NULL,
    "night" DATE NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "rate_pkey" PRIMARY KEY ("room_type_id","night")
);

-- CreateTable
CREATE TABLE "restriction" (
    "room_type_id" UUID NOT NULL,
    "night" DATE NOT NULL,
    "min_stay" INTEGER,
    "closed_to_arrival" BOOLEAN NOT NULL DEFAULT false,
    "closed_to_departure" BOOLEAN NOT NULL DEFAULT false,
    "stop_sell" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "restriction_pkey" PRIMARY KEY ("room_type_id","night")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "hotel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "guests" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "source" "BookingSource" NOT NULL,
    "channel_ref" TEXT,
    "channel_version" INTEGER,
    "overbooking" BOOLEAN NOT NULL DEFAULT false,
    "guest_name" TEXT,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "total_price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(3),
    "token_hash" TEXT NOT NULL,
    "penalty" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_night" (
    "booking_id" UUID NOT NULL,
    "night" DATE NOT NULL,
    "price" INTEGER NOT NULL,
    "overbooked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "booking_night_pkey" PRIMARY KEY ("booking_id","night")
);

-- CreateTable
CREATE TABLE "folio_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "kind" "FolioKind" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "storno_of_id" UUID,
    "idem_key" TEXT,
    "hotel_date" DATE NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folio_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "night_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hotel_id" UUID NOT NULL,
    "hotel_date" DATE NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL,
    "no_shows" INTEGER NOT NULL,
    "room_charges" INTEGER NOT NULL,

    CONSTRAINT "night_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "hotel_id" UUID,
    "role" "Role" NOT NULL,

    CONSTRAINT "staff_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_room_type" (
    "room_type_id" UUID NOT NULL,

    CONSTRAINT "channel_room_type_pkey" PRIMARY KEY ("room_type_id")
);

-- CreateTable
CREATE TABLE "channel_pending_event" (
    "channel_ref" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_pending_event_pkey" PRIMARY KEY ("channel_ref")
);

-- CreateTable
CREATE TABLE "channel_dirty" (
    "room_type_id" UUID NOT NULL,
    "dirty_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_dirty_pkey" PRIMARY KEY ("room_type_id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_code_key" ON "hotel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_hotel_id_code_key" ON "room_type"("hotel_id", "code");

-- CreateIndex
CREATE INDEX "room_hotel_id_housekeeper_id_idx" ON "room"("hotel_id", "housekeeper_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_hotel_id_number_key" ON "room"("hotel_id", "number");

-- CreateIndex
CREATE INDEX "inventory_journal_room_type_id_night_idx" ON "inventory_journal"("room_type_id", "night");

-- CreateIndex
CREATE INDEX "inventory_journal_doc_id_idx" ON "inventory_journal"("doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_code_key" ON "booking"("code");

-- CreateIndex
CREATE UNIQUE INDEX "booking_channel_ref_key" ON "booking"("channel_ref");

-- CreateIndex
CREATE UNIQUE INDEX "booking_token_hash_key" ON "booking"("token_hash");

-- CreateIndex
CREATE INDEX "booking_hotel_id_check_in_idx" ON "booking"("hotel_id", "check_in");

-- CreateIndex
CREATE INDEX "booking_hotel_id_check_out_idx" ON "booking"("hotel_id", "check_out");

-- CreateIndex
CREATE INDEX "booking_hotel_id_status_idx" ON "booking"("hotel_id", "status");

-- CreateIndex
CREATE INDEX "booking_guest_email_idx" ON "booking"("guest_email");

-- CreateIndex
CREATE UNIQUE INDEX "folio_line_storno_of_id_key" ON "folio_line"("storno_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "folio_line_idem_key_key" ON "folio_line"("idem_key");

-- CreateIndex
CREATE INDEX "folio_line_booking_id_idx" ON "folio_line"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "night_audit_hotel_id_hotel_date_key" ON "night_audit"("hotel_id", "hotel_date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_role_staff_id_hotel_id_role_key" ON "staff_role"("staff_id", "hotel_id", "role");

-- CreateIndex
CREATE INDEX "email_outbox_sent_at_idx" ON "email_outbox"("sent_at");

-- AddForeignKey
ALTER TABLE "room_type" ADD CONSTRAINT "room_type_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_night" ADD CONSTRAINT "booking_night_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role" ADD CONSTRAINT "staff_role_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== hand-written constraints =====
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- sold + held <= rooms - out of order + allowance; accepted channel overbooking is excluded
ALTER TABLE inventory
  ADD CONSTRAINT inventory_nonneg CHECK (sold >= 0 AND held >= 0 AND ooo >= 0 AND overbooked >= 0 AND total >= 0),
  ADD CONSTRAINT inventory_overbooked_le_sold CHECK (overbooked <= sold),
  ADD CONSTRAINT inventory_capacity CHECK (sold - overbooked + held <= total - ooo);

-- one physical room: at most one stay per night
CREATE TABLE room_assignment (
  booking_id uuid PRIMARY KEY REFERENCES booking(id),
  room_id uuid NOT NULL REFERENCES room(id),
  nights daterange NOT NULL,
  CONSTRAINT room_assignment_no_overlap EXCLUDE USING gist (room_id WITH =, nights WITH &&)
);

ALTER TABLE booking ADD CONSTRAINT booking_dates CHECK (check_out > check_in);
ALTER TABLE booking ADD CONSTRAINT booking_guests CHECK (guests > 0);
CREATE INDEX booking_guest_name_lower ON booking (lower(guest_name) text_pattern_ops);
CREATE INDEX booking_hold_due ON booking (hold_expires_at) WHERE status = 'held';

-- append-only tables; corrections are storno lines
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER folio_line_append_only BEFORE UPDATE OR DELETE ON folio_line FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER inventory_journal_append_only BEFORE UPDATE OR DELETE ON inventory_journal FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE folio_line ADD CONSTRAINT folio_storno_ref FOREIGN KEY (storno_of_id) REFERENCES folio_line(id);
ALTER TABLE folio_line ADD CONSTRAINT folio_storno_kind CHECK ((kind = 'storno') = (storno_of_id IS NOT NULL));

-- versions of pushes to the channel only grow
CREATE SEQUENCE channel_push_version;
