/**
 * The media domain's vocabulary and its one set of numbers.
 *
 * Shared on purpose: room-type images come first, package images will follow,
 * and neither should be the place a limit is decided. Anything a later layer
 * would otherwise have to restate — how large an upload may be, how many
 * images a room type holds, what the processing pipeline outputs — is named
 * here so it is looked up rather than guessed.
 *
 * This module describes media, not HTTP. It has no error codes, no status
 * numbers and no messages meant for a guest or an administrator: the
 * admin-room-type-media layer will map these facts onto its own locked
 * responses. Nothing here imports Express, `pg`, or anything at all.
 */

/**
 * What an administrator may upload.
 *
 * SVG is absent deliberately — it is a scriptable document, not a photograph —
 * and so is GIF, whose only real use here would be animation the pipeline
 * refuses anyway.
 */
export const SOURCE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** One of the three types an upload may declare and sniff as. */
export type SourceContentType = (typeof SOURCE_CONTENT_TYPES)[number];

declare const storedContentTypeBrand: unique symbol;

/**
 * What the hotel actually stores: a normalized WebP, always.
 *
 * Branded so it cannot be confused with `SourceContentType`. Two of the three
 * source types already fail to assign here, but the third — a WebP upload —
 * would otherwise pass, and it must not: the stored object is decoded,
 * auto-oriented, stripped of metadata, possibly resized and re-encoded, so it
 * is never the bytes that arrived. `STORED_CONTENT_TYPE` is the only value of
 * this type, which is the point.
 */
export type StoredContentType = 'image/webp' & { readonly [storedContentTypeBrand]: true };

/** The content type written to `media_assets.content_type`, and nothing else. */
export const STORED_CONTENT_TYPE = 'image/webp' as StoredContentType;

declare const mediaReferenceBrand: unique symbol;

/**
 * An image's public identity: the canonical UUID that appears in admin routes
 * and in the object key.
 *
 * Branded so a bare string cannot reach `mediaStorageKey`. The only way to
 * obtain one is `createMediaReference` or `parseMediaReference`, so a key can
 * never be built from an unvalidated value by accident. Database `bigint` ids
 * stay internal and appear in no route contract.
 */
export type MediaReference = string & { readonly [mediaReferenceBrand]: true };

/**
 * The exact textual form `crypto.randomUUID()` produces: lowercase hex in
 * 8-4-4-4-12 groups, version nibble 4, variant nibble 8/9/a/b.
 *
 * Anchored and exact. Nothing is trimmed or lower-cased before it is tested —
 * a reference is matched character for character in a URL and in an object
 * key, so a value needing repair is not the value the system issued. That
 * rejects ` <uuid> `, `<UUID>`, `{uuid}` and `urn:uuid:<uuid>` without any of
 * them needing a rule of their own.
 *
 * Narrowed to version 4 on purpose: every reference this system issues comes
 * from `createMediaReference`, so anything else was not issued by it.
 */
export const MEDIA_REFERENCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The object key is exactly these two pieces around a reference. */
export const MEDIA_STORAGE_KEY_PREFIX = 'media/';
export const MEDIA_STORAGE_KEY_EXTENSION = '.webp';

/**
 * The largest upload accepted, in bytes: 8 MiB exactly.
 *
 * This is the source ceiling — what an administrator sends — not the size of
 * what gets stored, which is normally far smaller after re-encoding. Written
 * as a shift of 1024 rather than 8_388_608 so it reads as the unit it is.
 */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * How many images one room type may hold.
 *
 * A room-type number, not a media-wide one: package images will bring their
 * own ceiling when they exist, and generalizing this before there is a second
 * caller would only hide which limit applies where.
 */
export const MAX_ROOM_TYPE_IMAGES = 12;

/**
 * The longest alt text accepted, after trimming, matching the
 * `room_type_images_alt_text_check` constraint.
 *
 * JavaScript counts UTF-16 code units and PostgreSQL's `length()` counts
 * characters, so a string of astral characters is measured as longer here than
 * there. That asymmetry is in the safe direction — the application refuses
 * before the column would — and no value accepted here can be rejected by the
 * database.
 */
export const MAX_ALT_TEXT_LENGTH = 240;

/**
 * The most pixels the pipeline will decode, whatever the byte size says.
 *
 * Bytes and pixels are different limits: a few hundred kilobytes of PNG can
 * decode into something enormous. Sharp applies this before decoding; it is
 * recorded here so that step reads the project's number instead of inventing
 * one.
 */
export const MAX_INPUT_PIXELS = 60_000_000;

/** The box a stored image is fitted inside. Resize down only, never upscale. */
export const MAX_OUTPUT_WIDTH = 2560;
export const MAX_OUTPUT_HEIGHT = 2560;

/** The encoder quality every stored object is written at. */
export const WEBP_QUALITY = 85;

/**
 * Why a source upload was refused, in the media domain's own terms.
 *
 * Deliberately not an HTTP code and not a message. The admin layer decides
 * which of these becomes `UNSUPPORTED_IMAGE_TYPE`, which becomes
 * `IMAGE_TOO_LARGE`, and how much of it an administrator is told.
 */
export type SourceUploadRejection =
  /** No `Content-Type` was declared at all. */
  | 'missing-content-type'
  /** A `Content-Type` was declared, but not one of the three accepted. */
  | 'unsupported-content-type'
  /** Zero bytes. */
  | 'empty-body'
  /** More than `MAX_SOURCE_BYTES`. */
  | 'too-large'
  /** The leading bytes match no accepted signature, or there are too few. */
  | 'unreadable-signature'
  /** Both the declaration and the bytes are accepted types, but different ones. */
  | 'content-type-mismatch';

/**
 * A source upload that passed every rule this module can decide without
 * decoding the image.
 *
 * `sourceContentType` is the *sniffed* type, which by then equals the declared
 * one. It says what arrived; it says nothing about what will be stored.
 */
export type SourceUploadCheck =
  | { ok: true; sourceContentType: SourceContentType; byteSize: number }
  | { ok: false; reason: SourceUploadRejection };

/** Why a byte count was refused, considered on its own. */
export type SourceByteSizeRejection = 'not-a-byte-count' | 'empty-body' | 'too-large';

export type SourceByteSizeCheck = { ok: true } | { ok: false; reason: SourceByteSizeRejection };

/** Alt text after normalization: text worth keeping, or nothing. */
export type AltTextCheck =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'not-text' | 'too-long' };

/**
 * How an administrator reorders images: one step at a time, against the
 * current order, rather than by submitting sort numbers. Nothing outside this
 * pair is a direction.
 */
export const MEDIA_ORDER_DIRECTIONS = ['up', 'down'] as const;

export type MediaOrderDirection = (typeof MEDIA_ORDER_DIRECTIONS)[number];

/** Whether one more image may be added, and how much room is left if so. */
export type ImageCountCheck =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'not-a-count' | 'limit-reached' };

/**
 * What the normalization pipeline is permitted to do.
 *
 * The values are `DEFAULT_IMAGE_PROCESSING_OPTIONS`, which are the constants
 * above. They are a parameter rather than four literals buried in a call chain
 * so each one can be shown to be wired to the behaviour it claims — a test can
 * shrink the box, the quality or the pixel ceiling and watch the output
 * change, instead of reading the source and hoping.
 */
export type ImageProcessingOptions = {
  maxInputPixels: number;
  maxOutputWidth: number;
  maxOutputHeight: number;
  webpQuality: number;
};

/**
 * One stored object, described exactly as `media_assets` records it.
 *
 * Every field is about the normalized WebP and never about the upload: the
 * digest is of `body`, and the dimensions are what the stored image measures
 * after orientation and resizing. Handed to an INSERT unchanged.
 */
export type ImageNormalization = {
  body: Buffer;
  contentType: StoredContentType;
  byteSize: number;
  /** Lowercase hex SHA-256 of `body`, matching what node's crypto produces. */
  checksumSha256: string;
  width: number;
  height: number;
};

/**
 * Why an image could not be normalized, in the media domain's own terms.
 *
 * Three facts, no HTTP codes and no sharp text. `undecodable` deliberately
 * covers corrupt, truncated, empty, unsupported and over-the-pixel-ceiling
 * alike: libvips reports them through the same channel, and making business
 * logic depend on which human-readable message came back would tie this system
 * to strings libvips is free to reword.
 */
export type ImageNormalizationRejection =
  | 'undecodable'
  | 'animated-or-multi-page'
  | 'format-mismatch';

export type ImageNormalizationResult =
  | { ok: true; normalized: ImageNormalization }
  | { ok: false; reason: ImageNormalizationRejection };

/**
 * What walking a PNG's chunk structure found.
 *
 * `not-png` and `malformed` are deliberately different answers. The first means
 * this was never a PNG and the question does not apply, so the caller should
 * carry on and let the decoder say what it is; the second means it claimed to
 * be one and its chunk structure does not hold together, which is a refusal.
 * Collapsing the two would turn "JPEG bytes labelled as PNG" into the wrong
 * rejection.
 */
export type PngContainerScan =
  | { ok: true; animated: boolean }
  | { ok: false; reason: 'not-png' | 'malformed' };

/**
 * The Cache-Control every stored object is written with.
 *
 * A year, and immutable. Safe because a key is a UUID that is never reused:
 * the bytes under one key never change, so there is nothing for a cache to go
 * stale about. Replacing an image writes a new key, which is a different URL.
 */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The two things this system ever asks object storage to do. */
export type MediaStorageOperation = 'put' | 'delete';

/**
 * Object storage, as the rest of this system is allowed to see it.
 *
 * Two operations and nothing else. No listing, no copying, no presigning, no
 * bucket administration — none of which this application does, and none of
 * which the deployment's token is scoped for.
 *
 * Deliberately says nothing about Cloudflare, S3 or any SDK. A service depends
 * on this type, is handed an implementation, and could be run against an
 * in-memory double without knowing the difference. That is also what keeps
 * package media able to reuse it later without inheriting a room-type shape.
 */
export type MediaStorage = {
  putObject(input: { key: string; body: Buffer; contentType: StoredContentType }): Promise<void>;
  deleteObject(key: string): Promise<void>;
};

/**
 * Object storage did not complete an operation.
 *
 * Carries which operation failed and nothing else. The underlying SDK error is
 * deliberately not attached — not as the message, not as `cause`, not as a
 * field — because those objects routinely name the endpoint, the bucket and
 * the request that was signed, and an error that travels is an error that
 * eventually gets logged or serialised somewhere it should not be.
 *
 * It says nothing about HTTP either. The admin media layer decides what an
 * administrator is told when storage is unavailable.
 */
export class MediaStorageError extends Error {
  readonly operation: MediaStorageOperation;

  constructor(operation: MediaStorageOperation) {
    super(`Media storage ${operation} failed`);
    this.name = 'MediaStorageError';
    this.operation = operation;
  }
}

export function isMediaStorageError(error: unknown): error is MediaStorageError {
  return error instanceof MediaStorageError;
}
