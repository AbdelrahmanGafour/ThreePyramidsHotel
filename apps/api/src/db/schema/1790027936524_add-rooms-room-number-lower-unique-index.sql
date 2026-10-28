-- room_number already uses a case-insensitive collation, so rooms_room_number_key
-- is case-insensitively unique. This index keeps the old name for code that
-- recognises it.
CREATE UNIQUE INDEX rooms_room_number_lower_key ON rooms (room_number)
