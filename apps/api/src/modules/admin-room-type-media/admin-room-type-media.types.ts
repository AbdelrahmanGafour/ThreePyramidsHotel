import type {
  ImageNormalizationRejection,
  MediaOrderDirection,
  MediaStorage,
  SourceUploadRejection,
  StoredContentType,
} from '../media/media.types';

/**
 * The shapes the room-type media repository speaks in.
 *
 * Two kinds live here and are kept apart on purpose. `AdminRoomTypeImage` is
 * what an administrator may eventually be shown: it carries the public
 * `reference` and no internal key. `ScopedRoomTypeImage` is the repository's
 * own working shape, and does carry internal ids, because a mutation has to
 * address a row by primary key rather than by re-resolving a UUID it has
 * already resolved once.
 *
 * Nothing here is an HTTP concern. There are no status codes and no error
 * bodies; the service and the controller decide those.
 */

/**
 * A room type, reduced to what media work needs of it.
 *
 * `id` because every media row hangs off it, `slug` because that is what the
 * route named and what a caller can be told. Capacity, rate, description and
 * the rest are none of this feature's business, so they are not selected.
 */
export type ResolvedRoomTypeForMedia = {
  /** `room_types.id`. Internal: a query parameter, never a response field. */
  roomTypeId: string;
  slug: string;
};

/**
 * One image of one room type, joined across the relation and its asset.
 *
 * Deliberately without `room_type_images.id` and `media_assets.id`. An image
 * is addressed publicly by its `reference`, and an internal key in this shape
 * would be an internal key one careless spread away from a response body.
 *
 * `storageKey` is present because composing a public URL needs it. It is not a
 * secret — it is a random UUID under a fixed prefix — but it is also not an
 * identifier a caller should send back, which is what `reference` is for.
 *
 * Money-style care applies to `byteSize`: the column is `bigint`, so it is read
 * as text and converted once, never approximated.
 */
export type AdminRoomTypeImage = {
  reference: string;
  storageKey: string;
  contentType: StoredContentType;
  byteSize: number;
  checksumSha256: string;
  width: number;
  height: number;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  /** ISO 8601 instant. */
  createdAt: string;
  /** ISO 8601 instant. */
  updatedAt: string;
};

/**
 * One image located *within* a room type, with the keys a mutation needs.
 *
 * Returned only by the scoped lookups, and only to the service — it is the
 * repository's working shape, not a response contract. It exists so a caller
 * that has already proven an image belongs to a room type can then address the
 * relation and the asset directly, instead of resolving the same UUID again
 * and having to re-prove ownership at every step.
 *
 * `reference` and `storageKey` ride along because a deletion needs them after
 * the transaction commits, and by then the rows are gone.
 */
export type ScopedRoomTypeImage = {
  /** `room_type_images.id`. Internal. */
  imageId: string;
  /** `media_assets.id`. Internal. */
  mediaAssetId: string;
  reference: string;
  storageKey: string;
  sortOrder: number;
  isCover: boolean;
};

/** A new relation row. Every value is the caller's decision, not this layer's. */
export type RoomTypeImageInsert = {
  roomTypeId: string;
  mediaAssetId: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
};

export type { MediaOrderDirection };

/**
 * What happened when an image was asked to move.
 *
 * `boundary` is not a failure and not an error: the first image cannot move up
 * and the last cannot move down, and an administrator who clicks it has asked
 * for something already true. It is kept distinct from `moved` so the service
 * can say so without having to compare orders itself, and distinct from
 * `not-found` so a wrong reference is never reported as "already first".
 */
export type RoomTypeImageMoveResult =
  | { outcome: 'moved' }
  | { outcome: 'boundary' }
  | { outcome: 'not-found' };

/**
 * What a deleted image leaves behind for the caller to finish with.
 *
 * The storage object outlives the transaction on purpose. Rows are removed
 * first and committed; only then is the object deleted, because a failed
 * object delete leaves an orphan nobody can see, while a failed commit after a
 * successful object delete would leave a row pointing at nothing — a broken
 * image on the public site. Storage may hold more than the database knows
 * about, never less.
 */
export type DeletedRoomTypeImage = {
  reference: string;
  storageKey: string;
};

// ---------------------------------------------------------------------------
// The service layer's contracts
// ---------------------------------------------------------------------------

/**
 * What the service is handed rather than reaches for.
 *
 * Only object storage, and only by the two operations that touch it. The
 * others do not take this parameter at all, which is how "this operation
 * performs no storage call" is a fact about the code rather than a promise in
 * a comment.
 *
 * No AWS type appears here, no R2 variable is read, and the real adapter is
 * never constructed inside a use case — a test supplies an in-memory double
 * and nothing notices.
 */
export type RoomTypeMediaDependencies = {
  storage: MediaStorage;
};

/**
 * What became of an object the database declined to take ownership of, or
 * released ownership of.
 *
 * Kept because it is operationally real: a failed cleanup leaves an orphan,
 * and the key is the only way anyone would ever find it again. A storage key
 * is a random UUID under a fixed prefix and reveals nothing about the hotel,
 * its guests or its configuration — but it is internal diagnostics, not a
 * public API field, and this step does not put it in a response.
 */
export type AttemptedStorageCleanup =
  | { attempted: true; removed: true }
  | { attempted: true; removed: false; storageKey: string };

export type StorageCleanup = { attempted: false } | AttemptedStorageCleanup;

/**
 * An upload failed *and* the object it had already written could not be
 * removed again.
 *
 * Thrown only when both are true. When cleanup succeeds the original failure
 * is re-thrown untouched, because there is nothing extra to say; when it does
 * not, the orphan is the fact that would otherwise be lost, so it is named and
 * the original travels as the cause.
 *
 * Carries the storage key, and nothing else that anything will serialise. No
 * endpoint, no bucket, no credential, no SDK payload, no SQL.
 *
 * The original failure is attached through `Error`'s own `cause` option rather
 * than by assignment, which is the difference between a non-enumerable
 * property and one that `JSON.stringify` would copy out. A database error can
 * carry query detail, and an error that travels is an error that eventually
 * gets logged somewhere it should not be — but it is still the only thing that
 * explains what went wrong, so it stays reachable for a debugger and invisible
 * to a serialiser.
 */
export class MediaUploadCleanupError extends Error {
  readonly storageKey: string;

  constructor(storageKey: string, cause: unknown) {
    super('Media upload failed and its stored object could not be removed', { cause });
    this.name = 'MediaUploadCleanupError';
    this.storageKey = storageKey;
  }
}

export function isMediaUploadCleanupError(error: unknown): error is MediaUploadCleanupError {
  return error instanceof MediaUploadCleanupError;
}

/**
 * Why a use case could not do what was asked, in the domain's own terms.
 *
 * No status codes and no messages for a person to read: a controller maps
 * these onto the API's locked error bodies, and a use case that already knew
 * about HTTP would be a use case only HTTP could call.
 *
 * `image-not-found` deliberately covers a reference that never existed and one
 * that belongs to another room type alike. They are indistinguishable by
 * design — telling them apart would let a caller discover which images exist
 * under room types that are not theirs.
 */
export type RoomTypeImageUploadResult =
  | { outcome: 'uploaded'; image: AdminRoomTypeImage }
  // `cleanup` is present on both refusals that can happen either side of the
  // PUT. Before it there is nothing to undo, and it reads `attempted: false`;
  // after it, it says what became of the object.
  | { outcome: 'room-type-not-found'; cleanup: StorageCleanup }
  | { outcome: 'image-limit-reached'; cleanup: AttemptedStorageCleanup }
  | { outcome: 'invalid-upload'; reason: SourceUploadRejection }
  | { outcome: 'invalid-image'; reason: ImageNormalizationRejection }
  | { outcome: 'media-storage-unavailable' };

export type RoomTypeImageListResult =
  | { outcome: 'listed'; images: AdminRoomTypeImage[] }
  | { outcome: 'room-type-not-found' };

export type RoomTypeImageAltTextResult =
  | { outcome: 'updated' }
  | { outcome: 'room-type-not-found' }
  | { outcome: 'image-not-found' }
  | { outcome: 'invalid-image-reference' }
  | { outcome: 'invalid-alt-text'; reason: 'not-text' | 'too-long' };

export type RoomTypeImageCoverResult =
  | { outcome: 'updated' }
  | { outcome: 'room-type-not-found' }
  | { outcome: 'image-not-found' }
  | { outcome: 'invalid-image-reference' };

/**
 * `boundary` is carried through rather than folded into success or failure.
 * The first image cannot move up; saying so is not the same as saying nothing
 * happened, and not the same as saying the image does not exist.
 */
export type RoomTypeImageMoveServiceResult =
  | { outcome: 'moved' }
  | { outcome: 'boundary' }
  | { outcome: 'room-type-not-found' }
  | { outcome: 'image-not-found' }
  | { outcome: 'invalid-image-reference' }
  | { outcome: 'invalid-order-direction' };

/**
 * A successful delete reports how the object cleanup went, and stays a success
 * either way. The rows are gone, which is what "deleted" means here; an object
 * left behind is an orphan to sweep, never a reason to tell an administrator
 * their deletion failed or — worse — to put the row back.
 */
export type RoomTypeImageDeleteResult =
  | { outcome: 'deleted'; reference: string; cleanup: StorageCleanup }
  | { outcome: 'room-type-not-found' }
  | { outcome: 'image-not-found' }
  | { outcome: 'invalid-image-reference' };

/**
 * PostgreSQL was asked to commit and did not say whether it did.
 *
 * This is not a failure. A `COMMIT` that throws means the answer never
 * arrived, and the two possible realities are both live: the transaction may
 * have committed and the acknowledgement been lost, or it may never have
 * committed at all. Nothing available to this process can tell them apart —
 * issuing a `ROLLBACK` afterwards proves nothing, because a rollback of a
 * transaction that already committed is a no-op that still answers "ok".
 *
 * It matters because compensation depends on knowing. Deleting the object
 * after an uncertain upload commit would, in the reality where the row exists,
 * leave a committed row pointing at nothing — the one outcome this
 * architecture refuses. So the object is kept and the uncertainty is reported,
 * which at worst leaves an orphan.
 *
 * Named for what is true: the outcome is uncertain. Never "failed", never
 * "rolled back", never "not created" — none of those is known.
 *
 * Carries the reference and the storage key, because reconciliation will need
 * them and neither is a secret. It carries no connection string, endpoint,
 * bucket, credential, AWS request or query text, and the underlying error is
 * attached non-enumerably so nothing serialises it by accident.
 */
export class MediaPersistenceOutcomeUncertainError extends Error {
  readonly operation: 'upload' | 'delete';
  readonly reference: string | null;
  readonly storageKey: string | null;

  constructor(
    operation: 'upload' | 'delete',
    identity: { reference: string | null; storageKey: string | null },
    cause: unknown,
  ) {
    super(`Media ${operation} persistence outcome uncertain`, { cause });
    this.name = 'MediaPersistenceOutcomeUncertainError';
    this.operation = operation;
    this.reference = identity.reference;
    this.storageKey = identity.storageKey;
  }
}

export function isMediaPersistenceOutcomeUncertainError(
  error: unknown,
): error is MediaPersistenceOutcomeUncertainError {
  return error instanceof MediaPersistenceOutcomeUncertainError;
}

// ---------------------------------------------------------------------------
// The HTTP contract
// ---------------------------------------------------------------------------
//
// Everything below is what an administrator's browser actually sees. It is
// deliberately the last section in this file: every type and result above it
// describes the service's own vocabulary, and none of it is an HTTP status or
// a JSON body. A controller reads a service outcome and looks up the matching
// entry here — it does not invent one, and it does not build an error body by
// hand from parts of the service's answer.
//
// Every frozen response is built once. A route can only ever send the locked
// contract, never a hand-assembled near-copy of it, and no response below
// echoes a storage key, a checksum, a database id, an endpoint, a bucket or a
// credential.

export const INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR_CODE = 'INVALID_ROOM_TYPE_IMAGE_REFERENCE';
export const INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR_MESSAGE = 'Invalid room type image reference';

/**
 * The `:imageReference` route segment is not the canonical form the media
 * module issues — not merely a UUID nobody has used, which is a 404, but a
 * value that could not have been one at all: padded, upper-cased, braced, or
 * not a UUID's shape.
 */
export const INVALID_ROOM_TYPE_IMAGE_REFERENCE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR_CODE,
    message: INVALID_ROOM_TYPE_IMAGE_REFERENCE_ERROR_MESSAGE,
  }),
});

export const ROOM_TYPE_IMAGE_NOT_FOUND_ERROR_CODE = 'ROOM_TYPE_IMAGE_NOT_FOUND';
export const ROOM_TYPE_IMAGE_NOT_FOUND_ERROR_MESSAGE = 'Room type image not found';

/**
 * No image answers to this reference under this room type. Sent identically
 * whether the reference never existed anywhere or names an image that belongs
 * to a different room type — the service's scoped lookup cannot tell the two
 * apart, and must not be made to: doing so would let a caller discover which
 * images exist under room types that are not theirs.
 */
export const ROOM_TYPE_IMAGE_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_IMAGE_NOT_FOUND_ERROR_CODE,
    message: ROOM_TYPE_IMAGE_NOT_FOUND_ERROR_MESSAGE,
  }),
});

export const INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR_CODE = 'INVALID_ROOM_TYPE_IMAGE_UPDATE';
export const INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR_MESSAGE = 'Invalid room type image update';

/**
 * A PATCH body this endpoint does not accept: the wrong shape, an unknown or
 * extra key, a value the domain rules refuse (over-length alt text, a
 * direction other than "up"/"down"), or — for the cover route — any mutable
 * field at all. One message for every reason, matching this codebase's rule
 * that naming which value inside a body was wrong would map fields a caller
 * has no business learning about.
 */
export class InvalidRoomTypeImageUpdateError extends Error {
  readonly code = INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR_CODE;

  constructor() {
    super(INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR_MESSAGE);
    this.name = 'InvalidRoomTypeImageUpdateError';
  }
}

export function isInvalidRoomTypeImageUpdateError(
  error: unknown,
): error is InvalidRoomTypeImageUpdateError {
  return error instanceof InvalidRoomTypeImageUpdateError;
}

/** The frozen body for every reason `InvalidRoomTypeImageUpdateError` covers, and every domain rejection with the same shape. */
export const INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR_CODE,
    message: INVALID_ROOM_TYPE_IMAGE_UPDATE_ERROR_MESSAGE,
  }),
});

export const IMAGE_TOO_LARGE_ERROR_CODE = 'IMAGE_TOO_LARGE';
export const IMAGE_TOO_LARGE_ERROR_MESSAGE = 'Image exceeds the maximum upload size';

/** The raw body's byte ceiling was exceeded, whether the parser caught it or the domain rule did. */
export const IMAGE_TOO_LARGE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: IMAGE_TOO_LARGE_ERROR_CODE,
    message: IMAGE_TOO_LARGE_ERROR_MESSAGE,
  }),
});

export const UNSUPPORTED_IMAGE_TYPE_ERROR_CODE = 'UNSUPPORTED_IMAGE_TYPE';
export const UNSUPPORTED_IMAGE_TYPE_ERROR_MESSAGE = 'Unsupported image type';

/** No `Content-Type` was declared, or it is not one of the three this API accepts. */
export const UNSUPPORTED_IMAGE_TYPE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: UNSUPPORTED_IMAGE_TYPE_ERROR_CODE,
    message: UNSUPPORTED_IMAGE_TYPE_ERROR_MESSAGE,
  }),
});

export const INVALID_IMAGE_UPLOAD_ERROR_CODE = 'INVALID_IMAGE_UPLOAD';
export const INVALID_IMAGE_UPLOAD_ERROR_MESSAGE = 'Invalid image upload';

/**
 * An accepted content type was declared, but the bytes are not a usable image
 * under it: empty, unreadable, disagreeing with what was declared, undecodable,
 * animated, multi-page, or a decoded format that does not match the
 * declaration. One body for all of it — which of those it was is not
 * something worth handing back, and several of the reasons this covers exist
 * precisely because a caller's claim about their own upload was not true.
 */
export const INVALID_IMAGE_UPLOAD_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: INVALID_IMAGE_UPLOAD_ERROR_CODE,
    message: INVALID_IMAGE_UPLOAD_ERROR_MESSAGE,
  }),
});

export const ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_CODE = 'ROOM_TYPE_IMAGE_LIMIT_REACHED';
export const ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_MESSAGE = 'Room type has reached its image limit';

/** The room type already holds `MAX_ROOM_TYPE_IMAGES`. Carries no count — the ceiling is fixed and does not vary by room type. */
export const ROOM_TYPE_IMAGE_LIMIT_REACHED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_CODE,
    message: ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_MESSAGE,
  }),
});

export const MEDIA_STORAGE_UNAVAILABLE_ERROR_CODE = 'MEDIA_STORAGE_UNAVAILABLE';
export const MEDIA_STORAGE_UNAVAILABLE_ERROR_MESSAGE = 'Media storage is temporarily unavailable';

/**
 * Object storage could not be reached or is not configured. The same answer
 * either way: a caller cannot act differently on "the network is down" versus
 * "the deployment is missing a credential", and neither reason — nor any
 * endpoint, bucket, key or secret — belongs in a response.
 */
export const MEDIA_STORAGE_UNAVAILABLE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: MEDIA_STORAGE_UNAVAILABLE_ERROR_CODE,
    message: MEDIA_STORAGE_UNAVAILABLE_ERROR_MESSAGE,
  }),
});

export const MEDIA_DELIVERY_UNAVAILABLE_ERROR_CODE = 'MEDIA_DELIVERY_UNAVAILABLE';
export const MEDIA_DELIVERY_UNAVAILABLE_ERROR_MESSAGE = 'Media delivery is temporarily unavailable.';

/**
 * `R2_PUBLIC_BASE_URL` is missing or invalid. Deliberately a different code
 * from `MEDIA_STORAGE_UNAVAILABLE`: object storage can be entirely healthy —
 * every upload and every delete may still work — while the separate, later
 * decision of where to serve images from has simply not been configured yet.
 * Conflating the two would tell an operator to go look at the wrong system.
 *
 * Never mentions R2, Cloudflare, a bucket, a domain, a configured URL or a
 * credential. The configuration error this responds to already names which
 * variable was the problem internally; none of that reaches the browser.
 */
export const MEDIA_DELIVERY_UNAVAILABLE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: MEDIA_DELIVERY_UNAVAILABLE_ERROR_CODE,
    message: MEDIA_DELIVERY_UNAVAILABLE_ERROR_MESSAGE,
  }),
});

export const MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR_CODE = 'MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN';

/**
 * Locked wording. This is the one response in this module that must never
 * drift, because it is the HTTP face of the uncertain-commit doctrine: the
 * database may or may not have committed, and nothing here may claim it did,
 * that it did not, or that it was rolled back. It does not say "upload
 * failed", "delete failed", "not created" or "deleted" — none of those is
 * known — and it does not promise a retry will be safe on its own; it tells
 * the caller to look again before acting further.
 */
export const MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR_MESSAGE =
  'The operation outcome could not be confirmed. Refresh the current state before retrying.';

export const MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR_CODE,
    message: MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR_MESSAGE,
  }),
});

export const MEDIA_OPERATION_FAILED_ERROR_CODE = 'MEDIA_OPERATION_FAILED';
export const MEDIA_OPERATION_FAILED_ERROR_MESSAGE = 'The operation could not be completed';

/**
 * An upload whose object could not be cleaned up after a definite database
 * failure (`MediaUploadCleanupError`). Generic and safe on purpose: the
 * orphaned storage key is real operational information, but it identifies
 * nothing about the hotel and is not something a browser needs or should
 * carry — it stays server-side, for whoever reconciles storage later.
 */
export const MEDIA_OPERATION_FAILED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: MEDIA_OPERATION_FAILED_ERROR_CODE,
    message: MEDIA_OPERATION_FAILED_ERROR_MESSAGE,
  }),
});
