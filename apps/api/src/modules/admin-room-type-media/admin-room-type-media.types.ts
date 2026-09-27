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
 * The storage/database seam, defined once in the shared media module.
 *
 * Re-exported here because this module's own result types are built from
 * them and because every existing caller imports them from this file. The
 * definitions themselves are not room-type-specific and no longer live here:
 * journey media runs the same sequence and needs the same three facts.
 */
export {
  MediaUploadCleanupError,
  MediaPersistenceOutcomeUncertainError,
  isMediaUploadCleanupError,
  isMediaPersistenceOutcomeUncertainError,
} from '../media/media.outcomes';
export type {
  AttemptedStorageCleanup,
  StorageCleanup,
  MediaPersistenceOperation,
} from '../media/media.outcomes';

// Also imported, not only re-exported: the result types below are written in
// terms of these, and a re-export alone does not bring a name into scope.
import type { AttemptedStorageCleanup, StorageCleanup } from '../media/media.outcomes';

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

/**
 * The media-wide answers, defined once in the shared media module.
 *
 * Re-exported here because every existing caller imports them from this
 * file. They are not room-type-specific: the size ceiling, the accepted
 * types, the storage seam and the uncertain-commit wording are one contract
 * for every admin media endpoint, and journey media sends the same ones.
 */
export {
  IMAGE_TOO_LARGE_ERROR_CODE,
  IMAGE_TOO_LARGE_ERROR_MESSAGE,
  IMAGE_TOO_LARGE_RESPONSE,
  UNSUPPORTED_IMAGE_TYPE_ERROR_CODE,
  UNSUPPORTED_IMAGE_TYPE_ERROR_MESSAGE,
  UNSUPPORTED_IMAGE_TYPE_RESPONSE,
  INVALID_IMAGE_UPLOAD_ERROR_CODE,
  INVALID_IMAGE_UPLOAD_ERROR_MESSAGE,
  INVALID_IMAGE_UPLOAD_RESPONSE,
  MEDIA_STORAGE_UNAVAILABLE_ERROR_CODE,
  MEDIA_STORAGE_UNAVAILABLE_ERROR_MESSAGE,
  MEDIA_STORAGE_UNAVAILABLE_RESPONSE,
  MEDIA_DELIVERY_UNAVAILABLE_ERROR_CODE,
  MEDIA_DELIVERY_UNAVAILABLE_ERROR_MESSAGE,
  MEDIA_DELIVERY_UNAVAILABLE_RESPONSE,
  MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR_CODE,
  MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_ERROR_MESSAGE,
  MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE,
  MEDIA_OPERATION_FAILED_ERROR_CODE,
  MEDIA_OPERATION_FAILED_ERROR_MESSAGE,
  MEDIA_OPERATION_FAILED_RESPONSE,
} from '../media/media.http';

export const ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_CODE = 'ROOM_TYPE_IMAGE_LIMIT_REACHED';
export const ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_MESSAGE = 'Room type has reached its image limit';

/** The room type already holds `MAX_ROOM_TYPE_IMAGES`. Carries no count — the ceiling is fixed and does not vary by room type. */
export const ROOM_TYPE_IMAGE_LIMIT_REACHED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_CODE,
    message: ROOM_TYPE_IMAGE_LIMIT_REACHED_ERROR_MESSAGE,
  }),
});
