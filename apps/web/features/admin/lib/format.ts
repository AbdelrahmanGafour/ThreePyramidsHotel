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

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export const formatDayMonth = (iso: string) => dayMonth.format(toUtc(iso));
export const formatLongDate = (iso: string) => longDate.format(toUtc(iso));

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
