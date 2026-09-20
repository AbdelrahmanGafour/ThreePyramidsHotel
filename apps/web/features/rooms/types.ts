// Types for the backend's public room API contract
// (GET /api/v1/rooms, GET /api/v1/rooms/:slug), mirrored from
// apps/api/src/modules/rooms/rooms.types.ts. Only fields the backend
// actually returns belong here — never an invented fact.

/**
 * The exact shape returned for one room type, identically by both the list
 * and detail endpoints. PostgreSQL numeric columns (`sizeSqm`,
 * `baseNightlyRate`) arrive as strings so no precision is lost in transit.
 * `sizeSqm` (a size, not money) may be parsed to a number (see api.ts).
 * `baseNightlyRate` MUST remain the exact backend decimal string — money is
 * never converted into a floating-point source of truth.
 */
export type RoomTypeResponse = {
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  bedType: string | null;
  bedCount: number | null;
  sizeSqm: string | null;
  baseNightlyRate: string;
  view: string | null;
  currency: "EGP";
};

/** GET /api/v1/rooms success envelope. */
export type RoomListResponseBody = {
  data: RoomTypeResponse[];
};

/** GET /api/v1/rooms/:slug success envelope. */
export type RoomDetailResponseBody = {
  data: RoomTypeResponse;
};

/**
 * T03 display/view-model shape: a validated `RoomTypeResponse` with one
 * UI-convenience alias (`sleeps`, for `capacity`) and non-money numeric
 * strings parsed. `capacity`/`sizeSqm` are plain counts, not money, so
 * parsing them to numbers loses no precision that matters and creates no
 * second source of monetary truth.
 *
 * `baseNightlyRate` and `currency` are deliberately kept EXACTLY as the
 * backend returned them — a decimal string and the literal `"EGP"` — and are
 * never converted to a JavaScript number here. Money is never recreated or
 * normalized via floating-point arithmetic in this domain model; see
 * features/rooms/lib/money.ts for the one place a display string is derived
 * from `baseNightlyRate`, without ever treating the result as a new
 * authoritative value.
 */
export type RoomDisplay = {
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  /** UI compatibility alias for `capacity` — not a separate backend fact. */
  sleeps: number;
  bedType: string | null;
  bedCount: number | null;
  /** Parsed from the API's string `sizeSqm`; `null` preserved exactly as the backend permits. */
  sizeSqm: number | null;
  view: string | null;
  /** The backend's exact decimal string — never parsed to a number here. */
  baseNightlyRate: string;
  currency: "EGP";
};
