import type { Request, RequestHandler, Response } from 'express';
import { composePublicMediaUrl, type PublicMediaBaseUrlProvider } from '../media/media.delivery';
import { parseMediaReference } from '../media/media.validation';
import { findActiveRoomTypeBySlug, findActiveRoomTypes } from './rooms.repository';
import type { PublicRoomTypeImage, RoomTypeRecord, RoomTypeResponse } from './rooms.types';

/**
 * Resolves the public media base at most once per request, and only if an
 * image actually needs a URL.
 *
 * This is the whole of the configuration rule for these two endpoints. A room
 * type with no images is served without `R2_PUBLIC_BASE_URL` ever being read,
 * so a deployment that has not configured media yet still serves rooms — the
 * media base is only required by a response that genuinely contains media.
 *
 * The other half matters just as much: when images DO exist and the base is
 * missing or malformed, the `MediaConfigurationError` propagates. It is not
 * caught, and images are never quietly reported as `[]`. Answering "this room
 * has no pictures" because the server cannot work out where its pictures live
 * would be a lie that looks exactly like the truth, and it would hide a
 * broken deployment behind a page that renders perfectly well.
 */
function createMediaBaseResolver(getPublicMediaBaseUrl: PublicMediaBaseUrlProvider): () => string {
  let resolved: string | null = null;

  return () => {
    if (resolved === null) {
      resolved = getPublicMediaBaseUrl();
    }

    return resolved;
  };
}

/**
 * A reference that is not canonical is this system's own data being wrong,
 * not anything the guest did. It is left to surface as an unexpected 500
 * rather than dressed up as a room that has no images.
 *
 * The offending value is deliberately not in the message: this is a public
 * endpoint, and an internal identifier does not belong in an error a guest's
 * request produced. The admin path names it, which is the right call there —
 * that reader is an administrator fixing their own data.
 */
function toPublicImage(
  record: RoomTypeRecord['images'][number],
  resolveMediaBase: () => string,
): PublicRoomTypeImage {
  const reference = parseMediaReference(record.reference);

  if (reference === null) {
    throw new Error('Persisted room type media reference is not canonical');
  }

  return {
    url: composePublicMediaUrl(resolveMediaBase(), reference),
    altText: record.altText,
    width: record.width,
    height: record.height,
    isCover: record.isCover,
  };
}

function toRoomTypeResponse(record: RoomTypeRecord, resolveMediaBase: () => string): RoomTypeResponse {
  return {
    ...record,
    images: record.images.map((image) => toPublicImage(image, resolveMediaBase)),
  };
}

// Database errors are intentionally not caught here: an unexpected failure must
// surface as a server error through Express, never as a 404.
export function createListRoomTypesHandler(
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider,
): RequestHandler {
  return async function listRoomTypes(_req: Request, res: Response): Promise<void> {
    const records = await findActiveRoomTypes();
    const resolveMediaBase = createMediaBaseResolver(getPublicMediaBaseUrl);

    // Composed in full BEFORE the response is touched. `res.status(200)`
    // mutates the response even though nothing is sent yet, so composing
    // inside the `json()` argument would leave a half-configured 200 behind
    // on a media configuration failure and rely on the error handler to undo
    // it. Nothing is written here until there is a whole body to write.
    const data = records.map((record) => toRoomTypeResponse(record, resolveMediaBase));

    res.status(200).json({ data });
  };
}

export function createGetRoomTypeBySlugHandler(
  getPublicMediaBaseUrl: PublicMediaBaseUrlProvider,
): RequestHandler {
  return async function getRoomTypeBySlug(req: Request, res: Response): Promise<void> {
    const record = await findActiveRoomTypeBySlug((req.params as { slug: string }).slug);

    // Unknown and inactive slugs are indistinguishable to the public API.
    if (!record) {
      res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: 'Room type not found',
        },
      });
      return;
    }

    // Composed before the response is touched, for the reason given above.
    const data = toRoomTypeResponse(record, createMediaBaseResolver(getPublicMediaBaseUrl));

    res.status(200).json({ data });
  };
}
