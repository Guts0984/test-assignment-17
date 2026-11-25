-- A moved guest has two assignments for one booking: the old room up to today, the new room from today.
ALTER TABLE room_assignment DROP CONSTRAINT room_assignment_pkey;
ALTER TABLE room_assignment ADD CONSTRAINT room_assignment_pkey PRIMARY KEY (booking_id, room_id);

-- front desk search by surname and by e-mail prefix
CREATE INDEX IF NOT EXISTS booking_surname_lower ON booking (lower(split_part(guest_name, ' ', -1)) text_pattern_ops);
CREATE INDEX IF NOT EXISTS booking_email_lower ON booking (lower(guest_email) text_pattern_ops);
