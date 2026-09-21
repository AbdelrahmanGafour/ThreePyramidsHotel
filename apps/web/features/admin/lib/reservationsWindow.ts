// Reading the paging position out of the URL.
//
// Page size is fixed for the administration list, so `offset` is the only thing
// the address bar carries. The API still accepts a limit — that is its contract
// — but this page does not offer page-size control, and a parameter nobody can
// change does not belong in a URL.
//
// Pure and framework-independent: plain values in, a number or null out.

export const RESERVATIONS_PAGE_SIZE = 25;

export const RESERVATIONS_PATH = "/admin/reservations";

// Digits only: the whole value must be the number, so "25abc", "2.5", "-1" and
// "" are rejected rather than coerced into something surprising.
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * Reads `?offset=`.
 *
 * Absent means the first page. Anything present must be a well-formed whole
 * number — including a repeated parameter, which arrives as an array and is
 * refused rather than resolved by picking one of two conflicting values.
 *
 * Returns null for an offset that cannot be served, which the page turns into a
 * redirect to the canonical first page.
 */
export function parseReservationsOffset(
  searchParams: Record<string, string | string[] | undefined>,
): number | null {
  const value = searchParams.offset;

  if (value === undefined) {
    return 0;
  }

  if (typeof value !== "string" || !WHOLE_NUMBER_PATTERN.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * The address for a given page, so every paging link is built one way.
 *
 * The first page is the bare path: its `?offset=0` would be noise, and two URLs
 * for one page is one more than a list needs.
 */
export function reservationsOffsetHref(offset: number): string {
  return offset <= 0 ? RESERVATIONS_PATH : `${RESERVATIONS_PATH}?offset=${offset}`;
}

/**
 * The address of one reservation. It lives here because this module already
 * owns the route's path, and a second copy of that string is a second thing to
 * keep in step.
 *
 * The reference is encoded as one path segment: it is data, and a stray slash
 * in it must not become part of the URL's structure.
 */
export function reservationDetailHref(bookingReference: string): string {
  return `${RESERVATIONS_PATH}/${encodeURIComponent(bookingReference)}`;
}
