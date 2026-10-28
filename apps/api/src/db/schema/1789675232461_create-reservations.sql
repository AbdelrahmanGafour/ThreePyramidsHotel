-- Reservations. PostgreSQL's EXCLUDE USING gist (no overlapping active stays
-- per room) has no MySQL equivalent: the application enforces it inside the
-- booking transaction by locking the room row (SELECT ... FOR UPDATE) and
-- checking for overlap before writing.
ALTER TABLE rooms ADD CONSTRAINT rooms_id_room_type_id_key UNIQUE (id, room_type_id)
-- ;;
CREATE TABLE reservations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_reference VARCHAR(64) NOT NULL,
  room_type_id BIGINT NOT NULL,
  room_id BIGINT NOT NULL,
  guest_first_name TEXT NOT NULL,
  guest_last_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  guest_country TEXT NOT NULL,
  adults INT NOT NULL,
  children INT NOT NULL DEFAULT 0,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  currency VARCHAR(8) NOT NULL DEFAULT 'EGP',
  nightly_rate_snapshot DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  special_requests TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT reservations_booking_reference_key UNIQUE (booking_reference),
  CONSTRAINT reservations_adults_check CHECK (adults > 0),
  CONSTRAINT reservations_children_check CHECK (children >= 0),
  CONSTRAINT reservations_status_check CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  CONSTRAINT reservations_currency_check CHECK (currency = 'EGP'),
  CONSTRAINT reservations_nightly_rate_snapshot_check CHECK (nightly_rate_snapshot >= 0),
  CONSTRAINT reservations_total_amount_check CHECK (total_amount >= 0),
  CONSTRAINT reservations_stay_dates_check CHECK (check_out > check_in),
  CONSTRAINT reservations_room_allocation_fkey FOREIGN KEY (room_id, room_type_id)
    REFERENCES rooms (id, room_type_id) ON DELETE RESTRICT,
  KEY reservations_room_stay_idx (room_id, check_in, check_out)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
