import type { AdminRoomTypeImage } from "../types";

/**
 * The order in which the admin panel edits a room type's images, as against
 * the order the API's own list returns them in.
 *
 * The API's list deliberately answers cover-first, then `sortOrder`, then an
 * internal deterministic tie-breaker — a presentation convenience for a
 * public gallery, where the cover should always lead regardless of where it
 * sits in the sequence. The Move Up / Move Down actions, however, are
 * defined purely against `sortOrder ASC`, with no idea a cover exists at
 * all: moving the last image "up" swaps its `sortOrder` with its immediate
 * predecessor. An editing UI that took its Move Up / Move Down boundaries
 * from the raw API array index would therefore disable the wrong button
 * whenever the cover is not already first by `sortOrder` — exactly the bug
 * this helper exists to rule out. Cover identity is shown separately, as a
 * badge, and never changes where an image sits in this order.
 *
 * `Array.prototype.sort` has been a stable sort since ES2019, so two images
 * that share a `sortOrder` — which the panel never itself produces, but the
 * API's own response is not required to rule out — keep the order the API
 * returned them in, with no second tie-breaker (an internal id, in
 * particular) needed to force it.
 *
 * The input is never mutated: `sort` acts on the copy this function makes,
 * not on the caller's own array.
 */
export function toEditingOrder(images: readonly AdminRoomTypeImage[]): AdminRoomTypeImage[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder);
}
