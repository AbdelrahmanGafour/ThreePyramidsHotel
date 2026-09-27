/**
 * The HTTP contract shared by every admin media endpoint.
 *
 * These are the answers that are about media itself rather than about what
 * the image belongs to: a body too large, a type this API will not take,
 * bytes that are not the image they claim to be, storage or delivery that
 * cannot be reached, a commit that never answered, and an object left behind
 * after a failure.
 *
 * Shared because they must not drift. Room-type images and journey images
 * hit the same eight-MiB ceiling, the same three accepted types and the same
 * storage seam, and two copies of `MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN` that
 * could disagree would be two different promises about the same doctrine.
 *
 * Owner-specific answers stay with their own feature: a room type not found,
 * a gallery at its limit, a journey that already has an image. Nothing here
 * names a room type or a journey.
 *
 * Every body is frozen and built once, so a route can only ever send the
 * locked contract rather than a hand-assembled near-copy. None of them
 * echoes a storage key, a checksum, a database id, an endpoint, a bucket or
 * a credential.
 */

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
