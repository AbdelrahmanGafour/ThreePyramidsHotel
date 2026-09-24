import { randomUUID } from 'node:crypto';
import {
  MAX_ALT_TEXT_LENGTH,
  MAX_ROOM_TYPE_IMAGES,
  MAX_SOURCE_BYTES,
  MEDIA_ORDER_DIRECTIONS,
  MEDIA_REFERENCE_PATTERN,
  MEDIA_STORAGE_KEY_EXTENSION,
  MEDIA_STORAGE_KEY_PREFIX,
  SOURCE_CONTENT_TYPES,
  type AltTextCheck,
  type ImageCountCheck,
  type MediaOrderDirection,
  type MediaReference,
  type SourceByteSizeCheck,
  type SourceContentType,
  type SourceUploadCheck,
} from './media.types';

/**
 * Every media rule that can be decided from a value alone.
 *
 * Pure throughout: no database, no Express, no filesystem, no network, no
 * credential, and no image decoder. Each function takes what it is given and
 * answers; nothing here reaches for `process.env` or for the clock.
 *
 * The one deliberate exception to "takes what it is given" is
 * `createMediaReference`, which draws from the platform's CSPRNG. It is here
 * rather than in a service because a reference is a media-domain fact, and
 * because its shape and its generator must agree — the pattern below is the
 * form `crypto.randomUUID()` produces, and the two would drift if they lived
 * apart.
 */

// ---------------------------------------------------------------------------
// Source content types
// ---------------------------------------------------------------------------

/**
 * Whether a declared `Content-Type` is one this API accepts.
 *
 * Matched exactly: not lower-cased, not trimmed, and parameters are not
 * stripped. `IMAGE/JPEG` and `image/jpeg; charset=utf-8` are therefore
 * refused. The only client is this project's own admin action, which forwards
 * a browser `File.type` — always lowercase and always bare — so a header that
 * needs repairing did not come from the path this endpoint serves.
 */
export function isSourceContentType(value: unknown): value is SourceContentType {
  return typeof value === 'string' && (SOURCE_CONTENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Magic bytes
// ---------------------------------------------------------------------------

/** FF D8 FF — the start of every JPEG, whatever the marker that follows. */
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** The fixed eight-byte PNG header, including the CRLF/EOF trap bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A RIFF container ("RIFF" at 0, four length bytes) whose form is "WEBP" at 8. */
const RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii');
const WEBP_FORM = Buffer.from('WEBP', 'ascii');
const WEBP_HEADER_LENGTH = 12;

/**
 * The accepted type these bytes begin with, or `null`.
 *
 * A PRE-FILTER, and nothing more. A matching signature proves only that the
 * first few bytes are right; it does not prove the file decodes, that it is
 * not truncated, that it is not animated or multi-page, what its dimensions
 * are, or that it is safe. An animated WebP and a corrupt JPEG both sniff
 * cleanly here, and both must still be refused later.
 *
 * Sharp is the authority for all of that, and it runs after this. What this
 * function buys is a cheap, dependency-free refusal of the obvious cases —
 * SVG, GIF, an HTML error page, a text file, an empty body — before anything
 * larger is attempted. Treating it as a security boundary would be a mistake.
 *
 * The RIFF check reads the form at bytes 8..11 as well as the tag at 0..3,
 * because WAV and AVI are RIFF containers too and neither is an image.
 */
export function sniffSourceContentType(bytes: Buffer): SourceContentType | null {
  if (!Buffer.isBuffer(bytes)) {
    return null;
  }

  if (bytes.length >= JPEG_SIGNATURE.length && bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }

  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (
    bytes.length >= WEBP_HEADER_LENGTH &&
    bytes.subarray(0, 4).equals(RIFF_SIGNATURE) &&
    bytes.subarray(8, 12).equals(WEBP_FORM)
  ) {
    return 'image/webp';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Byte size
// ---------------------------------------------------------------------------

/**
 * The source byte rule on its own: more than nothing, and no more than 8 MiB.
 *
 * Exactly `MAX_SOURCE_BYTES` is accepted; one byte beyond it is not. A count
 * that is not a whole non-negative number is refused rather than compared,
 * because `NaN <= MAX` is false and `NaN > 0` is false too — a silent pass or
 * a misleading reason would be the alternative.
 */
export function checkSourceByteSize(byteSize: number): SourceByteSizeCheck {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    return { ok: false, reason: 'not-a-byte-count' };
  }

  if (byteSize === 0) {
    return { ok: false, reason: 'empty-body' };
  }

  if (byteSize > MAX_SOURCE_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// The whole source upload
// ---------------------------------------------------------------------------

/**
 * Every rule a source upload must pass before it is worth decoding.
 *
 * The order is fixed and deliberate, so one body always produces one answer:
 *
 *   1. a `Content-Type` was declared at all
 *   2. it is one of the three accepted types
 *   3. the body is not empty
 *   4. the body is within the byte ceiling
 *   5. the leading bytes match an accepted signature
 *   6. the signature is the type that was declared
 *
 * Checking the declaration first means an `image/svg+xml` upload is refused
 * for what it claims to be, whatever it carries, and that an oversized body is
 * never sniffed. Nothing is ever corrected: a declaration that disagrees with
 * the bytes is a rejection, not a value to be fixed up and stored. Either the
 * client is confused or the upload is not what it says, and neither is
 * something to resolve on the client's behalf.
 */
export function checkSourceUpload(declaredContentType: unknown, bytes: Buffer): SourceUploadCheck {
  if (declaredContentType === undefined || declaredContentType === null || declaredContentType === '') {
    return { ok: false, reason: 'missing-content-type' };
  }

  if (!isSourceContentType(declaredContentType)) {
    return { ok: false, reason: 'unsupported-content-type' };
  }

  const size = checkSourceByteSize(Buffer.isBuffer(bytes) ? bytes.length : Number.NaN);

  if (!size.ok) {
    // A body that is not a Buffer has no byte count to report, and is treated
    // as the empty body it effectively is for this endpoint's purposes.
    return { ok: false, reason: size.reason === 'not-a-byte-count' ? 'empty-body' : size.reason };
  }

  const sniffed = sniffSourceContentType(bytes);

  if (sniffed === null) {
    return { ok: false, reason: 'unreadable-signature' };
  }

  if (sniffed !== declaredContentType) {
    return { ok: false, reason: 'content-type-mismatch' };
  }

  return { ok: true, sourceContentType: sniffed, byteSize: bytes.length };
}

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

/**
 * A new image identity, from the platform's cryptographic random source.
 *
 * `crypto.randomUUID()` and nothing else: no `uuid` package, no `uuid-ossp`,
 * no `pgcrypto`, and no database round-trip. The reference has to exist before
 * the object is written to storage, which is the only moment at which the key
 * and the row can be made to agree — so PostgreSQL cannot be the one to
 * generate it.
 */
export function createMediaReference(): MediaReference {
  return randomUUID() as MediaReference;
}

/**
 * A reference exactly as it was issued, or `null`.
 *
 * No trimming, no case folding, no brace or `urn:uuid:` unwrapping. Each of
 * those would accept a value the system never issued and then quietly address
 * a different object than the caller wrote, so all four are simply not the
 * reference and are refused as such.
 */
export function parseMediaReference(value: unknown): MediaReference | null {
  if (typeof value !== 'string' || !MEDIA_REFERENCE_PATTERN.test(value)) {
    return null;
  }

  return value as MediaReference;
}

/**
 * A storage key was asked for from something that is not a reference.
 *
 * The brand on `MediaReference` makes this unreachable from type-checked
 * code, so it marks a defect — a cast, or a caller outside TypeScript — rather
 * than bad input from a request. It is thrown rather than returned for exactly
 * that reason: no request handler should be catching it.
 */
export class InvalidMediaReferenceError extends Error {
  constructor() {
    super('Media reference is not canonical');
    this.name = 'InvalidMediaReferenceError';
  }
}

/**
 * The object key for one image: `media/<reference>.webp`.
 *
 * The reference is the only thing that enters it. No filename, no room-type
 * slug, no database id, no MIME header, no timestamp and no other
 * administrator input reaches this string — which is what makes traversal,
 * unicode normalization and collision questions not arise rather than be
 * defended against. The function takes one argument, so there is nowhere for
 * a second value to be threaded in later without that being a visible change.
 *
 * The extension is always `.webp` because the stored object always is.
 */
export function mediaStorageKey(reference: MediaReference): string {
  if (typeof reference !== 'string' || !MEDIA_REFERENCE_PATTERN.test(reference)) {
    throw new InvalidMediaReferenceError();
  }

  return `${MEDIA_STORAGE_KEY_PREFIX}${reference}${MEDIA_STORAGE_KEY_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------------------

/**
 * Alt text as it will be stored: trimmed text, or nothing.
 *
 * Absent, empty and whitespace-only all become `null`, because all three mean
 * "no description was given" and storing them differently would leave the API
 * returning several values for one state. That is not a shortcoming: a
 * decorative image is a legitimate case this website already has, where the
 * accessible name comes from a sibling and the image itself renders `alt=""`.
 *
 * Nothing else is done to the text. It is not lower-cased, internal runs of
 * whitespace are preserved exactly as written, and it is not HTML-escaped —
 * escaping belongs where the value is rendered, and doing it here would store
 * `&amp;` for an ampersand and show it to the next editor.
 *
 * The length is measured after trimming, so trailing spaces cannot push an
 * otherwise acceptable description over the limit.
 *
 * `undefined` is refused rather than read as `null`. In a partial update they
 * are not the same thing — an omitted field means "leave this alone" and an
 * explicit null means "clear it" — and quietly folding the first into the
 * second would erase an administrator's description because a key was missing
 * from the body. Telling the two apart stays with the caller that knows which
 * request it is handling.
 */
export function normalizeAltText(value: unknown): AltTextCheck {
  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return { ok: false, reason: 'not-text' };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }

  if (trimmed.length > MAX_ALT_TEXT_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/**
 * One of the two directions, or `null`.
 *
 * Matched exactly against the pair. Nothing is trimmed or case-folded: `"UP"`,
 * `"Down"` and `" up "` are values a correct client does not send, and
 * accepting them would make this endpoint's contract wider than it is written.
 *
 * Reordering is a direction rather than a submitted `sortOrder` because two
 * administrators editing at once can each send a coherent set of numbers and
 * still produce an incoherent result. "Move this one up" stays meaningful
 * against whatever order is current when it arrives.
 */
export function parseMediaOrderDirection(value: unknown): MediaOrderDirection | null {
  if (typeof value !== 'string') {
    return null;
  }

  return (MEDIA_ORDER_DIRECTIONS as readonly string[]).includes(value)
    ? (value as MediaOrderDirection)
    : null;
}

// ---------------------------------------------------------------------------
// How many images a room type may hold
// ---------------------------------------------------------------------------

/**
 * Whether a room type holding `currentCount` images may take one more.
 *
 * The business rule and only the business rule. It is not concurrency
 * protection: two uploads that each read eleven will each be told yes, and a
 * thirteenth image would follow. Keeping the count and the insert in one
 * transaction, under a lock on the room-type row, is the repository's job, and
 * this helper existing does not discharge it.
 *
 * A count that is not a whole non-negative number is refused rather than
 * compared, so a `NaN` from a mis-parsed row cannot read as "room available".
 */
export function checkRoomTypeImageCount(currentCount: unknown): ImageCountCheck {
  if (typeof currentCount !== 'number' || !Number.isSafeInteger(currentCount) || currentCount < 0) {
    return { ok: false, reason: 'not-a-count' };
  }

  if (currentCount >= MAX_ROOM_TYPE_IMAGES) {
    return { ok: false, reason: 'limit-reached' };
  }

  return { ok: true, remaining: MAX_ROOM_TYPE_IMAGES - currentCount };
}
