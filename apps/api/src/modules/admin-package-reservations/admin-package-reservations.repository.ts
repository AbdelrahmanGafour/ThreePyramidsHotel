import type { QueryResult, QueryResultRow } from '../../db/pool';
import { dbPool } from '../../db/pool';
import { allowedSourceStatusesFor } from './admin-package-reservations.status';
import type {
  AdminPackageReservationDetail,
  AdminPackageReservationList,
  AdminPackageReservationListItem,
  AdminPackageReservationPricingStatus,
  AdminPackageReservationStatus,
  AdminPackageReservationStatusTarget,
} from './admin-package-reservations.types';

/**
 * One row of the list query, named exactly as PostgreSQL returns it.
 *
 * `tour_date` and the money columns are cast to text in SQL so they arrive as
 * strings whatever type parsers are configured: a calendar day read as a Date
 * shifts by a day in a negative-offset timezone, and numeric money read as a
 * float cannot represent values like 999.99 exactly. `created_at` is left a
 * timestamptz and arrives as a Date — it is an absolute instant with no
 * timezone ambiguity to preserve.
 */
type AdminPackageReservationListRow = {
  booking_reference: string;
  package_code_snapshot: string;
  package_slug: string;
  package_title_snapshot: string;
  variant_key: string;
  variant_label_snapshot: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  tour_date: string;
  adults: number;
  children: number;
  status: string;
  pricing_status: string;
  currency: string;
  total_amount_snapshot: string | null;
  created_at: Date;
};

/**
 * What this module needs from a database handle, and nothing more.
 *
 * Read-only and single-statement, so a `PoolClient` would mean borrowing a
 * connection and owning its release for no gain.
 */
type Queryable = {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

let queryable: Queryable = dbPool;

/** Swaps the database handle for a test double. Null restores the real pool. */
export function __setQueryableForTests(handle: Queryable | null): void {
  queryable = handle ?? dbPool;
}

const STATUSES: readonly AdminPackageReservationStatus[] = ['pending', 'confirmed', 'cancelled'];
const PRICING_STATUSES: readonly AdminPackageReservationPricingStatus[] = [
  'quoted',
  'requires_confirmation',
];

/**
 * The three narrowing checks below guard against stored data the schema's own
 * CHECK constraints say cannot exist. If one fires it is a data or migration
 * problem, so it raises a server error rather than being softened into a
 * default — and it narrows the row's plain strings to the contract's literal
 * types without an unchecked assertion.
 */
function toStatus(value: string): AdminPackageReservationStatus {
  const status = STATUSES.find((candidate) => candidate === value);

  if (!status) {
    throw new Error(`Unexpected package reservation status from the database: ${value}`);
  }

  return status;
}

function toPricingStatus(value: string): AdminPackageReservationPricingStatus {
  const pricingStatus = PRICING_STATUSES.find((candidate) => candidate === value);

  if (!pricingStatus) {
    throw new Error(`Unexpected package reservation pricing status from the database: ${value}`);
  }

  return pricingStatus;
}

function toCurrency(value: string): 'USD' {
  if (value !== 'USD') {
    throw new Error(`Unexpected package reservation currency from the database: ${value}`);
  }

  return value;
}

/**
 * Maps one row onto the locked list contract, field by field and never spread.
 *
 * The guest's two name columns become one `guestName`, so no caller has to
 * assemble a name. `total_amount_snapshot` passes straight through, including
 * its null: a confirmation-required reservation genuinely has no total, and
 * turning that into 0 or '' would state a price the hotel never quoted.
 */
export function toAdminPackageReservationListItem(
  row: AdminPackageReservationListRow,
): AdminPackageReservationListItem {
  const createdAt = row.created_at;

  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('Unexpected package reservation created_at from the database: invalid timestamp');
  }

  const pricingStatus = toPricingStatus(row.pricing_status);

  // The schema's pricing_total CHECK already ties these together; reading the
  // pair back the other way means a row that somehow broke it cannot be
  // reported as an ordinary reservation.
  if (pricingStatus === 'requires_confirmation' && row.total_amount_snapshot !== null) {
    throw new Error('Unexpected package reservation total: confirmation-required rows carry no total');
  }
  if (pricingStatus === 'quoted' && row.total_amount_snapshot === null) {
    throw new Error('Unexpected package reservation total: a quoted row must carry one');
  }

  return {
    bookingReference: row.booking_reference,
    package: {
      code: row.package_code_snapshot,
      slug: row.package_slug,
      title: row.package_title_snapshot,
    },
    variant: {
      key: row.variant_key,
      label: row.variant_label_snapshot,
    },
    guestName: `${row.guest_first_name} ${row.guest_last_name}`,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    tourDate: row.tour_date,
    adults: row.adults,
    children: row.children,
    status: toStatus(row.status),
    pricingStatus,
    currency: toCurrency(row.currency),
    totalAmountSnapshot: row.total_amount_snapshot,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Every package reservation, newest first.
 *
 * Unpaginated for this slice, deliberately and temporarily: the room
 * reservation list's limit/offset window brings its own validation module,
 * error code, count query and response envelope, and none of that is what
 * this endpoint is for yet. The response nests `reservations` under `data`
 * precisely so a `pagination` sibling can be added later without changing
 * the shape a caller already reads.
 *
 * Both joins are inner joins, which cannot drop a reservation: `variant_id`
 * and `package_id` are NOT NULL and backed by the composite foreign key to
 * `package_variants(id, package_id)`, and every variant has its package.
 *
 * Code, title and variant label come from the reservation's own snapshots —
 * what the guest booked, immune to a later catalogue edit. Slug and variant
 * key come from the live rows because they are addresses rather than facts
 * about the booking, and are what a later detail view will be reached by.
 */
export async function findAdminPackageReservations(): Promise<AdminPackageReservationList> {
  const { rows } = await queryable.query<AdminPackageReservationListRow>(
    `SELECT pr.booking_reference,
            pr.package_code_snapshot,
            p.slug AS package_slug,
            pr.package_title_snapshot,
            pv.key AS variant_key,
            pr.variant_label_snapshot,
            pr.guest_first_name,
            pr.guest_last_name,
            pr.guest_email,
            pr.guest_phone,
            -- ::text keeps the calendar day exactly as stored.
            pr.tour_date::text AS tour_date,
            pr.adults,
            pr.children,
            pr.status,
            pr.pricing_status,
            pr.currency,
            -- Exact two-decimal money as a string, never a float. NULL stays
            -- NULL: ::text on a NULL numeric is still NULL.
            pr.total_amount_snapshot::text AS total_amount_snapshot,
            pr.created_at
       FROM package_reservations pr
       JOIN package_variants pv ON pv.id = pr.variant_id AND pv.package_id = pr.package_id
       JOIN packages p ON p.id = pv.package_id
      -- id breaks created_at ties so the order is total rather than merely
      -- mostly-stable. No supporting index yet: this slice is correctness
      -- first, and an index is a migration.
      ORDER BY pr.created_at DESC, pr.id DESC`,
  );

  return { reservations: rows.map(toAdminPackageReservationListItem) };
}

/**
 * One row of the detail query. The list row plus the columns a list has no
 * business carrying, read only for a single reservation an administrator
 * asked for by reference.
 */
type AdminPackageReservationDetailRow = AdminPackageReservationListRow & {
  guest_country: string;
  child_ages: number[] | null;
  special_requests: string | null;
  adult_unit_rate_snapshot: string;
  child_unit_rate_snapshot: string | null;
};

/**
 * Narrows the stored child ages, or confirms their absence.
 *
 * The schema already states the rules — a one-dimensional array, no NULL
 * elements, non-negative, exactly `children` of them. Reading them back the
 * same way means a row that somehow broke one raises here instead of being
 * served as an ordinary reservation.
 */
function toChildAges(value: number[] | null, children: number): number[] | null {
  if (value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error('Unexpected package reservation child_ages from the database: not an array');
  }

  for (const age of value) {
    if (typeof age !== 'number' || !Number.isInteger(age) || age < 0) {
      throw new Error('Unexpected package reservation child_ages from the database: invalid age');
    }
  }

  if (value.length !== children) {
    throw new Error('Unexpected package reservation child_ages from the database: count mismatch');
  }

  return value;
}

/**
 * Maps one detail row onto the detail contract.
 *
 * Built on `toAdminPackageReservationListItem` rather than repeating its
 * fields, so every list field — and every check that guards it — applies here
 * unchanged, and the two contracts cannot drift apart.
 *
 * The money columns pass through as the exact strings PostgreSQL returned.
 * Nothing is recomputed from the live catalogue: these snapshots are what the
 * guest was quoted, and a repricing since then must not rewrite them.
 */
export function toAdminPackageReservationDetail(
  row: AdminPackageReservationDetailRow,
): AdminPackageReservationDetail {
  return {
    ...toAdminPackageReservationListItem(row),
    guestCountry: row.guest_country,
    childAges: toChildAges(row.child_ages, row.children),
    specialRequests: row.special_requests,
    adultUnitRateSnapshot: row.adult_unit_rate_snapshot,
    childUnitRateSnapshot: row.child_unit_rate_snapshot,
  };
}

/**
 * Reads one package reservation by its booking reference.
 *
 * The reference arrives already validated and is used exactly as given: it is
 * a bound parameter, never interpolated, and never normalised.
 *
 * Returns null only when no reservation has that reference. A stored row that
 * cannot be trusted raises from the mappers above instead, so a data fault
 * never reaches a caller disguised as a missing booking.
 *
 * `booking_reference` is UNIQUE, so this can match at most one row; LIMIT is
 * therefore absent rather than forgotten.
 */
export async function findAdminPackageReservationByReference(
  bookingReference: string,
): Promise<AdminPackageReservationDetail | null> {
  const { rows } = await queryable.query<AdminPackageReservationDetailRow>(
    `SELECT pr.booking_reference,
            pr.package_code_snapshot,
            p.slug AS package_slug,
            pr.package_title_snapshot,
            pv.key AS variant_key,
            pr.variant_label_snapshot,
            pr.guest_first_name,
            pr.guest_last_name,
            pr.guest_email,
            pr.guest_phone,
            pr.guest_country,
            pr.tour_date::text AS tour_date,
            pr.adults,
            pr.children,
            pr.child_ages,
            pr.special_requests,
            pr.status,
            pr.pricing_status,
            pr.currency,
            -- Exact two-decimal money as strings, never floats. A NULL
            -- numeric stays NULL through ::text.
            pr.adult_unit_rate_snapshot::text AS adult_unit_rate_snapshot,
            pr.child_unit_rate_snapshot::text AS child_unit_rate_snapshot,
            pr.total_amount_snapshot::text AS total_amount_snapshot,
            pr.created_at
       FROM package_reservations pr
       JOIN package_variants pv ON pv.id = pr.variant_id AND pv.package_id = pr.package_id
       JOIN packages p ON p.id = pv.package_id
      WHERE pr.booking_reference = $1`,
    [bookingReference],
  );

  const row = rows[0];

  return row ? toAdminPackageReservationDetail(row) : null;
}

/** What the write attempt found, before any HTTP meaning is attached to it. */
export type AdminPackageReservationStatusChange =
  | { outcome: 'updated'; reservation: AdminPackageReservationDetail }
  | { outcome: 'not-found' }
  | { outcome: 'invalid-transition' };

/**
 * Moves one reservation to `nextStatus`, if the rule allows it from wherever
 * it is now.
 *
 * ONE statement does the whole job. The UPDATE is guarded by
 * `status = ANY($3)` — the allowed source states, read from
 * `allowedSourceStatusesFor` rather than restated here — so the transition
 * rule is enforced by the write itself rather than by a check that happened
 * earlier and might no longer hold.
 *
 * That is what makes it safe against concurrent transitions. Two
 * administrators confirming and cancelling the same pending reservation at
 * the same instant both reach the UPDATE; PostgreSQL gives the row lock to
 * one, and when the second acquires it, it re-evaluates the WHERE clause
 * against the now-committed row. The status is no longer in the allowed set,
 * so the second matches zero rows and is refused. Neither can overwrite a
 * terminal state, and no read-then-write window exists for them to race in.
 *
 * No BEGIN/COMMIT: a single statement is already atomic, so this path never
 * has a commit whose outcome could be unknown. The public reservation POST
 * path keeps its own transaction and its own uncertainty handling, untouched.
 *
 * The CTE returns the updated row and the outer SELECT joins it to its
 * package and variant, so the caller gets the full detail without a second
 * read that could observe a different state. `RETURNING *` feeds only the
 * explicit projection below — that projection, and the mapper it feeds, are
 * what decide which columns can ever leave this module.
 *
 * Only `status` and `updated_at` are written on the reservation. Every
 * snapshot column is untouched, and no price is recomputed.
 *
 * ---------------------------------------------------------------------------
 * THE GUEST'S CONFIRMATION RIDES IN THE SAME STATEMENT
 *
 * `notification_event` is a data-modifying CTE, not a second query, because
 * this path has no transaction to put a second query in. One statement is
 * already atomic, so the status change and the message the guest is owed
 * commit together or not at all — the same guarantee the room and journey
 * creation paths get from a transaction, obtained here without opening one.
 *
 * It selects `FROM updated`, so it is strictly dependent on the UPDATE:
 *
 *   * the UPDATE matched nothing (not found, or a refused transition) —
 *     `updated` is empty, the INSERT inserts no rows, and no event exists for
 *     a change that never happened;
 *   * the UPDATE matched but this is a cancellation — `WHERE u.status =
 *     'confirmed'` excludes it. A cancellation is a different conversation and
 *     a different event, and this slice owes the guest nothing when a booking
 *     is called off;
 *   * the UPDATE confirmed the booking — exactly one row is selected, so
 *     exactly one event is written.
 *
 * Nothing references `notification_event` in the outer SELECT and nothing
 * needs to: PostgreSQL executes a data-modifying WITH clause exactly once and
 * always to completion, whether or not the primary query reads its output. It
 * cannot be optimised away, and adding a reference would only distort the
 * result set.
 *
 * Strict, and allowed to be fatal. No `ON CONFLICT`: a conflict on
 * `UNIQUE (event_type, booking_reference)` means a second confirmation event
 * for a booking reference that is unique forever, which has no benign reading.
 * Because it is one statement, that error aborts the whole thing — the status
 * change included — and propagates untranslated. An administrator who sees an
 * error and retries costs less than a guest who is never told their journey
 * was confirmed.
 *
 * The payload is built by `jsonb_build_object` here rather than by
 * `buildPackageReservationConfirmedEvent` in the service, because the event
 * cannot be assembled in TypeScript without first reading the row back —
 * which would be the second statement this design exists to avoid. It must
 * therefore match that builder's contract field for field, and a test pins the
 * two together. Money keeps its exact stored decimals via `::text`, the tour
 * date stays a calendar day, and the guest's address goes to `recipient_email`
 * only — a confirmation does not read a person their own address back.
 */
export async function updateAdminPackageReservationStatus(
  bookingReference: string,
  nextStatus: AdminPackageReservationStatusTarget,
): Promise<AdminPackageReservationStatusChange> {
  const { rows } = await queryable.query<AdminPackageReservationDetailRow>(
    `WITH updated AS (
       UPDATE package_reservations
          SET status = $2,
              updated_at = now()
        WHERE booking_reference = $1
          AND status = ANY($3::text[])
       RETURNING *
     ),
     notification_event AS (
       INSERT INTO notification_outbox
         (event_type, booking_reference, recipient_kind, recipient_email, template_key, payload)
       SELECT 'package_reservation_confirmed',
              u.booking_reference,
              'guest',
              u.guest_email,
              'package_confirmed_guest.v1',
              jsonb_build_object(
                'bookingReference', u.booking_reference,
                'guestFirstName', u.guest_first_name,
                'guestLastName', u.guest_last_name,
                'packageTitle', u.package_title_snapshot,
                'variantLabel', u.variant_label_snapshot,
                'tourDate', u.tour_date::text,
                'adults', u.adults,
                'children', u.children,
                'pricingStatus', u.pricing_status,
                'adultUnitRate', u.adult_unit_rate_snapshot::text,
                'childUnitRate', u.child_unit_rate_snapshot::text,
                'totalAmount', u.total_amount_snapshot::text,
                'currency', 'USD'::text,
                'specialRequests', u.special_requests
              )
         FROM updated u
        WHERE u.status = 'confirmed'
     )
     SELECT u.booking_reference,
            u.package_code_snapshot,
            p.slug AS package_slug,
            u.package_title_snapshot,
            pv.key AS variant_key,
            u.variant_label_snapshot,
            u.guest_first_name,
            u.guest_last_name,
            u.guest_email,
            u.guest_phone,
            u.guest_country,
            u.tour_date::text AS tour_date,
            u.adults,
            u.children,
            u.child_ages,
            u.special_requests,
            u.status,
            u.pricing_status,
            u.currency,
            u.adult_unit_rate_snapshot::text AS adult_unit_rate_snapshot,
            u.child_unit_rate_snapshot::text AS child_unit_rate_snapshot,
            u.total_amount_snapshot::text AS total_amount_snapshot,
            u.created_at
       FROM updated u
       JOIN package_variants pv ON pv.id = u.variant_id AND pv.package_id = u.package_id
       JOIN packages p ON p.id = pv.package_id`,
    [bookingReference, nextStatus, allowedSourceStatusesFor(nextStatus)],
  );

  const row = rows[0];

  if (row) {
    return { outcome: 'updated', reservation: toAdminPackageReservationDetail(row) };
  }

  // Nothing was updated. Telling the two reasons apart is a read, and only a
  // read: the write above has already settled, so this cannot change what
  // happened — it only decides whether the administrator is told 404 or 409.
  const { rows: existing } = await queryable.query<{ booking_reference: string }>(
    'SELECT booking_reference FROM package_reservations WHERE booking_reference = $1',
    [bookingReference],
  );

  return existing[0] ? { outcome: 'invalid-transition' } : { outcome: 'not-found' };
}
