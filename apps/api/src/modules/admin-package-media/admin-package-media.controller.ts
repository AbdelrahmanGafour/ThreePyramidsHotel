import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  PACKAGE_NOT_FOUND_RESPONSE,
  isInvalidAdminPackageSlugError,
} from '../admin-packages/admin-packages.types';
// The same parser every other `/admin/packages/:slug` route uses, so a
// malformed address is refused identically wherever it is sent.
import { parseAdminPackageSlugParam } from '../admin-packages/admin-packages.validation';
import { isMediaConfigurationError } from '../media/media.config';
import {
  IMAGE_TOO_LARGE_RESPONSE,
  INVALID_IMAGE_UPLOAD_RESPONSE,
  MEDIA_OPERATION_FAILED_RESPONSE,
  MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE,
  MEDIA_STORAGE_UNAVAILABLE_RESPONSE,
  UNSUPPORTED_IMAGE_TYPE_RESPONSE,
} from '../media/media.http';
import {
  isMediaPersistenceOutcomeUncertainError,
  isMediaUploadCleanupError,
} from '../media/media.outcomes';
import { MAX_SOURCE_BYTES, type MediaStorage, type SourceUploadRejection } from '../media/media.types';
import type { MediaStorageProvider } from '../media/media.storage';
import {
  deletePackageImage,
  replacePackageImage,
  updatePackageImageAltText,
  uploadPackageImage,
} from './admin-package-media.service';
import {
  INVALID_JOURNEY_IMAGE_UPDATE_RESPONSE,
  JOURNEY_IMAGE_EXISTS_RESPONSE,
  JOURNEY_IMAGE_NOT_FOUND_RESPONSE,
  isInvalidJourneyImageUpdateError,
  type AdminPackageImage,
} from './admin-package-media.types';
import { parseJourneyImageAltTextBody } from './admin-package-media.validation';

// The HTTP boundary for a journey's one image.
//
// Three handlers, all factories, so the storage a request uses is a
// parameter of the router that wires them up and never a value this file
// reaches for on its own. Production wires the app's shared lazy R2
// provider; a test wires a double, and nothing here can tell the difference.
//
// Every response body is a frozen contract looked up by name. None is
// assembled from parts of a service answer, and none carries a storage key,
// a checksum, a content type, a byte size, a database id, an endpoint, a
// bucket or a credential.

/**
 * Where one `SourceUploadRejection` from the pure validation module lands in
 * the locked HTTP contract.
 *
 * `too-large` is defensive rather than reachable: the raw body parser is
 * configured with the same `MAX_SOURCE_BYTES` ceiling and refuses an
 * oversized body before validation sees it. It is mapped anyway, so a future
 * change to either ceiling cannot silently fall through to a 500.
 */
function sourceUploadRejectionResponse(reason: SourceUploadRejection): {
  status: number;
  body: object;
} {
  switch (reason) {
    case 'missing-content-type':
    case 'unsupported-content-type':
      return { status: 415, body: UNSUPPORTED_IMAGE_TYPE_RESPONSE };

    case 'too-large':
      return { status: 413, body: IMAGE_TOO_LARGE_RESPONSE };

    case 'empty-body':
    case 'unreadable-signature':
    case 'content-type-mismatch':
      return { status: 400, body: INVALID_IMAGE_UPLOAD_RESPONSE };
  }
}

/**
 * The raw-body middleware for the two routes that accept binary bytes.
 *
 * The same shape the room-type upload uses, and for the same reasons.
 * `type: () => true` reads the body whatever the declared `Content-Type` is —
 * this endpoint's job is to look at bytes a caller says are an image, and the
 * domain validation already owns the decision about that header. Nothing is
 * parsed: `req.body` becomes exactly the bytes that were sent.
 *
 * `limit` is `MAX_SOURCE_BYTES`, imported rather than restated, so the parser
 * and the domain rule can never quietly disagree about where 8 MiB is.
 *
 * Only the size-limit failure is classified here. Anything else `express.raw`
 * could throw is not a known, safe-to-classify condition and continues to
 * `next(error)` as a server problem.
 */
export function rawImageBodyParser(): RequestHandler {
  const upstream = express.raw({ type: () => true, limit: MAX_SOURCE_BYTES });

  return (req: Request, res: Response, next: NextFunction): void => {
    upstream(req, res, (error?: unknown) => {
      if (error === undefined) {
        next();
        return;
      }

      const candidate = error as { type?: unknown; status?: unknown; statusCode?: unknown };

      if (
        candidate.type === 'entity.too.large' &&
        (candidate.status === 413 || candidate.statusCode === 413)
      ) {
        res.status(413).json(IMAGE_TOO_LARGE_RESPONSE);
        return;
      }

      next(error);
    });
  };
}

/**
 * Resolves the real `MediaStorage` for one request, or answers the one way a
 * misconfigured deployment is allowed to fail: safely.
 *
 * Returns `null` after already having written the 503, which is what lets a
 * caller write `const storage = …; if (!storage) return;` without a second
 * branch for the same outcome.
 */
function resolveStorageOrRespond(
  getStorage: MediaStorageProvider,
  res: Response,
): MediaStorage | null {
  try {
    return getStorage();
  } catch (error) {
    if (isMediaConfigurationError(error)) {
      res.status(503).json(MEDIA_STORAGE_UNAVAILABLE_RESPONSE);
      return null;
    }

    throw error;
  }
}

/** The slug, or the 400 the rest of the admin-packages routes already send. */
function readSlugOrRespond(req: Request<{ slug: string }>, res: Response): string | null {
  try {
    return parseAdminPackageSlugParam(req.params.slug);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return null;
    }

    throw error;
  }
}

/**
 * The buffered body, or the 400 for a handler that was wired without the raw
 * parser.
 *
 * Defensive rather than reachable: `rawImageBodyParser` reads every request
 * that gets this far into a Buffer, empty or not. What makes the check
 * necessary is that a handler must never assume so without looking — an
 * uninspected cast is exactly what this refuses.
 */
function readBodyOrRespond(req: Request, res: Response): Buffer | null {
  const body = req.body;

  if (!Buffer.isBuffer(body)) {
    res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    return null;
  }

  return body;
}

/** The one shape a journey image is ever returned in. */
function toResponseBody(image: AdminPackageImage): object {
  return {
    data: {
      reference: image.reference,
      altText: image.altText,
      width: image.width,
      height: image.height,
    },
  };
}

/**
 * The two failures a media write can throw rather than return.
 *
 * Returns true when it has answered. Shared by all three handlers because
 * the mapping is the doctrine, not the operation: an uncertain commit is
 * always 503 and never claims the write did or did not happen, and an
 * orphaned object after a definite failure is always a generic 500 that
 * never carries the key.
 */
function respondToMediaFailure(error: unknown, res: Response): boolean {
  if (isMediaPersistenceOutcomeUncertainError(error)) {
    res.status(503).json(MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE);
    return true;
  }

  if (isMediaUploadCleanupError(error)) {
    res.status(500).json(MEDIA_OPERATION_FAILED_RESPONSE);
    return true;
  }

  return false;
}

/**
 * Adds the one image a journey does not yet have.
 *
 * 201 on success, matching the room-type upload and the general rule that a
 * POST which creates a subordinate resource reports that it did. The body is
 * the image, so an administrator's page can render it without a second read.
 *
 * 409 when the journey already has one. Nothing about the request was wrong
 * and the same bytes sent to PUT would succeed, which is a conflict rather
 * than a validation failure.
 */
export function createUploadPackageImageHandler(
  getStorage: MediaStorageProvider,
): (req: Request<{ slug: string }>, res: Response) => Promise<void> {
  return async function uploadPackageImageHandler(req, res): Promise<void> {
    const slug = readSlugOrRespond(req, res);

    if (slug === null) {
      return;
    }

    const storage = resolveStorageOrRespond(getStorage, res);

    if (!storage) {
      return;
    }

    const body = readBodyOrRespond(req, res);

    if (!body) {
      return;
    }

    let result;

    try {
      result = await uploadPackageImage(
        { storage },
        { slug, declaredContentType: req.headers['content-type'], body },
      );
    } catch (error) {
      if (respondToMediaFailure(error, res)) {
        return;
      }

      throw error;
    }

    switch (result.outcome) {
      case 'uploaded':
        res.status(201).json(toResponseBody(result.image));
        return;

      case 'package-not-found':
        res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
        return;

      case 'image-exists':
        res.status(409).json(JOURNEY_IMAGE_EXISTS_RESPONSE);
        return;

      case 'invalid-upload': {
        const mapped = sourceUploadRejectionResponse(result.reason);

        res.status(mapped.status).json(mapped.body);
        return;
      }

      case 'invalid-image':
        res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
        return;

      case 'media-storage-unavailable':
        res.status(503).json(MEDIA_STORAGE_UNAVAILABLE_RESPONSE);
        return;
    }
  };
}

/**
 * Swaps a journey's image for a new one, atomically.
 *
 * 200 on success, not 201: nothing was created at this address. The journey
 * had an image and still has exactly one, so this is the ordinary "here is
 * the resource as it now stands" answer every other admin PUT in this
 * codebase gives.
 *
 * 404 with `JOURNEY_IMAGE_NOT_FOUND` when there is nothing to replace, kept
 * apart from `PACKAGE_NOT_FOUND`: one says the address is wrong, the other
 * says the address is right and there is nothing there yet.
 */
export function createReplacePackageImageHandler(
  getStorage: MediaStorageProvider,
): (req: Request<{ slug: string }>, res: Response) => Promise<void> {
  return async function replacePackageImageHandler(req, res): Promise<void> {
    const slug = readSlugOrRespond(req, res);

    if (slug === null) {
      return;
    }

    const storage = resolveStorageOrRespond(getStorage, res);

    if (!storage) {
      return;
    }

    const body = readBodyOrRespond(req, res);

    if (!body) {
      return;
    }

    let result;

    try {
      result = await replacePackageImage(
        { storage },
        { slug, declaredContentType: req.headers['content-type'], body },
      );
    } catch (error) {
      if (respondToMediaFailure(error, res)) {
        return;
      }

      throw error;
    }

    switch (result.outcome) {
      case 'replaced':
        res.status(200).json(toResponseBody(result.image));
        return;

      case 'package-not-found':
        res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
        return;

      case 'image-not-found':
        res.status(404).json(JOURNEY_IMAGE_NOT_FOUND_RESPONSE);
        return;

      case 'invalid-upload': {
        const mapped = sourceUploadRejectionResponse(result.reason);

        res.status(mapped.status).json(mapped.body);
        return;
      }

      case 'invalid-image':
        res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
        return;

      case 'media-storage-unavailable':
        res.status(503).json(MEDIA_STORAGE_UNAVAILABLE_RESPONSE);
        return;
    }
  };
}

/**
 * Removes a journey's image.
 *
 * 204 with no body, matching `DELETE /admin/packages/:slug`: there is nothing
 * left to return, and handing back a representation of something that no
 * longer exists would be worse than handing back nothing. In particular it
 * does not report what became of the object — whether the orphan cleanup
 * worked is not the caller's business and does not change what happened.
 *
 * Repeating a successful removal answers 404 `JOURNEY_IMAGE_NOT_FOUND`. The
 * image is gone, and saying so twice would claim a second one was removed.
 */
export function createDeletePackageImageHandler(
  getStorage: MediaStorageProvider,
): (req: Request<{ slug: string }>, res: Response) => Promise<void> {
  return async function deletePackageImageHandler(req, res): Promise<void> {
    const slug = readSlugOrRespond(req, res);

    if (slug === null) {
      return;
    }

    const storage = resolveStorageOrRespond(getStorage, res);

    if (!storage) {
      return;
    }

    let result;

    try {
      result = await deletePackageImage({ storage }, { slug });
    } catch (error) {
      if (respondToMediaFailure(error, res)) {
        return;
      }

      throw error;
    }

    switch (result.outcome) {
      case 'deleted':
        res.status(204).end();
        return;

      case 'package-not-found':
        res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
        return;

      case 'image-not-found':
        res.status(404).json(JOURNEY_IMAGE_NOT_FOUND_RESPONSE);
        return;
    }
  };
}

/**
 * Replaces the description of a journey's image.
 *
 * Not a factory, unlike the three above, and that is the point: this handler
 * takes no `MediaStorageProvider` because the operation it calls takes no
 * storage. There is no provider to resolve, so a deployment with no R2
 * configuration can still describe an image, and no code path exists here
 * that could PUT or DELETE an object.
 *
 * The body is checked for shape before the slug's meaning matters to it:
 * `{"altText": ...}` and nothing else, with the key required to be present.
 * What the value may say — trimmed length, whitespace-only becoming absent —
 * is the shared media rule, applied in the service after this handler has
 * confirmed the request even has the one field this route changes.
 *
 * 200 with the same image shape POST and PUT return, so a page that just
 * changed a description renders from the answer rather than re-reading.
 */
export async function updatePackageImageAltTextHandler(
  req: Request<{ slug: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let altText: unknown;

  try {
    slug = parseAdminPackageSlugParam(req.params.slug);
    altText = parseJourneyImageAltTextBody(req.body);
  } catch (error) {
    if (isInvalidAdminPackageSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    if (isInvalidJourneyImageUpdateError(error)) {
      res.status(400).json(INVALID_JOURNEY_IMAGE_UPDATE_RESPONSE);
      return;
    }

    throw error;
  }

  let result;

  try {
    result = await updatePackageImageAltText({ slug, altText });
  } catch (error) {
    // Only the uncertain commit can reach this. There is no object to clean
    // up, so `MediaUploadCleanupError` cannot be thrown by this path at all
    // — but the mapping is shared, and a second copy that handled one case
    // fewer would be a second contract.
    if (respondToMediaFailure(error, res)) {
      return;
    }

    throw error;
  }

  switch (result.outcome) {
    case 'updated':
      res.status(200).json(toResponseBody(result.image));
      return;

    case 'package-not-found':
      res.status(404).json(PACKAGE_NOT_FOUND_RESPONSE);
      return;

    case 'image-not-found':
      res.status(404).json(JOURNEY_IMAGE_NOT_FOUND_RESPONSE);
      return;

    case 'invalid-alt-text':
      res.status(400).json(INVALID_JOURNEY_IMAGE_UPDATE_RESPONSE);
      return;
  }
}
