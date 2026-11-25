-- Reports and the grid read booking nights by date range.
CREATE INDEX booking_night_night ON booking_night (night);
CREATE INDEX booking_hotel_status_checkin ON booking (hotel_id, status, check_in);
