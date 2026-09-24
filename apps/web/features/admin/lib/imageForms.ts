import type { AdminRoomTypeImageUploadInput, MediaOrderDirection } from "../server/adminRoomTypeImagesApi";

/**
 * Turning submitted image-management input into the typed payloads the media
 * API client sends.
 *
 * Pure: no request context, no network, no `next/*`. A Server Action cannot
 * be imported under a plain Node test without Next's request context, so
 * everything here that *decides* something lives outside one and is tested
 * directly — matching `inventoryForms.ts` exactly.
 *
 * These parsers are **not** a second copy of the API's validation contract.
 * The API remains authoritative on what counts as an acceptable image, an
 * acceptable alt text, or a valid image reference. What lives here is
 * narrower: reading only the one field an operation is allowed to read, and —
 * for `image` specifically — the one conversion a `File` needs before it can
 * become an HTTP request body at all.
 */

/** A parse either produced a payload or refused it. No third possibility. */
export type FormParse<T> = { ok: true; value: T } | { ok: false };

const REFUSED: FormParse<never> = { ok: false };

/** The upload form's one field name, locked by the API contract this feeds. */
const IMAGE_FIELD = "image";
const ALT_TEXT_FIELD = "altText";

/**
 * Reads the upload form's one field, requiring a `File` — never the existing
 * string-only field reader, which exists specifically to *reject* one.
 *
 * `undefined`/absent, and a string masquerading as the field (a browser never
 * sends one for a `<input type="file">`, but a crafted request could), are
 * both refused the same way: neither is a file this form can send.
 */
function fileField(form: FormData, name: string): File | null {
  const value = form.get(name);

  return value instanceof File ? value : null;
}

/**
 * Converts one submitted image into the API client's raw-upload input.
 *
 * `file.arrayBuffer()` reads the file's bytes into memory once; `Buffer.from`
 * wraps them without copying. Nothing about the file's *name* — not
 * `file.name`, not `webkitRelativePath`, not `lastModified` — is read at all:
 * none of it is media identity, and none of it reaches the API. `file.type`
 * is carried through exactly as the browser reported it — not lower-cased,
 * not trimmed, not guessed at when empty — because the domain rule on the
 * other side of this request owns what counts as an accepted declaration, not
 * this parser.
 *
 * Async because reading the bytes is the one genuinely asynchronous thing
 * this module does; everything else here is synchronous.
 */
export async function parseImageUploadForm(
  form: FormData,
): Promise<FormParse<AdminRoomTypeImageUploadInput>> {
  const file = fileField(form, IMAGE_FIELD);

  if (file === null) {
    return REFUSED;
  }

  const bytes = await file.arrayBuffer();

  return { ok: true, value: { body: Buffer.from(bytes), contentType: file.type } };
}

/**
 * Reads the alt-text form's one field, exactly as submitted.
 *
 * Not trimmed, not normalised, and an empty or whitespace-only string is a
 * value this function accepts and passes on — the API is the one place
 * `normalizeAltText` runs, turning any of those into `null` on that side.
 * Repeating that rule here would be a second copy able to disagree with the
 * first.
 */
export function parseAltTextForm(form: FormData): FormParse<string> {
  const value = form.get(ALT_TEXT_FIELD);

  return typeof value === "string" ? { ok: true, value } : REFUSED;
}

/**
 * The one check a bound `direction` argument still needs before it reaches
 * the API.
 *
 * A Server Action's bound arguments are not a security boundary — Next
 * serialises them into the form's own payload, so a caller can still submit a
 * different value — and this is the exact rule the API itself enforces for
 * the same field, applied here only so a request built from a wildly wrong
 * value never leaves this process. Nothing is trimmed, lower-cased or
 * repaired: `"UP"`, `" down"` and anything else that is not one of these two
 * exact strings is refused rather than coerced into one of them.
 */
export function parseOrderDirection(value: string): MediaOrderDirection | null {
  return value === "up" || value === "down" ? value : null;
}
