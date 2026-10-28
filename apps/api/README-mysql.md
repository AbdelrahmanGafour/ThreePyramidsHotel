# MySQL setup

The API targets MySQL 8.0.30 (InnoDB, utf8mb4, `utf8mb4_0900_ai_ci`).

- `DATABASE_URL=mysql://hotel:hotel@127.0.0.1:3307/hotel_reservation`
- Schema: `src/db/schema/*.sql`, applied in filename order by `npm run migrate:up`
  (`src/db/migrate.ts`). Applied files are recorded in `schema_migrations`.
  Statements inside a file are separated by a line containing only `-- ;;`.
  MySQL DDL is not transactional: if a file fails midway, fix the cause and
  apply the remaining statements by hand before re-running.
- Seeds: `npm run seed:dev`, `npm run seed:packages`, `npm run admin:create`
  (needs `ADMIN_EMAIL`, `ADMIN_DISPLAY_NAME`, `ADMIN_PASSWORD`).
- Test database: create `hotel_test`, grant to `hotel`, run `migrate:up` with
  `DATABASE_URL` pointing at it.

Constraints MySQL cannot express, enforced by the application instead:
- `reservations_no_overlapping_active_stays` (lock the room row, check overlap).
- `package_rate_tiers_no_overlap` (lock the variant row, check party-size overlap).

Emulations: partial unique indexes (`room_type_images_cover_key`,
`package_variants_one_default_per_package_idx`) use an invisible generated
column that is NULL unless the flag is set. `rooms_room_number_lower_key` is a
plain unique index (the collation is already case-insensitive).
