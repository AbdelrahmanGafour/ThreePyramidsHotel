import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_HEIGHT,
  MAX_OUTPUT_WIDTH,
  STORED_CONTENT_TYPE,
  WEBP_QUALITY,
  type ImageNormalization,
  type ImageNormalizationResult,
  type ImageProcessingOptions,
  type PngContainerScan,
  type SourceContentType,
} from './media.types';

/**
 * Turning a source upload into the one object this hotel stores.
 *
 * The result is a normalized WebP: decoded, auto-oriented, stripped of
 * metadata, fitted inside a fixed box without ever being enlarged, and
 * re-encoded. It is never the bytes that arrived, which is why the stored
 * content type is a different type from the source one.
 *
 * This is the second of two gates, and the authoritative one. T03-C's
 * signature check is a cheap pre-filter that answers "is this worth
 * decoding?"; only libvips can answer "does this decode, is it one frame, and
 * how large is it really?". The two are not redundant and neither replaces the
 * other — a body may pass the first and fail here, which is exactly the case
 * this module exists for.
 *
 * Pure of infrastructure: no database, no object storage, no Express, no
 * filesystem, no network, no environment variable. It takes bytes and returns
 * bytes.
 */

/** What the pipeline is allowed to do, as values rather than as literals in a chain. */
export const DEFAULT_IMAGE_PROCESSING_OPTIONS: ImageProcessingOptions = {
  maxInputPixels: MAX_INPUT_PIXELS,
  maxOutputWidth: MAX_OUTPUT_WIDTH,
  maxOutputHeight: MAX_OUTPUT_HEIGHT,
  webpQuality: WEBP_QUALITY,
};

/**
 * What each accepted source type must decode as.
 *
 * Keyed by the media type rather than by any file extension: an extension is a
 * guess about a name, and no name reaches this module at all.
 */
const EXPECTED_SHARP_FORMAT: Record<SourceContentType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Whether a decoded image is the single frame this system stores.
 *
 * Kept separate and pure so the rule can be stated once and tested against
 * every value libvips could produce, rather than only against the fixtures a
 * suite happens to be able to build.
 *
 * `pages` is the decoded fact, never a filename or a media type. libvips
 * reports it for the multi-frame containers it understands — animated WebP,
 * animated GIF, multi-page TIFF, HEIF, PDF — and leaves it `undefined` for an
 * ordinary single-frame JPEG, PNG or WebP, which is why absent means one. A
 * single-frame GIF reports `1` rather than `undefined`, so both spellings of
 * "one page" have to be accepted.
 *
 * Exactly two values pass: absent, and one. Everything else is refused,
 * including `0`, a negative, a fraction and the non-finite values — not
 * because libvips is expected to produce them, but because a page count this
 * code cannot explain is not a reason to store an image. Refusing an upload is
 * recoverable; quietly storing one frame of something else is not.
 */
export function isSinglePage(pages: number | undefined): boolean {
  return pages === undefined || pages === 1;
}

/** The eight bytes every PNG begins with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Each chunk is a 4-byte length, a 4-byte type, its data, then a 4-byte CRC. */
const CHUNK_HEADER_LENGTH = 8;
const CHUNK_CRC_LENGTH = 4;

/** The PNG specification caps a chunk's data at 2^31 - 1 bytes. */
const MAX_CHUNK_DATA_LENGTH = 0x7fffffff;

/** A chunk type is four ASCII letters; their case carries the chunk's flags. */
const CHUNK_TYPE_PATTERN = /^[A-Za-z]{4}$/;

/** APNG's animation control chunk. Its presence is what makes a PNG animated. */
const ANIMATION_CONTROL_CHUNK = 'acTL';

/** The chunk that ends every PNG stream. */
const END_CHUNK = 'IEND';

/**
 * Whether a PNG container advertises APNG animation.
 *
 * This exists because libvips does not report APNG through `metadata.pages` —
 * it decodes the default image and says nothing about the frames — so the page
 * check alone would let an animated PNG through and store one frame of it.
 * V1's contract is that animated images are refused, and this is what makes
 * that true for PNG as well as for WebP.
 *
 * The structure is walked, never searched. `bytes.includes('acTL')` would be
 * wrong: those four bytes can occur anywhere inside compressed pixel data, and
 * a false positive would refuse a perfectly ordinary photograph. Only a chunk
 * type found at a real chunk boundary counts, which means stepping over each
 * chunk's declared length and its CRC to reach the next one.
 *
 * Deliberately not a PNG decoder. It reads no pixel data, inflates nothing and
 * verifies no CRC — libpng does that when sharp decodes, and duplicating it
 * here would be a second implementation to keep correct. The only question
 * asked is whether the container announces animation.
 *
 * Every read is bounds-checked first, so a truncated or absurd stream returns
 * `malformed` rather than raising a `RangeError` out of a validation helper.
 */
export function scanPngContainer(bytes: Buffer): PngContainerScan {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length) {
    return { ok: false, reason: 'not-png' };
  }

  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'not-png' };
  }

  let offset = PNG_SIGNATURE.length;

  for (;;) {
    // The length and the type must both be fully present before either is read.
    if (offset + CHUNK_HEADER_LENGTH > bytes.length) {
      return { ok: false, reason: 'malformed' };
    }

    const dataLength = bytes.readUInt32BE(offset);

    if (dataLength > MAX_CHUNK_DATA_LENGTH) {
      return { ok: false, reason: 'malformed' };
    }

    const type = bytes.toString('latin1', offset + 4, offset + CHUNK_HEADER_LENGTH);

    if (!CHUNK_TYPE_PATTERN.test(type)) {
      return { ok: false, reason: 'malformed' };
    }

    // Where the next chunk would start: past this one's data and its CRC.
    const next = offset + CHUNK_HEADER_LENGTH + dataLength + CHUNK_CRC_LENGTH;

    if (next > bytes.length) {
      return { ok: false, reason: 'malformed' };
    }

    if (type === ANIMATION_CONTROL_CHUNK) {
      return { ok: true, animated: true };
    }

    if (type === END_CHUNK) {
      return { ok: true, animated: false };
    }

    // Every chunk advances at least CHUNK_HEADER_LENGTH + CHUNK_CRC_LENGTH
    // bytes, so this cannot stand still and the walk always terminates.
    offset = next;
  }
}

/**
 * The resize the pipeline performs, as an object a test can read.
 *
 * `fit: 'inside'` scales the whole image to fit the box and preserves the
 * aspect ratio; it never crops, so a 4:3 frame on the website is the website's
 * decision at render time and not something baked into the stored object.
 * `withoutEnlargement` is what makes this resize-down-only: an image already
 * inside the box comes out untouched rather than stretched.
 */
export function resizeOptions(options: ImageProcessingOptions): sharp.ResizeOptions {
  return {
    width: options.maxOutputWidth,
    height: options.maxOutputHeight,
    fit: 'inside',
    withoutEnlargement: true,
  };
}

/** The encoder settings every stored object is written with. */
export function webpOptions(options: ImageProcessingOptions): sharp.WebpOptions {
  return { quality: options.webpQuality };
}

/**
 * The reader settings.
 *
 * `limitInputPixels` is the defence bytes cannot provide: a few hundred
 * kilobytes of PNG can decode into something enormous, so a byte ceiling and a
 * pixel ceiling are different limits and this system has both. libvips applies
 * it while reading the header, so an oversized image is refused before it is
 * decoded rather than after.
 *
 * `failOn: 'warning'` is sharp's strictest policy: a truncated or corrupt
 * image raises rather than yielding a partial picture. It is stated here
 * rather than left to sharp's default, which happens to be the same value
 * today — a default is something an upgrade may change, and this is a contract
 * about what gets stored. A half-decoded photograph with a grey band across
 * the bottom is not something to keep forever because a library relaxed.
 */
export function sharpInputOptions(options: ImageProcessingOptions): sharp.SharpOptions {
  return { limitInputPixels: options.maxInputPixels, failOn: 'warning' };
}

/**
 * Normalizes one pre-filtered source image into the object that gets stored.
 *
 * `sourceContentType` is what T03-C established the bytes claim and sniff as.
 * It is treated as a claim to be checked, never as proof: the decoded format
 * is compared against it below, so a body that somehow reached here declaring
 * one thing and decoding as another is refused rather than quietly processed.
 *
 * The order is fixed:
 *
 *   0. for PNG only, walk the container and refuse an APNG  (libvips will not
 *      report one, so nothing later in this list would catch it)
 *   1. read the header under the pixel ceiling  (throws for corrupt, truncated,
 *      unsupported or oversized input)
 *   2. refuse anything with more than one page or frame
 *   3. refuse a decoded format that is not the one claimed
 *   4. auto-orient from the embedded orientation
 *   5. fit inside the output box, never enlarging, never cropping
 *   6. encode as WebP at the locked quality
 *   7. measure and checksum the bytes that were actually produced
 *
 * Step 0 supplements the decoder and never replaces it: a PNG that passes the
 * container walk still has to decode, still has to be the format it claimed,
 * and still has to fit the pixel ceiling.
 *
 * Auto-orientation comes before the resize so the box is applied to the
 * picture as it will be seen: a portrait photograph tagged with an EXIF
 * orientation is 1280x2560 afterwards, not 2560x1280.
 *
 * Metadata is dropped because that is sharp's default and nothing here asks
 * for it back — no `withMetadata`, no `keepMetadata`, no `withExif`. EXIF, XMP,
 * source comments and the source ICC profile are all gone from the stored
 * object, and so is the orientation tag, which has been resolved into the
 * pixels instead. No filename is read, recorded or returned anywhere in this
 * module.
 *
 * Transparency survives. Nothing flattens alpha onto a background, so a PNG or
 * WebP with an alpha channel keeps it through to the stored WebP.
 */
export async function normalizeImage(
  source: Buffer,
  sourceContentType: SourceContentType,
  options: ImageProcessingOptions = DEFAULT_IMAGE_PROCESSING_OPTIONS,
): Promise<ImageNormalizationResult> {
  if (sourceContentType === 'image/png') {
    const container = scanPngContainer(source);

    if (container.ok && container.animated) {
      return { ok: false, reason: 'animated-or-multi-page' };
    }

    if (!container.ok && container.reason === 'malformed') {
      return { ok: false, reason: 'undecodable' };
    }

    // `not-png` falls through on purpose. Bytes that are not a PNG at all were
    // mislabelled rather than broken, and the decoder below is what says so —
    // answering here would report the wrong reason.
  }

  let image: sharp.Sharp;
  let pages: number | undefined;
  let format: string;

  try {
    // The constructor is inside the try on purpose: sharp validates its input
    // eagerly and throws synchronously for an empty buffer, so leaving it
    // outside would let one failure escape as an exception while every other
    // one came back as a rejection.
    image = sharp(source, sharpInputOptions(options));

    const metadata = await image.metadata();

    pages = metadata.pages;
    format = metadata.format;
  } catch {
    // Every reason the header could not be read collapses to one answer:
    // corrupt, truncated, empty, an unsupported container, or more pixels than
    // the ceiling allows. The distinction matters to nobody upstream, and
    // sharp's own text is never forwarded — it names libvips internals and is
    // not a contract.
    return { ok: false, reason: 'undecodable' };
  }

  if (!isSinglePage(pages)) {
    // Storing frame one of an animation would be a quiet, permanent
    // substitution of something the administrator did not choose.
    return { ok: false, reason: 'animated-or-multi-page' };
  }

  if (format !== EXPECTED_SHARP_FORMAT[sourceContentType]) {
    return { ok: false, reason: 'format-mismatch' };
  }

  let body: Buffer;
  let width: number;
  let height: number;

  try {
    const { data, info } = await image
      .rotate()
      .resize(resizeOptions(options))
      .webp(webpOptions(options))
      .toBuffer({ resolveWithObject: true });

    body = data;
    width = info.width;
    height = info.height;
  } catch {
    // The header read and the full decode are separate events: an image can
    // describe itself correctly and still fail part-way through its pixel data.
    return { ok: false, reason: 'undecodable' };
  }

  return { ok: true, normalized: describeNormalized(body, width, height) };
}

/**
 * Measures the bytes that were produced, and nothing else.
 *
 * `byteSize` and `checksumSha256` are taken from `body` itself rather than
 * from anything reported alongside it, so the three can never disagree: what
 * is stored, what its length is recorded as, and what its digest is recorded
 * as all come from one value.
 *
 * The checksum is an integrity fact about *these* bytes — it proves the object
 * that reaches storage is the object that was measured, and that it has not
 * changed since. It is deliberately not a claim of reproducibility: a
 * different sharp or libvips build, or a different platform, may encode the
 * same picture into different WebP bytes with a different digest, and nothing
 * in this system assumes otherwise.
 *
 * The dimensions are the stored object's, after orientation and resizing —
 * never the source's.
 */
function describeNormalized(body: Buffer, width: number, height: number): ImageNormalization {
  return {
    body,
    contentType: STORED_CONTENT_TYPE,
    byteSize: body.length,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    width,
    height,
  };
}
