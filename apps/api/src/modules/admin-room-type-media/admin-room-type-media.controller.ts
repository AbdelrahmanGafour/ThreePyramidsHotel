import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { isMediaConfigurationError } from '../media/media.config';
import { composePublicMediaUrl, type PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { MAX_SOURCE_BYTES } from '../media/media.types';
import type { MediaStorageProvider } from '../media/media.storage';
import type { MediaReference, MediaStorage, SourceUploadRejection } from '../media/media.types';
import { parseMediaReference } from '../media/media.validation';
import {
  ROOM_TYPE_NOT_FOUND_RESPONSE,
  isInvalidRoomTypeSlugError,
} from '../admin-room-types/admin-room-types.types';
import { parseRoomTypeSlugParam } from '../admin-room-types/admin-room-types.validation';
import {
  deleteRoomTypeImage,
  listRoomTypeImages,
  moveRoomTypeImage,
  setRoomTypeImageCover,
  uploadRoomTypeImage,
  updateRoomTypeImageAltText,
} from './admin-room-type-media.service';
import {
  IMAGE_TOO_LARGE_RESPONSE,
  INVALID_IMAGE_UPLOAD_RESPONSE,
  INVALID_ROOM_TYPE_IMAGE_REFERENCE_RESPONSE,
  INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE,
  MEDIA_DELIVERY_UNAVAILABLE_RESPONSE,
  MEDIA_OPERATION_FAILED_RESPONSE,
  MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE,
  MEDIA_STORAGE_UNAVAILABLE_RESPONSE,
  ROOM_TYPE_IMAGE_LIMIT_REACHED_RESPONSE,
  ROOM_TYPE_IMAGE_NOT_FOUND_RESPONSE,
  UNSUPPORTED_IMAGE_TYPE_RESPONSE,
  isInvalidRoomTypeImageUpdateError,
  isMediaPersistenceOutcomeUncertainError,
  isMediaUploadCleanupError,
  type AdminRoomTypeImage,
} from './admin-room-type-media.types';
import {
  assertNoCoverUpdateBody,
  parseAltTextUpdateBody,
  parseOrderUpdateBody,
} from './admin-room-type-media.validation';

// The callers reaching every handler below are already authenticated:
// `requireAdminSession` guards every route in `admin-room-type-media.routes.ts`
// and runs first in each chain, so nothing here re-checks a session.
//
// The room-type slug is validated with the canonical parser from the
// room-types module, never a second copy. An image reference is deliberately
// NOT re-validated here before it reaches the service: `parseMediaReference`
// already lives in the media module, every mutation already calls it, and its
// `invalid-image-reference` outcome is mapped below like any other outcome.
// Parsing it twice would be two places for that one rule to drift apart.
//
// Nothing about PostgreSQL, Sharp, the AWS SDK or R2 reaches this layer. A
// service outcome or a named error is already the whole of what happened; no
// SQLSTATE, libvips message, signed request or credential appears in any
// response, and no rejected upload byte is echoed back.
//
// Storage is a dependency of exactly the two handlers that touch it — upload
// and delete — and it arrives as a `MediaStorageProvider`, resolved once per
// request rather than once per process. Resolving it is the only place either
// handler can fail before a single validation rule runs, which is why it
// happens right after the slug: a misconfigured deployment answers 503 before
// anything about the request itself is examined.

/**
 * The admin-safe shape of one image: everything an administrator's browser
 * may see, and nothing this module keeps for its own bookkeeping.
 *
 * Built here, not in the repository or the service, because stripping is an
 * HTTP concern — the service still needs `storageKey` to hand to
 * `MediaStorage`, and the repository still needs it to build the row in the
 * first place. `checksumSha256` is an integrity fact for this system's own
 * use, not information a caller asked for. Neither internal id ever reached
 * `AdminRoomTypeImage` in the first place, so there is nothing to strip for
 * those two.
 *
 * `url` is composed here, from the reference and a resolved public base — the
 * one and only value derived from `storageKey` that a caller is allowed to
 * see, and even that is rebuilt from the reference rather than exposing the
 * key itself.
 */
export type AdminSafeRoomTypeImage = {
  reference: string;
  url: string;
  contentType: AdminRoomTypeImage['contentType'];
  byteSize: number;
  width: number;
  height: number;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * A persisted reference, proven canonical again before it is trusted to build
 * a URL.
 *
 * `media_assets.reference` is a `uuid` column this system only ever writes
 * through `createMediaReference()`, so a row that fails this check is not a
 * caller's mistake — it is this system's own data being wrong, which
 * `parseMediaReference` cannot repair and must not be asked to. That is why
 * this throws a bare `Error` rather than answering `INVALID_ROOM_TYPE_IMAGE_
 * REFERENCE`: the administrator making this request supplied no reference at
 * all for a list, and supplied a *different* one for a mutation that already
 * passed its own validation — either way, blaming the request would be
 * wrong. Uncaught here, it becomes the same unexpected 500 any other broken
 * invariant in this codebase does.
 */
function toCanonicalReference(value: string): MediaReference {
  const reference = parseMediaReference(value);

  if (reference === null) {
    throw new Error(`Persisted media reference is not canonical: ${value}`);
  }

  return reference;
}

/** The one place `storageKey` and `checksumSha256` are dropped. Built field by field, never spread. */
export function toAdminSafeRoomTypeImage(image: AdminRoomTypeImage, publicBase: string): AdminSafeRoomTypeImage {
  return {
    reference: image.reference,
    url: composePublicMediaUrl(publicBase, toCanonicalReference(image.reference)),
    contentType: image.contentType,
    byteSize: image.byteSize,
    width: image.width,
    height: image.height,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isCover: image.isCover,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
}

/**
 * Where one `SourceUploadRejection` reason from the pure validation module
 * lands in the locked HTTP contract.
 *
 * `too-large` is defensive rather than reachable: the raw body parser is
 * configured with the same `MAX_SOURCE_BYTES` ceiling and refuses an
 * oversized body before it is ever handed to this validation, so the service
 * itself should never produce this reason over HTTP. It is mapped anyway, so
 * a future change to either ceiling cannot silently fall through to a 500.
 */
function sourceUploadRejectionResponse(reason: SourceUploadRejection): { status: number; body: object } {
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
 * The raw-body middleware for the one route that accepts binary bytes.
 *
 * `type: () => true` makes it read the body regardless of the declared
 * `Content-Type` — this endpoint's whole job is to look at bytes the caller
 * says are an image, and refusing to buffer them until after checking the
 * header would just mean sniffing the header twice, once here and once in the
 * domain validation that already owns that decision. Nothing is parsed:
 * `req.body` becomes exactly the bytes that were sent, or an empty buffer for
 * none.
 *
 * `limit` is `MAX_SOURCE_BYTES` — the one ceiling this whole feature agrees
 * on, imported rather than restated, so the parser and the domain rule can
 * never quietly disagree about where 8 MiB is.
 *
 * Only the size-limit failure is handled here, and handled as the locked
 * `IMAGE_TOO_LARGE` contract with no body-parser internals attached. Anything
 * else `express.raw` could throw — a malformed request line, a broken
 * connection — is not a known, safe-to-classify condition, so it continues to
 * `next(error)` and is handled the way every other unexpected error in this
 * codebase is: as a server problem, not a business answer.
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

      if (candidate.type === 'entity.too.large' && (candidate.status === 413 || candidate.statusCode === 413)) {
        res.status(413).json(IMAGE_TOO_LARGE_RESPONSE);
        return;
      }

      next(error);
    });
  };
}

/**
 * Resolves the real `MediaStorage` for one request, or answers the one way a
 * misconfigured deployment is allowed to fail: safely, and without ever
 * starting up broken.
 *
 * Returns `null` after already having written the 503 response, which is what
 * lets a caller do `const storage = resolveStorage(...); if (!storage) return;`
 * without a second branch for the same outcome.
 */
function resolveStorageOrRespond(getStorage: MediaStorageProvider, res: Response): MediaStorage | null {
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

/**
 * Resolves the public media base URL for one request, or answers the one way
 * a missing or invalid `R2_PUBLIC_BASE_URL` is allowed to fail: safely, and
 * as a distinct code from `MEDIA_STORAGE_UNAVAILABLE`. Object storage can be
 * entirely healthy while nobody has yet configured where images are served
 * from, and an operator told the wrong system is broken has to rediscover
 * which one actually is.
 *
 * Same `null`-after-responding shape as `resolveStorageOrRespond`, for the
 * same reason: `const base = resolvePublicMediaBaseUrlOrRespond(...); if
 * (!base) return;` needs no second branch for the outcome already handled.
 */
function resolvePublicMediaBaseUrlOrRespond(
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider,
  res: Response,
): string | null {
  try {
    return getPublicMediaBaseUrl();
  } catch (error) {
    if (isMediaConfigurationError(error)) {
      res.status(503).json(MEDIA_DELIVERY_UNAVAILABLE_RESPONSE);
      return null;
    }

    throw error;
  }
}

/**
 * Every image of one room type.
 *
 * A factory, like upload and delete, so the public base URL a request's
 * `url` fields are built from is a parameter of the router that wires this
 * handler up rather than a value this file reaches for on its own.
 *
 * No storage call, and no lock: the service's list path takes none either. A
 * missing room type is a 404, never an empty gallery — a room type with no
 * images yet is a real, listable state, and this system keeps the two
 * distinct throughout.
 *
 * The base is resolved AFTER the room type is confirmed to exist, not before:
 * a request for a slug nobody has used is a 404 whether or not delivery is
 * configured, and asking about delivery configuration first would make an
 * unrelated 404 depend on it.
 */
export function createListRoomTypeImagesHandler(
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider,
): (req: Request<{ slug: string }>, res: Response) => Promise<void> {
  return async function listRoomTypeImagesHandler(
    req: Request<{ slug: string }>,
    res: Response,
  ): Promise<void> {
    let slug: string;

    try {
      slug = parseRoomTypeSlugParam(req.params.slug);
    } catch (error) {
      if (isInvalidRoomTypeSlugError(error)) {
        res.status(400).json({ error: { code: error.code, message: error.message } });
        return;
      }

      throw error;
    }

    const result = await listRoomTypeImages(slug);

    switch (result.outcome) {
      case 'listed': {
        const publicBase = resolvePublicMediaBaseUrlOrRespond(getPublicMediaBaseUrl, res);

        if (!publicBase) {
          return;
        }

        res.status(200).json({
          data: { images: result.images.map((image) => toAdminSafeRoomTypeImage(image, publicBase)) },
        });
        return;
      }

      case 'room-type-not-found':
        res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
        return;
    }
  };
}

/**
 * Accepts one uploaded image for a room type.
 *
 * A factory rather than a bare export, so the storage a request actually uses
 * is a parameter of the router that wires this handler up, never a value this
 * file reaches for on its own. Production wires the lazy R2 provider; a test
 * wires a double, and nothing here can tell the difference.
 *
 * `req.body` is asserted to be a `Buffer` before it is trusted as one — never
 * cast. `rawImageBodyParser` always produces a Buffer for a request that
 * reaches this far, so the branch below is defensive rather than a path a
 * well-formed client can reach; what makes it necessary is that this handler
 * must never assume so without checking.
 *
 * The declared `Content-Type` is read exactly as the client sent it —
 * `req.headers['content-type']` is Node's raw header value, never re-cased,
 * trimmed or stripped of parameters — and handed to the service unexamined.
 * The domain rule owns what counts as a match, not this controller.
 */
export function createUploadRoomTypeImageHandler(
  getStorage: MediaStorageProvider,
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider,
): (req: Request<{ slug: string }>, res: Response) => Promise<void> {
  return async function uploadRoomTypeImageHandler(
    req: Request<{ slug: string }>,
    res: Response,
  ): Promise<void> {
    let slug: string;

    try {
      slug = parseRoomTypeSlugParam(req.params.slug);
    } catch (error) {
      if (isInvalidRoomTypeSlugError(error)) {
        res.status(400).json({ error: { code: error.code, message: error.message } });
        return;
      }

      throw error;
    }

    // Resolved before storage, and before a single byte of the buffered body
    // is inspected. A successful upload whose response the caller can never
    // build — because delivery was never configured — would be strictly
    // worse than refusing it up front: the object would exist, the row would
    // exist, and the only thing the caller would be told is that something
    // unrelated to what they asked for is broken.
    const publicBase = resolvePublicMediaBaseUrlOrRespond(getPublicMediaBaseUrl, res);

    if (!publicBase) {
      return;
    }

    const storage = resolveStorageOrRespond(getStorage, res);

    if (!storage) {
      return;
    }

    const body = req.body;

    if (!Buffer.isBuffer(body)) {
      // Defensive: `rawImageBodyParser` reads every request that reaches this
      // handler into a Buffer, empty or not. This is reachable only if that
      // changes, or if this handler is ever wired up without it — and either
      // way, an uninspected cast is exactly what this branch exists to
      // refuse.
      res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
      return;
    }

    let result;

    try {
      result = await uploadRoomTypeImage(
        { storage },
        { slug, declaredContentType: req.headers['content-type'], body },
      );
    } catch (error) {
      if (isMediaPersistenceOutcomeUncertainError(error)) {
        res.status(503).json(MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE);
        return;
      }

      if (isMediaUploadCleanupError(error)) {
        res.status(500).json(MEDIA_OPERATION_FAILED_RESPONSE);
        return;
      }

      throw error;
    }

    switch (result.outcome) {
      case 'uploaded':
        res.status(201).json({ data: toAdminSafeRoomTypeImage(result.image, publicBase) });
        return;

      case 'room-type-not-found':
        res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
        return;

      case 'image-limit-reached':
        res.status(409).json(ROOM_TYPE_IMAGE_LIMIT_REACHED_RESPONSE);
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
 * Replaces one image's alt text.
 *
 * The body is checked for shape before the slug's meaning or the reference's
 * validity matter to it: `{"altText": ...}` and nothing else, with the key
 * required to be present. What the value itself may say — trimmed length,
 * whitespace-only becoming absent — is the service's rule, applied after this
 * handler has already confirmed the request even has the one field this route
 * changes.
 */
export async function updateRoomTypeImageAltTextHandler(
  req: Request<{ slug: string; imageReference: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let altText: unknown;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    altText = parseAltTextUpdateBody(req.body);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    // InvalidRoomTypeImageUpdateError carries the one locked body for every
    // reason a PATCH body can be wrong, so it is sent directly rather than
    // rebuilt from the error's own fields.
    if (isInvalidRoomTypeImageUpdateError(error)) {
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE);
      return;
    }

    throw error;
  }

  let result;

  try {
    result = await updateRoomTypeImageAltText({ slug, imageReference: req.params.imageReference, altText });
  } catch (error) {
    if (isMediaPersistenceOutcomeUncertainError(error)) {
      res.status(503).json(MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE);
      return;
    }

    throw error;
  }

  switch (result.outcome) {
    case 'updated':
      res.status(204).end();
      return;

    case 'room-type-not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;

    case 'image-not-found':
      res.status(404).json(ROOM_TYPE_IMAGE_NOT_FOUND_RESPONSE);
      return;

    case 'invalid-image-reference':
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_REFERENCE_RESPONSE);
      return;

    case 'invalid-alt-text':
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE);
      return;
  }
}

/**
 * Makes one image the room type's cover.
 *
 * The route names the action, so a body has nothing to add. Any body carrying
 * a field — including one that agrees with what this route already does — is
 * refused rather than read: `{"isCover": true}` is not a smaller, harmless
 * version of this request, it is a different kind of request this endpoint
 * does not offer.
 *
 * Selecting the image that is already the cover succeeds and answers 204
 * exactly like any other selection, because it is one — an administrator
 * asking for something already true has not made a mistake.
 */
export async function setRoomTypeImageCoverHandler(
  req: Request<{ slug: string; imageReference: string }>,
  res: Response,
): Promise<void> {
  let slug: string;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    assertNoCoverUpdateBody(req.body);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    if (isInvalidRoomTypeImageUpdateError(error)) {
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE);
      return;
    }

    throw error;
  }

  let result;

  try {
    result = await setRoomTypeImageCover({ slug, imageReference: req.params.imageReference });
  } catch (error) {
    if (isMediaPersistenceOutcomeUncertainError(error)) {
      res.status(503).json(MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE);
      return;
    }

    throw error;
  }

  switch (result.outcome) {
    case 'updated':
      res.status(204).end();
      return;

    case 'room-type-not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;

    case 'image-not-found':
      res.status(404).json(ROOM_TYPE_IMAGE_NOT_FOUND_RESPONSE);
      return;

    case 'invalid-image-reference':
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_REFERENCE_RESPONSE);
      return;
  }
}

/**
 * Moves one image one step through its gallery.
 *
 * `{"direction": "up" | "down"}` and nothing else — no submitted position, no
 * `sortOrder`. `boundary` is a success, sent as the same 204 as `moved`: the
 * first image cannot move up, and asking anyway is a valid request for
 * something already true, not a conflict.
 */
export async function updateRoomTypeImageOrderHandler(
  req: Request<{ slug: string; imageReference: string }>,
  res: Response,
): Promise<void> {
  let slug: string;
  let direction: unknown;

  try {
    slug = parseRoomTypeSlugParam(req.params.slug);
    direction = parseOrderUpdateBody(req.body);
  } catch (error) {
    if (isInvalidRoomTypeSlugError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }

    if (isInvalidRoomTypeImageUpdateError(error)) {
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE);
      return;
    }

    throw error;
  }

  let result;

  try {
    result = await moveRoomTypeImage({ slug, imageReference: req.params.imageReference, direction });
  } catch (error) {
    if (isMediaPersistenceOutcomeUncertainError(error)) {
      res.status(503).json(MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE);
      return;
    }

    throw error;
  }

  switch (result.outcome) {
    case 'moved':
    case 'boundary':
      res.status(204).end();
      return;

    case 'room-type-not-found':
      res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
      return;

    case 'image-not-found':
      res.status(404).json(ROOM_TYPE_IMAGE_NOT_FOUND_RESPONSE);
      return;

    case 'invalid-image-reference':
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_REFERENCE_RESPONSE);
      return;

    case 'invalid-order-direction':
      res.status(400).json(INVALID_ROOM_TYPE_IMAGE_UPDATE_RESPONSE);
      return;
  }
}

/**
 * Removes one image from a room type.
 *
 * A factory, for the same reason upload is one: this is the other handler
 * that touches storage, and only the router that wires it up decides which
 * `MediaStorage` that is.
 *
 * Success is 204 whether or not the object's removal from storage afterward
 * actually succeeded — that cleanup is internal, orphan-reconciliation state,
 * never something a browser is told. What definitely happened, and what this
 * status answers for, is that PostgreSQL committed the deletion.
 *
 * An uncertain commit is not success and is not failure: it is answered as
 * neither, through the same 503 the upload path uses for the same reason.
 */
export function createDeleteRoomTypeImageHandler(
  getStorage: MediaStorageProvider,
): (req: Request<{ slug: string; imageReference: string }>, res: Response) => Promise<void> {
  return async function deleteRoomTypeImageHandler(
    req: Request<{ slug: string; imageReference: string }>,
    res: Response,
  ): Promise<void> {
    let slug: string;

    try {
      slug = parseRoomTypeSlugParam(req.params.slug);
    } catch (error) {
      if (isInvalidRoomTypeSlugError(error)) {
        res.status(400).json({ error: { code: error.code, message: error.message } });
        return;
      }

      throw error;
    }

    const storage = resolveStorageOrRespond(getStorage, res);

    if (!storage) {
      return;
    }

    let result;

    try {
      result = await deleteRoomTypeImage({ storage }, { slug, imageReference: req.params.imageReference });
    } catch (error) {
      if (isMediaPersistenceOutcomeUncertainError(error)) {
        res.status(503).json(MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN_RESPONSE);
        return;
      }

      throw error;
    }

    switch (result.outcome) {
      case 'deleted':
        // `result.cleanup` is deliberately not read. Whether the storage
        // object came off successfully afterward is not this response's
        // business — the deletion the caller asked for already happened.
        res.status(204).end();
        return;

      case 'room-type-not-found':
        res.status(404).json(ROOM_TYPE_NOT_FOUND_RESPONSE);
        return;

      case 'image-not-found':
        res.status(404).json(ROOM_TYPE_IMAGE_NOT_FOUND_RESPONSE);
        return;

      case 'invalid-image-reference':
        res.status(400).json(INVALID_ROOM_TYPE_IMAGE_REFERENCE_RESPONSE);
        return;
    }
  };
}
