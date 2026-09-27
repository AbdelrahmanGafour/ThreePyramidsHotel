import { hasExactlyKey, isPlainJsonObject } from '../media/media.body';
import { InvalidJourneyImageUpdateError } from './admin-package-media.types';

/**
 * What a PATCH body is allowed to look like, before any of its values reach
 * the service.
 *
 * Shape only. Whether the carried value is acceptable — a string, short
 * enough, not something else entirely — is `normalizeAltText`'s decision in
 * the shared media module, and this file is not a second copy of it. What
 * lives here is whether the request even has the one field this route
 * changes.
 *
 * Deliberately the same rules the room-type alt-text route already applies,
 * through the same shared helpers: exactly one key, `altText`, present.
 * `{"altText": null}` clears the description; a body that omits the key is
 * refused rather than read as that same null, because leaving a field out
 * and asking to clear it are different requests. A second key is refused
 * whatever it says.
 *
 * Nothing this route accepts can name a stored object. There is no field for
 * a storage key, a media reference, an asset id or a filename, so a crafted
 * body has nothing to substitute — the image being described is the one the
 * journey in the URL currently has, and the transaction reads that under a
 * lock.
 *
 * Pure: no database, no Express, no I/O.
 */
export function parseJourneyImageAltTextBody(body: unknown): unknown {
  if (!isPlainJsonObject(body) || !hasExactlyKey(body, 'altText')) {
    throw new InvalidJourneyImageUpdateError();
  }

  return body.altText;
}
