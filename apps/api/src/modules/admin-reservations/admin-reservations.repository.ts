import { dbPool } from '../../db/pool';
import type {
  AdminReservationDetail,
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

/**
 * One row of the detail query. Wider than the list row, and read only for a
 * single reservation an administrator asked for by reference.
 *
 * `nights` comes from PostgreSQL: subtracting two DATEs yields an integer
 * number of days, which for a half-open stay is exactly the nights slept.
 */
type AdminReservationDetailRow = {
  booking_reference: string;
  status: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  guest_country: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  room_type_slug: string;
  room_type_name: string;
  room_number: string;
  nightly_rate: string;
  total_amount: string;
  currency: string;
  special_requests: string | null;
  created_at: Date;
};

/**
 * The stored row said it was text and it was not. Like the status and currency
 * checks above, this guards against data the schema's NOT NULL constraints say
 * cannot exist, and fails loudly rather than rendering `undefined` at a guest's
 * name.
 */
function requireText(column: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Unexpected reservation ${column} from the database: expected text`);
  }

  return value;
}

/**
 * A count the schema constrains to whole numbers, with its own floor.
 *
 * The floor is explicit at each call because the reservation's counts genuinely
 * differ: `adults > 0` and `check_out > check_in` are CHECK constraints, so a
 * party with no adults or a stay of zero nights is impossible data, while
 * `children >= 0` is ordinary.
 */
function requireCount(column: string, value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `Unexpected reservation ${column} from the database: expected a whole number of at least ${minimum}`,
    );
  }

  return value;
}

function requireInstant(column: string, value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Unexpected reservation ${column} from the database: expected a timestamp`);
  }

  return value;
}

/**
 * Maps one row onto the locked detail contract, group by group.
 *
 * Every field is read and checked individually — nothing is spread — so the
 * shape the API promises is built here rather than inherited from whatever the
 * query happened to select. Money stays the exact string PostgreSQL returned:
 * `nightly_rate_snapshot` is the rate accepted at booking time, and neither it
 * nor the total is recomputed from the room type's price today.
 */
export function toAdminReservationDetail(row: AdminReservationDetailRow): AdminReservationDetail {
  return {
    bookingReference: requireText('booking_reference', row.booking_reference),
    status: toReservationStatus(requireText('status', row.status)),
    guest: {
      firstName: requireText('guest_first_name', row.guest_first_name),
      lastName: requireText('guest_last_name', row.guest_last_name),
      email: requireText('guest_email', row.guest_email),
      phone: requireText('guest_phone', row.guest_phone),
      country: requireText('guest_country', row.guest_country),
    },
    stay: {
      checkIn: requireText('check_in', row.check_in),
      checkOut: requireText('check_out', row.check_out),
      // A stay is at least one night and a party has at least one adult; the
      // schema's CHECK constraints say so, and a row claiming otherwise is a
      // data fault rather than something to render.
      nights: requireCount('nights', row.nights, 1),
      adults: requireCount('adults', row.adults, 1),
      children: requireCount('children', row.children, 0),
    },
    roomType: {
      slug: requireText('room type slug', row.room_type_slug),
      name: requireText('room type name', row.room_type_name),
    },
    room: {
      // The only place the API exposes a physical room, and only to an
      // authenticated administrator.
      number: requireText('room_number', row.room_number),
    },
    pricing: {
      nightlyRate: requireText('nightly_rate_snapshot', row.nightly_rate),
      totalAmount: requireText('total_amount', row.total_amount),
      currency: toCurrency(requireText('currency', row.currency)),
    },
    // Genuinely optional in the schema, so null is data rather than a fault.
    specialRequests:
      row.special_requests === null ? null : requireText('special_requests', row.special_requests),
    createdAt: requireInstant('created_at', row.created_at).toISOString(),
  };
}

/**
 * Reads one reservation by its booking reference.
 *
 * The reference is matched exactly: it is generated uppercase and stored as
 * given, so no LOWER, UPPER or ILIKE is involved and the unique index does the
 * work. The caller has already validated the reference's shape.
 *
 * Returns null only when no reservation has that reference. A row that exists
 * but cannot be trusted raises instead — a data fault is a server problem, not
 * a missing booking.
 */
export async function findAdminReservationByReference(
  bookingReference: string,
): Promise<AdminReservationDetail | null> {
  const { rows } = await dbPool.query<AdminReservationDetailRow>(
    `SELECT r.booking_reference,
            r.status,
            r.guest_first_name,
            r.guest_last_name,
            r.guest_email,
            r.guest_phone,
            r.guest_country,
            -- ::text keeps calendar days exactly as stored. Read as a Date
            -- they would shift by a day in a negative-offset timezone.
            r.check_in::text AS check_in,
            r.check_out::text AS check_out,
            -- DATE minus DATE is an integer count of days, and the stay is
            -- half-open, so that count is exactly the nights slept.
            (r.check_out - r.check_in) AS nights,
            r.adults,
            r.children,
            rt.slug AS room_type_slug,
            rt.name AS room_type_name,
            rm.room_number,
            -- The rate accepted at booking time, never the room type's today.
            r.nightly_rate_snapshot::text AS nightly_rate,
            r.total_amount::text AS total_amount,
            r.currency,
            r.special_requests,
            r.created_at
       FROM reservations r
       -- Both joins are safe: room_type_id and room_id are NOT NULL and
       -- foreign-key backed, so neither can drop the reservation.
       JOIN room_types rt ON rt.id = r.room_type_id
       JOIN rooms rm ON rm.id = r.room_id
      WHERE r.booking_reference = $1`,
    [bookingReference],
  );

  const row = rows[0];

  // booking_reference is unique, so there is at most one row to find.
  return row ? toAdminReservationDetail(row) : null;
}
