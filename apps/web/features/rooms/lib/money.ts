// Formats a backend-authoritative nightly rate for display without ever
// converting the decimal string to a JavaScript number — the backend's
// string is the source of truth and is never recreated, rounded, or
// normalized via floating-point arithmetic (WFI-T03 money-safety rule).

/** e.g. formatRoomRate("1000.00", "EGP") -> "EGP 1000.00" */
export function formatRoomRate(baseNightlyRate: string, currency: string): string {
  return `${currency} ${baseNightlyRate}`;
}
