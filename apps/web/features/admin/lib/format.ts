// Deterministic date formatting (UTC, fixed locale) so server and client
// render identical text. Inputs are hotel wall-clock values, not instants.

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const instantDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  // Renders as "UTC", so the clock is never left to the reader's guess.
  timeZoneName: "short",
});

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export const formatDayMonth = (iso: string) => dayMonth.format(toUtc(iso));
export const formatLongDate = (iso: string) => longDate.format(toUtc(iso));

/**
 * "18 Sep 2026" — for real reservations, where the year matters because stays
 * are not all in the current one.
 *
 * Takes a calendar day ("2026-09-18") or an ISO instant, of which only the UTC
 * date part is read. An instant is therefore shown as its UTC day, not the
 * viewer's: deliberate, so the server and the browser never disagree.
 */
export const formatDateWithYear = (iso: string) => dayMonthYear.format(toUtc(iso));

/**
 * "20 Sept 2026, 18:45 UTC" — an instant, shown as both date and time.
 *
 * Unlike the calendar-day formatters above, the whole ISO string is handed to
 * `Date` rather than sliced: this is a moment, not a day, and its time matters.
 * UTC is stated in the output rather than assumed, because a reader in Cairo
 * would otherwise have no way to know which clock they are looking at. A hotel
 * timezone is a later decision; until then the zone is at least explicit.
 */
export function formatInstant(iso: string): string {
  const instant = new Date(iso);

  // An unparseable value would make Intl throw; the raw string is more useful
  // on screen than a crashed page.
  return Number.isNaN(instant.getTime()) ? iso : instantDateTime.format(instant);
}

/**
 * Exact EGP money, from the decimal string the API returns.
 *
 * The string is grouped and reassembled as text: parsing it into a number to
 * format it would reintroduce exactly the float error the whole money path
 * exists to avoid. An unexpected shape is shown unchanged rather than mangled.
 */
export function formatEgp(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);

  if (!match) {
    return `EGP ${amount}`;
  }

  const [, sign, whole, fraction = "00"] = match;
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `EGP ${sign}${grouped}.${fraction.padEnd(2, "0")}`;
}

export const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((toUtc(toIso).getTime() - toUtc(fromIso).getTime()) / DAY_MS);

/**
 * Initials for the identity mark, from whatever the account's display name
 * happens to be: one letter for a single word, first and last for several,
 * nothing at all if the name is blank. Split by code point, so an accented or
 * non-Latin first character survives intact.
 */
export function initialsFromName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "";
  }

  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";

  return `${first}${last}`.toUpperCase();
}

/** "Today, 09:12" / "Yesterday, 16:25" / "16 Sep, 18:30". */
export function formatReceived(receivedAt: string, todayIso: string) {
  const time = receivedAt.slice(11, 16);
  const diff = daysBetween(receivedAt, todayIso);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return `${formatDayMonth(receivedAt)}, ${time}`;
}
