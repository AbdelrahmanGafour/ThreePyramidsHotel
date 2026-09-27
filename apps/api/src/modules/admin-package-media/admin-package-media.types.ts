import type { MediaStorage, SourceUploadRejection } from '../media/media.types';
import type { AttemptedStorageCleanup, StorageCleanup } from '../media/media.outcomes';

// The vocabulary of a journey's one image.
//
// Deliberately small. Everything a journey image shares with a room-type
// image — the eight-MiB ceiling, the three accepted source types, the
// normalization pipeline, the storage port, the seam between PostgreSQL and
// R2, and the HTTP answers about media itself — already lives in the shared
// media module and is imported, never restated. What is left here is the two
// facts that are only true of journeys: a journey has at most one image, and
// that is a rule the database states.
//
// No Express, no `pg`, no AWS type. Nothing here reads configuration.

/**
 * What the service is handed rather than reaches for.
 *
 * Only object storage, and only by the three operations that touch it. There
 * is no fourth operation, and no way for one to reach storage without this
 * being a parameter it takes.
 */
export type PackageMediaDependencies = {
  storage: MediaStorage;
};

/**
 * One journey image, as the admin layer is allowed to see it.
 *
 * Four fields. `reference` is the public identity a URL is composed from;
 * `altText` is what an administrator wrote; the dimensions let a page reserve
 * space. Deliberately absent: the database ids, `storage_key`,
 * `checksum_sha256`, `content_type`, the timestamps, and anything naming a
 * bucket or a provider. None of them helps display an image, and the object
 * key and digest in particular are internal facts about how bytes are stored.
 */
export type AdminPackageImage = {
  reference: string;
  altText: string | null;
  width: number;
  height: number;
};

/**
 * Why a use case could not do what was asked, in the domain's own terms.
 *
 * No status codes and no messages for a person to read: the controller maps
 * these onto the locked error bodies, and a use case that already knew about
 * HTTP would be a use case only HTTP could call.
 *
 * `cleanup` rides on every refusal that can happen after the new object has
 * been written. Before the PUT there is nothing to undo and it reads
 * `attempted: false`; after it, the object was written and then removed
 * again, or the removal itself failed and the key is carried out so the
 * orphan can be found.
 */
export type PackageImageUploadResult =
  | { outcome: 'uploaded'; image: AdminPackageImage }
  | { outcome: 'package-not-found'; cleanup: StorageCleanup }
  | { outcome: 'image-exists'; cleanup: AttemptedStorageCleanup }
  | { outcome: 'invalid-upload'; reason: SourceUploadRejection }
  | { outcome: 'invalid-image' }
  | { outcome: 'media-storage-unavailable' };

/**
 * The atomic replacement's answers.
 *
 * `image-not-found` is a refusal, not a fallback: replacing an image a
 * journey does not have is a different request from adding one, and quietly
 * turning it into an upload would let a stale page create an image its
 * administrator believed already existed.
 *
 * There is no `cleanup` on success. The object that was displaced is removed
 * after the commit, and whether that removal worked does not change the fact
 * that the replacement happened — so it is not part of the answer.
 */
export type PackageImageReplaceResult =
  | { outcome: 'replaced'; image: AdminPackageImage }
  | { outcome: 'package-not-found'; cleanup: StorageCleanup }
  | { outcome: 'image-not-found'; cleanup: AttemptedStorageCleanup }
  | { outcome: 'invalid-upload'; reason: SourceUploadRejection }
  | { outcome: 'invalid-image' }
  | { outcome: 'media-storage-unavailable' };

/**
 * The removal's answers.
 *
 * `cleanup` appears only on success, and only describes what happened to the
 * object *after* the rows were gone. A refusal makes no storage call at all,
 * so there is nothing for it to report.
 */
export type PackageImageDeleteResult =
  | { outcome: 'deleted'; cleanup: AttemptedStorageCleanup }
  | { outcome: 'package-not-found' }
  | { outcome: 'image-not-found' };

/**
 * Describing the image, which touches no object at all.
 *
 * The only journey media result with no `cleanup` anywhere on it, because
 * the only storage this operation could have done is none. It takes no
 * `PackageMediaDependencies` for the same reason.
 *
 * `invalid-alt-text` carries the shared module's own reason so the
 * controller can answer the same way the room-type route does, without this
 * layer knowing what 240 is.
 */
export type PackageImageAltTextResult =
  | { outcome: 'updated'; image: AdminPackageImage }
  | { outcome: 'package-not-found' }
  | { outcome: 'image-not-found' }
  | { outcome: 'invalid-alt-text' };

// ---------------------------------------------------------------------------
// The HTTP contract
// ---------------------------------------------------------------------------
//
// Only the two answers that are about a journey's image specifically. Every
// other response these routes can send — too large, unsupported type,
// invalid upload, storage unavailable, uncertain commit, operation failed —
// is the shared media contract in `media/media.http.ts`, sent unchanged, so
// the two admin media features can never drift on what those mean.
//
// A journey that does not exist answers with the admin-packages module's own
// `PACKAGE_NOT_FOUND_RESPONSE`, for the same reason: a caller addressing
// `/admin/packages/:slug/image` should get the same "no such journey" they
// get from every other route under that slug.

export const JOURNEY_IMAGE_EXISTS_ERROR_CODE = 'JOURNEY_IMAGE_EXISTS';
export const JOURNEY_IMAGE_EXISTS_ERROR_MESSAGE = 'This journey already has an image';

/**
 * The journey already holds its one image.
 *
 * A conflict rather than a validation failure: nothing about the request was
 * wrong, and the same bytes sent to `PUT` would succeed. Carries no reference
 * and no dimensions — a caller who needs to know what is already there reads
 * the journey.
 */
export const JOURNEY_IMAGE_EXISTS_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: JOURNEY_IMAGE_EXISTS_ERROR_CODE,
    message: JOURNEY_IMAGE_EXISTS_ERROR_MESSAGE,
  }),
});

export const INVALID_JOURNEY_IMAGE_UPDATE_ERROR_CODE = 'INVALID_JOURNEY_IMAGE_UPDATE';
export const INVALID_JOURNEY_IMAGE_UPDATE_ERROR_MESSAGE = 'Invalid journey image update';

/**
 * A PATCH body this endpoint does not accept: the wrong shape, a missing
 * `altText`, an unknown or extra key, or a value the domain rules refuse —
 * not a string, or too long once trimmed.
 *
 * One message for every reason, matching this codebase's rule that naming
 * which value inside a body was wrong would map fields a caller has no
 * business learning about. The length limit in particular is not quoted
 * back: it belongs to the shared media module, and repeating it in a
 * response would be a second place it could drift from.
 */
export class InvalidJourneyImageUpdateError extends Error {
  readonly code = INVALID_JOURNEY_IMAGE_UPDATE_ERROR_CODE;

  constructor() {
    super(INVALID_JOURNEY_IMAGE_UPDATE_ERROR_MESSAGE);
    this.name = 'InvalidJourneyImageUpdateError';
  }
}

export function isInvalidJourneyImageUpdateError(
  error: unknown,
): error is InvalidJourneyImageUpdateError {
  return error instanceof InvalidJourneyImageUpdateError;
}

/** The frozen body for every reason `InvalidJourneyImageUpdateError` covers. */
export const INVALID_JOURNEY_IMAGE_UPDATE_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: INVALID_JOURNEY_IMAGE_UPDATE_ERROR_CODE,
    message: INVALID_JOURNEY_IMAGE_UPDATE_ERROR_MESSAGE,
  }),
});

export const JOURNEY_IMAGE_NOT_FOUND_ERROR_CODE = 'JOURNEY_IMAGE_NOT_FOUND';
export const JOURNEY_IMAGE_NOT_FOUND_ERROR_MESSAGE = 'This journey has no image';

/**
 * The journey exists and has no image.
 *
 * Distinct from `PACKAGE_NOT_FOUND`, and the difference is worth the second
 * code: one says the address is wrong, the other says the address is right
 * and there is nothing there yet. An administrator acts differently on each.
 */
export const JOURNEY_IMAGE_NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: JOURNEY_IMAGE_NOT_FOUND_ERROR_CODE,
    message: JOURNEY_IMAGE_NOT_FOUND_ERROR_MESSAGE,
  }),
});
