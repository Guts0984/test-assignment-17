-- Live updates: every commit that changes what screens show NOTIFYs the hotel's listeners.
-- Identical payloads inside one transaction are delivered once by Postgres.
CREATE FUNCTION notify_hotel(hotel uuid, kind text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('hotel_changed', json_build_object('hotelId', hotel, 'kind', kind)::text);
END $$;

CREATE FUNCTION inventory_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_hotel((SELECT hotel_id FROM room_type WHERE id = NEW.room_type_id), 'grid');
  RETURN NULL;
END $$;
CREATE TRIGGER inventory_notify AFTER INSERT OR UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION inventory_notify();

CREATE FUNCTION booking_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_hotel(NEW.hotel_id, 'desk');
  RETURN NULL;
END $$;
CREATE TRIGGER booking_notify AFTER INSERT OR UPDATE ON booking FOR EACH ROW EXECUTE FUNCTION booking_notify();

CREATE FUNCTION room_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_hotel(NEW.hotel_id, 'rooms');
  RETURN NULL;
END $$;
CREATE TRIGGER room_notify AFTER UPDATE ON room FOR EACH ROW EXECUTE FUNCTION room_notify();

CREATE FUNCTION folio_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_hotel((SELECT hotel_id FROM booking WHERE id = NEW.booking_id), 'desk');
  RETURN NULL;
END $$;
CREATE TRIGGER folio_notify AFTER INSERT ON folio_line FOR EACH ROW EXECUTE FUNCTION folio_notify();
