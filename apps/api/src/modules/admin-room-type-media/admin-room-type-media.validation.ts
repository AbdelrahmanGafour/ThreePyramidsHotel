import { hasExactlyKey, isPlainJsonObject } from '../media/media.body';
import { InvalidRoomTypeImageUpdateError } from './admin-room-type-media.types';

/**
 * What a PATCH body is allowed to look like, before any of its values reach
 * the service.
 *
 * This module checks shape only: whether the body is a plain object, which
 * key or keys it may carry, and nothing about whether a carried value is
 * itself acceptable. `altText` may be any string or `null` here and still be
 * refused by `normalizeAltText`; `direction` may be any string here and still
 * be refused by `parseMediaOrderDirection`. The service remains the one place
 * that judges a value — this file only judges the request's shape, which the
 * service never sees.
 *
 * Pure: no database, no Express, no I/O.
 */

/** Internal. Never leaves this module; each public parser converts it. */
class ImageUpdateBodyError extends Error {
  constructor() {
    super('Invalid room type image update body');
    this.name = 'ImageUpdateBodyError';
  }
}

function fail(): never {
  throw new ImageUpdateBodyError();
}

function underContract<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ImageUpdateBodyError) {
      throw new InvalidRoomTypeImageUpdateError();
    }

    throw error;
  }
}

/**
 * A JSON object and nothing else, raising this module's own error.
 *
 * The rule itself lives in `media/media.body.ts` and is shared with the
 * journey media routes — the prototype subtlety is exactly the kind of thing
 * that should not be written twice. What stays here is which error a failure
 * becomes, which is this feature's own.
 */
function requirePlainJsonObject(body: unknown): Record<string, unknown> {
  if (!isPlainJsonObject(body)) {
    fail();
  }

  return body;
}

/**
 * The alt-text PATCH body: exactly one key, `altText`, present.
 *
 * "Present" is the whole of the check. A caller who wants to clear a
 * description sends `{"altText": null}` — an explicit value — and a body that
 * omits the key entirely is refused rather than read as that same null,
 * because leaving a field out and asking to clear it are different requests.
 * `{"altText": "text", "isCover": true}` is refused for the second key alone,
 * whatever `isCover` says: this route changes one thing, and a body that
 * reaches for a second is not a body this route accepts.
 *
 * The returned value is whatever was submitted under `altText`, unexamined
 * beyond being present — `normalizeAltText` in the service is what judges it.
 */
export function parseAltTextUpdateBody(body: unknown): unknown {
  return underContract(() => {
    const record = requirePlainJsonObject(body);

    if (!hasExactlyKey(record, 'altText')) {
      fail();
    }

    return record.altText;
  });
}

/**
 * The order PATCH body: exactly one key, `direction`, present.
 *
 * No `sortOrder`, no numeric position — the public contract for reordering is
 * "move this one step", never a submitted index, and a body naming one is
 * refused rather than ignored. The returned value is passed to the service
 * untouched; `parseMediaOrderDirection` is what decides whether it is "up",
 * "down", or neither.
 */
export function parseOrderUpdateBody(body: unknown): unknown {
  return underContract(() => {
    const record = requirePlainJsonObject(body);

    if (!hasExactlyKey(record, 'direction')) {
      fail();
    }

    return record.direction;
  });
}

/**
 * The cover PATCH body: no mutable field, ever.
 *
 * The route names the action — "make this image the cover" — so there is
 * nothing left for a body to decide. An absent body and an empty object both
 * mean nothing was asked to change beyond what the URL already says, and both
 * are accepted; any key at all, including a well-meaning `{"isCover": true}`
 * that already agrees with what the route does, is refused. A body that
 * happens to ask for the same thing the route was already going to do is
 * still a body claiming a control this endpoint does not offer.
 */
export function assertNoCoverUpdateBody(body: unknown): void {
  underContract(() => {
    if (body === undefined) {
      return;
    }

    const record = requirePlainJsonObject(body);

    if (Object.keys(record).length !== 0) {
      fail();
    }
  });
}
