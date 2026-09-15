// Small date helpers for the booking flow. Dates are stored as plain
// "YYYY-MM-DD" strings (what `<input type="date">` produces) — no date
// library needed for this scope.

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Nights between two ISO dates, or 0 if the range is invalid/incomplete. */
export function nightsBetween(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const start = parseISODate(checkIn);
  const end = parseISODate(checkOut);
  if (!start || !end) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export function isPastDate(value: string): boolean {
  const date = parseISODate(value);
  if (!date) return false;
  const today = parseISODate(todayISO());
  return Boolean(today && date.getTime() < today.getTime());
}

/** A stay is valid once both dates exist, neither is in the past, and check-out is after check-in. */
export function isValidStayRange(checkIn: string | null, checkOut: string | null): boolean {
  if (!checkIn || !checkOut) return false;
  if (isPastDate(checkIn) || isPastDate(checkOut)) return false;
  return nightsBetween(checkIn, checkOut) > 0;
}

export function formatDateLabel(value: string | null): string {
  const date = value ? parseISODate(value) : null;
  if (!date) return "Choose date";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
