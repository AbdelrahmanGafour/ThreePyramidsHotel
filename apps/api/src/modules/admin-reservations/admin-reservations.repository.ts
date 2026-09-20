import { dbPool } from '../../db/pool';
import type {
  AdminReservationListItem,
  AdminReservationListQuery,
  AdminReservationStatus,
} from './admin-reservations.types';

/**
 * One row of the page query, named exactly as PostgreSQL returns it.
 *
 * `check_in`, `check_out` and `total_amount` are cast to text in SQL, so they
 * arrive as strings whatever type parsers are configured. `created_at` is left
 * as a timestamptz and arrives as a `Date`: it is an absolute instant, not a
 * calendar day, and has no timezone ambiguity to preserve.
 */
type AdminReservationListRow = {
  booking_reference: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  room_type_slug: string;
  room_type_name: string;
  check_in: string;
  check_out: string;
  status: string;
  total_amount: string;
  currency: string;
  created_at: Date;
};

type CountRow = {
  /** COUNT(*) is a bigint; ::text keeps it exact on the way out of PostgreSQL. */
  total: string;
};

/** What the service needs, and nothing else: no HTTP envelope is built here. */
export type AdminReservationListPage = {
  reservations: AdminReservationListItem[];
  total: number;
};

const RESERVATION_STATUSES: readonly AdminReservationStatus[] = ['pending', 'confirmed', 'cancelled'];

const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * Both checks below guard against stored data that the schema's constraints say
 * cannot exist. If one ever fires it is a data or migration problem, so it
 * raises a server error rather than being softened into a default — and it
 * narrows the row's plain strings to the contract's literal types without an
 * unchecked assertion.
 */
function toReservationStatus(value: string): AdminReservationStatus {
  const status = RESERVATION_STATUSES.find((candidate) => candidate === value);

  if (!status) {
    throw new Error(`Unexpected reservation status from the database: ${value}`);
  }

  return status;
}

function toCurrency(value: string): 'EGP' {
  if (value !== 'EGP') {
    throw new Error(`Unexpected reservation currency from the database: ${value}`);
  }

  return value;
}

/**
 * Maps one row onto the locked list contract.
 *
 * The guest's two name columns become one `guestName`, so no caller has to
 * assemble a name. `totalAmount` is passed through exactly as PostgreSQL
 * returned it: numeric money is never converted to a JavaScript number, which
 * cannot represent values like 999.99 exactly.
 */
export function toAdminReservationListItem(row: AdminReservationListRow): AdminReservationListItem {
  const createdAt = row.created_at;

  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('Unexpected reservation created_at from the database: invalid timestamp');
  }

  return {
    bookingReference: row.booking_reference,
    guestName: `${row.guest_first_name} ${row.guest_last_name}`,
    guestEmail: row.guest_email,
    roomType: {
      slug: row.room_type_slug,
      name: row.room_type_name,
    },
    checkIn: row.check_in,
    checkOut: row.check_out,
    status: toReservationStatus(row.status),
    totalAmount: row.total_amount,
    currency: toCurrency(row.currency),
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Turns the counted bigint into the plain number the pagination contract uses.
 *
 * Accepts only a digits-only string — the form `COUNT(*)::text` always takes —
 * and refuses anything that would not survive the conversion exactly, rather
 * than reporting a total that is quietly wrong.
 */
export function parseTotalCount(value: unknown): number {
  if (typeof value !== 'string' || !WHOLE_NUMBER_PATTERN.test(value)) {
    throw new Error(`Unexpected reservation count from the database: ${String(value)}`);
  }

  const total = Number(value);

  if (!Number.isSafeInteger(total)) {
    throw new Error(`Reservation count exceeds exact integer arithmetic: ${value}`);
  }

  return total;
}

/**
 * Reads one page of reservations, newest first, together with the full count.
 *
 * Takes an already-validated window: raw Express query values never reach this
 * module. LIMIT and OFFSET are bound parameters, never interpolated.
 *
 * The count is its own statement rather than `COUNT(*) OVER ()`, which would
 * return no rows at all — and so no total — for an offset past the last
 * reservation. The two statements are not wrapped in a transaction: a booking
 * taken between them can make `total` differ from the page by one, which is
 * harmless in an operational list and not worth holding a snapshot for.
 */
export async function findAdminReservationPage({
  limit,
  offset,
}: AdminReservationListQuery): Promise<AdminReservationListPage> {
  const [page, count] = await Promise.all([
    dbPool.query<AdminReservationListRow>(
      `SELECT r.booking_reference,
              r.guest_first_name,
              r.guest_last_name,
              r.guest_email,
              rt.slug AS room_type_slug,
              rt.name AS room_type_name,
              -- ::text keeps calendar days exactly as stored. Read as a Date
              -- they would shift by a day in a negative-offset timezone.
              r.check_in::text AS check_in,
              r.check_out::text AS check_out,
              r.status,
              -- Exact two-decimal money as a string, never a float.
              r.total_amount::text AS total_amount,
              r.currency,
              r.created_at
         FROM reservations r
         -- Inner join is safe: room_type_id is NOT NULL and foreign-key backed,
         -- so this can never drop a reservation from the list.
         JOIN room_types rt ON rt.id = r.room_type_id
        -- The one fixed order, matched by reservations_created_at_id_idx. id
        -- breaks created_at ties so paging never repeats or skips a row.
        ORDER BY r.created_at DESC, r.id DESC
        -- ::bigint states the type LIMIT/OFFSET expect, rather than leaving it
        -- to inference on a bare parameter.
        LIMIT $1::bigint
       OFFSET $2::bigint`,
      [limit, offset],
    ),
    dbPool.query<CountRow>(`SELECT COUNT(*)::text AS total FROM reservations`),
  ]);

  return {
    reservations: page.rows.map(toAdminReservationListItem),
    total: parseTotalCount(count.rows[0]?.total),
  };
}
