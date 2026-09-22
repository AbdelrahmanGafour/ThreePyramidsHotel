/**
 * Case-insensitive uniqueness for physical room numbers.
 *
 * `rooms_room_number_key` already makes `room_number` unique exactly, which
 * leaves `D-101` and `d-101` free to coexist as two different rooms. They are
 * not two rooms — a room number is typed by a person, and a hotel that has a
 * room called `D-101` does not also have one called `d-101`. Admitting both
 * would mean an allocated room could be identified two ways, and the pair
 * would sort apart in the allocator's `ORDER BY room_number`.
 *
 * The exact index is deliberately kept alongside this one. It is the cheaper
 * lookup for an exact-match query, and dropping it would widen this migration
 * from "add an invariant" to "replace one", which is a different review.
 *
 * Nothing here normalises stored values. Case is preserved exactly as it was
 * entered — this constrains which room numbers may coexist, not how any of
 * them is written.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const INDEX_NAME = 'rooms_room_number_lower_key';

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Checked before the index is created, purely so the failure is legible.
  // CREATE UNIQUE INDEX would refuse a colliding table on its own, but it
  // reports one offending value and a constraint name, which reads as a bug
  // in the migration rather than as a data problem someone has to go and fix.
  //
  // It reports how many collisions there are, not what they are: no existing
  // migration puts row data into an error, and a count plus the query that
  // finds them is what an operator actually needs.
  //
  // This never repairs anything. Which of two rooms keeps its number is a
  // decision about real inventory — the rooms may hold different reservations
  // — and a migration is the wrong place to make it silently.
  pgm.sql(`
    DO $$
    DECLARE
      collision_count integer;
    BEGIN
      SELECT count(*) INTO collision_count
        FROM (
          SELECT lower(room_number)
            FROM rooms
           GROUP BY lower(room_number)
          HAVING count(*) > 1
        ) AS collisions;

      IF collision_count > 0 THEN
        RAISE EXCEPTION
          'Cannot add case-insensitive room number uniqueness: % set(s) of rooms have room numbers that differ only by letter case.',
          collision_count
          USING HINT = 'Resolve them by hand first; this migration will not rename, delete or pick a winner. Find them with: SELECT lower(room_number), count(*) FROM rooms GROUP BY 1 HAVING count(*) > 1;';
      END IF;
    END
    $$;
  `);

  // Raw SQL, as the reservations migration does for its exclusion constraint:
  // the indexed expression is the whole point of this migration and is clearer
  // stated than assembled.
  //
  // Not CONCURRENTLY: this repository runs migrations inside a transaction,
  // which CONCURRENTLY cannot do. The table is small and the write lock it
  // takes is momentary.
  pgm.sql(`CREATE UNIQUE INDEX "${INDEX_NAME}" ON "rooms" (lower(room_number));`);
};

/**
 * Removes only the invariant this migration added.
 *
 * `rooms_room_number_key`, the rooms table and every row in it — and every
 * reservation pointing at one — are untouched. After this runs, `D-101` and
 * `d-101` may coexist again; nothing that was stored while the index existed
 * becomes invalid.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX "${INDEX_NAME}";`);
};
