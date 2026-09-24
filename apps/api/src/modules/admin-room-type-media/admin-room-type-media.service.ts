import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import { insertMediaAsset, deleteMediaAssetById } from '../media/media.repository';
import { normalizeImage } from '../media/media.processing';
import {
  checkRoomTypeImageCount,
  checkSourceUpload,
  createMediaReference,
  mediaStorageKey,
  normalizeAltText,
  parseMediaOrderDirection,
  parseMediaReference,
} from '../media/media.validation';
import type { MediaStorage } from '../media/media.types';
import {
  compactRoomTypeImageOrder,
  countRoomTypeImages,
  deleteRoomTypeImageRelation,
  findFirstRoomTypeImageId,
  findRoomTypeForMedia,
  insertRoomTypeImage,
  listRoomTypeImages as listRoomTypeImageRows,
  lockRoomTypeForMediaChange,
  lockScopedRoomTypeImage,
  moveRoomTypeImage as moveRoomTypeImageRows,
  nextRoomTypeImageSortOrder,
  setRoomTypeImageAsCover,
  updateRoomTypeImageAltText as updateRoomTypeImageAltTextRow,
} from './admin-room-type-media.repository';
import type {
  AdminRoomTypeImage,
  AttemptedStorageCleanup,
  RoomTypeImageAltTextResult,
  RoomTypeImageCoverResult,
  RoomTypeImageDeleteResult,
  RoomTypeImageListResult,
  RoomTypeImageMoveServiceResult,
  RoomTypeImageUploadResult,
  RoomTypeMediaDependencies,
  StorageCleanup,
} from './admin-room-type-media.types';
import {
  MediaPersistenceOutcomeUncertainError,
  MediaUploadCleanupError,
} from './admin-room-type-media.types';

/**
 * The room-type media use cases: what happens, in what order, and what is true
 * afterwards.
 *
 * Everything this layer does is orchestration. The rules themselves live where
 * they were written — the source-upload rules and the twelve-image ceiling in
 * the pure media module, the decoding and normalization rules in the
 * processing module, the SQL and the locks in the repositories — and none of
 * them is restated here. What is here is the sequencing those rules cannot
 * express on their own.
 *
 * ---------------------------------------------------------------------------
 * TWO SYSTEMS, ONE DIRECTION OF FAILURE
 *
 * Object storage and PostgreSQL do not commit together, and no amount of care
 * makes them. So the project picks which way the seam is allowed to tear:
 *
 *     storage may hold an object the database has never heard of;
 *     the database must never hold a row pointing at an object that is gone.
 *
 * An orphan object is invisible, costs a fraction of a cent, and can be swept
 * later. A row with no object is a broken image on a guest-facing page, and
 * nothing can repair it. Every ordering decision below follows from that one
 * sentence:
 *
 *     uploading:  storage first, then the database
 *     deleting:   the database first, then storage
 *
 * ---------------------------------------------------------------------------
 * CANONICAL MUTATION SEQUENCE
 *
 *     connect -> BEGIN -> lock room_types FOR UPDATE -> scoped image lock
 *             -> media_assets -> COMMIT
 *
 * The room type is the serialization point. An image is never locked before
 * its parent, and no mutation reaches a media row without holding the parent
 * first. Reads take no lock at all.
 *
 * The R2 PUT happens strictly outside the transaction. Holding a row lock
 * across a network call to another provider would make every other
 * administrator's edit wait on Cloudflare.
 * ---------------------------------------------------------------------------
 *
 * Storage is injected, and only into the two operations that use it. The other
 * four have no way to reach it — not by discipline, but because it is not a
 * parameter they take. Nothing here reads an R2 environment variable,
 * constructs the real adapter, imports an AWS type, or composes a public URL.
 */

/**
 * What the upload transaction decided: a created image, or a refusal that the
 * caller still has to compensate for.
 */
type UploadTransactionOutcome =
  | { image: AdminRoomTypeImage }
  | { refused: 'room-type-not-found' | 'image-limit-reached' };

/** Rolls back, or commits, and always says which was meant. */
type TransactionOutcome<T> = { commit: boolean; value: T };

const commit = <T>(value: T): TransactionOutcome<T> => ({ commit: true, value });
const rollback = <T>(value: T): TransactionOutcome<T> => ({ commit: false, value });

/**
 * `COMMIT` was sent and did not answer.
 *
 * Module-local and deliberately not exported: it exists so that the one
 * condition a caller must never confuse with a pre-commit failure is a
 * *different type*, rather than a flag on a shared one. Compensation code
 * cannot mistake it for an ordinary database error, because it is not one.
 *
 * Nothing is inferred from it. No `ROLLBACK` is attempted afterwards — a
 * rollback of a transaction that already committed succeeds quietly, so the
 * answer it gives is not evidence — and the commit is never retried.
 */
class CommitOutcomeUncertainError extends Error {
  constructor(cause: unknown) {
    super('PostgreSQL COMMIT did not report its outcome', { cause });
    this.name = 'CommitOutcomeUncertainError';
  }
}

const isCommitOutcomeUncertain = (error: unknown): error is CommitOutcomeUncertainError =>
  error instanceof CommitOutcomeUncertainError;

/**
 * How a transaction gets its client.
 *
 * A seam, not a framework. It exists so a test can hand the helper a client
 * whose `COMMIT` throws — which is the one failure that cannot be provoked
 * against a real, healthy PostgreSQL connection, and the one whose handling
 * matters most. Production never replaces it.
 */
type ClientFactory = () => Promise<PoolClient>;

const defaultClientFactory: ClientFactory = () => dbPool.connect();

let acquireClient: ClientFactory = defaultClientFactory;

/** Test seam. Passing `null` restores the pool. */
export function __setClientFactoryForTests(factory: ClientFactory | null): void {
  acquireClient = factory ?? defaultClientFactory;
}

/**
 * Runs one unit of work on its own client, inside one transaction.
 *
 * Small on purpose. It owns five things and nothing else:
 *
 *   - the client is always released
 *   - a failure *before* COMMIT is attempted always rolls back
 *   - a caller that decided not to commit gets a real ROLLBACK, not an empty
 *     COMMIT
 *   - a committed transaction is never rolled back afterwards
 *   - a COMMIT that throws is reported as its own type, never as a database
 *     failure
 *
 * That last one is the whole point of this rewrite. A thrown COMMIT does not
 * mean the transaction failed; it means nobody knows. The connection is
 * destroyed rather than returned to the pool, because a session whose
 * transaction state is unknown is not a session to hand to the next caller.
 *
 * A failure during the rollback itself is deliberately not allowed to replace
 * the error that caused it — the original is what explains what went wrong.
 */
async function withTransaction<T>(
  run: (client: PoolClient) => Promise<TransactionOutcome<T>>,
): Promise<T> {
  const client = await acquireClient();
  let open = false;
  let discard = false;

  try {
    await client.query('BEGIN');
    open = true;

    const outcome = await run(client);

    if (!outcome.commit) {
      await client.query('ROLLBACK');
      open = false;

      return outcome.value;
    }

    try {
      await client.query('COMMIT');
    } catch (error) {
      // From here the transaction's fate is unknown, so nothing may be
      // inferred and nothing may be undone. `open` is cleared first so the
      // handler below does not attempt the ROLLBACK that would prove nothing.
      open = false;
      discard = true;

      throw new CommitOutcomeUncertainError(error);
    }

    open = false;

    return outcome.value;
  } catch (error) {
    if (open) {
      open = false;

      try {
        await client.query('ROLLBACK');
      } catch {
        // Swallowed on purpose: the connection is being discarded anyway, and
        // the original failure is the one worth reporting.
      }
    }

    throw error;
  } finally {
    // `release(true)` destroys the connection instead of returning it. Used
    // only for a session left in an unknown transaction state; PostgreSQL
    // discards any still-open transaction when the connection drops.
    client.release(discard || undefined);
  }
}

/**
 * Removes an object that the database never took ownership of.
 *
 * Exactly one attempt, never a retry. If it fails the object becomes an
 * orphan, which is the failure this system chose to be able to live with, and
 * the key is carried back so an operator could find it later. The key is a
 * random UUID under a fixed prefix and identifies nothing about the hotel; the
 * endpoint, the bucket and the credential are never part of this.
 */
async function compensate(storage: MediaStorage, storageKey: string): Promise<AttemptedStorageCleanup> {
  try {
    await storage.deleteObject(storageKey);

    return { attempted: true, removed: true };
  } catch {
    return { attempted: true, removed: false, storageKey };
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Accepts one uploaded image for a room type.
 *
 * The order is the contract, and it is this:
 *
 *    1. check the source against the upload rules      (no I/O)
 *    2. decode and normalize it                        (no I/O)
 *    3. read whether the room type exists              (unlocked)
 *    4. mint a reference and a storage key
 *    5. PUT the normalized bytes                       (no transaction open)
 *    6. BEGIN
 *    7. lock room_types FOR UPDATE
 *    8. re-confirm the room type
 *    9. count its images
 *   10. refuse at twelve
 *   11. compute the next sort order
 *   12. insert media_assets
 *   13. insert room_type_images
 *   14. COMMIT
 *
 * Steps 1 and 2 come first because they are free and they reject most bad
 * uploads without anyone's network or database being involved. Step 3 is a
 * courtesy, not a guarantee: it avoids knowingly uploading bytes for a room
 * type that does not exist, and it is explicitly *not* the concurrency
 * boundary — step 7 is, and step 8 re-asks the same question under the lock
 * because the answer between them is not this function's to assume.
 *
 * Step 5 is outside the transaction in both directions. Before it, there is
 * nothing to roll back. After it, everything that can still go wrong is
 * compensated.
 */
export async function uploadRoomTypeImage(
  dependencies: RoomTypeMediaDependencies,
  input: { slug: string; declaredContentType: unknown; body: Buffer },
): Promise<RoomTypeImageUploadResult> {
  const { storage } = dependencies;

  // 1. The source rules, as the media module wrote them: the accepted types,
  //    the 8 MiB ceiling, the signature, and the declared-versus-sniffed
  //    check. None of it is restated here.
  const source = checkSourceUpload(input.declaredContentType, input.body);

  if (!source.ok) {
    return { outcome: 'invalid-upload', reason: source.reason };
  }

  // 2. The decoder is the authority on whether this is really an image: one
  //    frame, decodable, within the pixel ceiling, and the format it claimed.
  const normalization = await normalizeImage(input.body, source.sourceContentType);

  if (!normalization.ok) {
    return { outcome: 'invalid-image', reason: normalization.reason };
  }

  const normalized = normalization.normalized;

  // 3. Provisional. Worth asking, because uploading several megabytes for a
  //    slug that does not exist helps nobody, and worth nothing as a promise.
  const preflight = await withTransaction(async (client) =>
    rollback(await findRoomTypeForMedia(client, input.slug)),
  );

  if (!preflight) {
    // Nothing has been written anywhere yet, so there is nothing to undo.
    return { outcome: 'room-type-not-found', cleanup: { attempted: false } };
  }

  // 4. The identity is the application's, never SQL's, and nothing about the
  //    upload enters it — no filename, no slug, no room id, no timestamp.
  const reference = createMediaReference();
  const storageKey = mediaStorageKey(reference);

  // 5. Storage first. If this fails, nothing has been written anywhere and
  //    there is nothing to undo.
  try {
    await storage.putObject({
      key: storageKey,
      body: normalized.body,
      contentType: normalized.contentType,
    });
  } catch {
    return { outcome: 'media-storage-unavailable' };
  }

  // From here the object exists. Every exit below either commits a row that
  // owns it, or removes it again.
  let committed: UploadTransactionOutcome;

  try {
    committed = await withTransaction(async (client) => {
      // 7. The serialization point. Two uploads that reach here at the same
      //    time queue on this row, which is what makes the count in step 9
      //    mean something.
      const roomType = await lockRoomTypeForMediaChange(client, input.slug);

      if (!roomType) {
        return rollback<UploadTransactionOutcome>({ refused: 'room-type-not-found' });
      }

      // 9 & 10. Counted under the lock, and judged by the same helper the
      //    rest of the system uses. The service does not know what twelve is.
      const currentCount = await countRoomTypeImages(client, roomType.roomTypeId);
      const capacity = checkRoomTypeImageCount(currentCount);

      if (!capacity.ok) {
        return rollback<UploadTransactionOutcome>({ refused: 'image-limit-reached' });
      }

      const sortOrder = await nextRoomTypeImageSortOrder(client, roomType.roomTypeId);

      // The first image of a room type is its cover, and every later one is
      // not. This is the service's decision: the repository writes what it is
      // handed, and a room type with images must have exactly one cover.
      const isCover = currentCount === 0;

      const asset = await insertMediaAsset(client, {
        reference,
        storageKey,
        contentType: normalized.contentType,
        byteSize: normalized.byteSize,
        checksumSha256: normalized.checksumSha256,
        width: normalized.width,
        height: normalized.height,
      });

      await insertRoomTypeImage(client, {
        roomTypeId: roomType.roomTypeId,
        mediaAssetId: asset.mediaAssetId,
        altText: null,
        sortOrder,
        isCover,
      });

      const images = await listRoomTypeImageRows(client, roomType.roomTypeId);
      const created = images.find((image) => image.reference === reference);

      if (!created) {
        // Unreachable: the row was just inserted inside this transaction.
        throw new Error('Room-type image vanished immediately after being inserted');
      }

      return commit<UploadTransactionOutcome>({ image: created });
    });
  } catch (error) {
    if (isCommitOutcomeUncertain(error)) {
      // COMMIT was sent and did not answer. The row may exist, and if it does
      // it owns this object — so the object stays. Deleting it here would, in
      // that reality, leave a committed row pointing at nothing, which is the
      // one failure this architecture refuses. An orphan is the safe side of
      // an unanswered commit, and the reference and key are carried out so it
      // can be reconciled later.
      throw new MediaPersistenceOutcomeUncertainError('upload', { reference, storageKey }, error.cause);
    }

    // Anything else is a failure *before* COMMIT was attempted: a constraint
    // nobody predicted, a lost connection mid-INSERT, a refused lock. The
    // transaction is already rolled back and no row exists, so the object it
    // would have belonged to goes now.
    const cleanup = await compensate(storage, storageKey);

    if (!cleanup.removed) {
      // The original failure and an orphan both matter, and only one of them
      // can be thrown. The orphan is the one that will otherwise be forgotten,
      // so it is named, and the original is carried as the cause.
      throw new MediaUploadCleanupError(storageKey, error);
    }

    throw error;
  }

  if ('image' in committed) {
    return { outcome: 'uploaded', image: committed.image };
  }

  // A refusal the transaction reached on purpose — the room type went away
  // between the pre-flight read and the lock, or the gallery is already full.
  // Nothing was written, so the object it would have owned is removed again.
  const cleanup = await compensate(storage, storageKey);

  return committed.refused === 'image-limit-reached'
    ? { outcome: 'image-limit-reached', cleanup }
    : { outcome: 'room-type-not-found', cleanup };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Every image of one room type, in the order a gallery shows them.
 *
 * No lock: a list is a snapshot by definition, and blocking an administrator's
 * read behind another's edit would buy nothing. No storage call, and no public
 * URL — whether the admin interface needs one, and what it looks like, is a
 * decision for the boundary above this, and composing one here would tie this
 * service to a particular provider's hostname.
 */
export async function listRoomTypeImages(slug: string): Promise<RoomTypeImageListResult> {
  return withTransaction(async (client) => {
    const roomType = await findRoomTypeForMedia(client, slug);

    if (!roomType) {
      return rollback<RoomTypeImageListResult>({ outcome: 'room-type-not-found' });
    }

    const images: AdminRoomTypeImage[] = await listRoomTypeImageRows(client, roomType.roomTypeId);

    return rollback<RoomTypeImageListResult>({ outcome: 'listed', images });
  });
}

// ---------------------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------------------

/**
 * Replaces one image's alt text.
 *
 * Both inputs are parsed before anything is locked: a malformed reference and
 * an over-long description are answers this function can give without a
 * transaction, and giving them early means a bad request never takes a lock
 * another administrator is waiting for.
 *
 * A reference belonging to a different room type produces exactly the same
 * `image-not-found` as one that never existed, because the scoped lookup
 * cannot tell them apart and must not be able to — otherwise a caller could
 * discover which references exist under room types that are not theirs.
 *
 * No storage call is possible: this function has no storage to call.
 */
export async function updateRoomTypeImageAltText(input: {
  slug: string;
  imageReference: unknown;
  altText: unknown;
}): Promise<RoomTypeImageAltTextResult> {
  const reference = parseMediaReference(input.imageReference);

  if (reference === null) {
    return { outcome: 'invalid-image-reference' };
  }

  const altText = normalizeAltText(input.altText);

  if (!altText.ok) {
    return { outcome: 'invalid-alt-text', reason: altText.reason };
  }

  return withTransaction(async (client) => {
    const roomType = await lockRoomTypeForMediaChange(client, input.slug);

    if (!roomType) {
      return rollback<RoomTypeImageAltTextResult>({ outcome: 'room-type-not-found' });
    }

    const image = await lockScopedRoomTypeImage(client, roomType.roomTypeId, reference);

    if (!image) {
      return rollback<RoomTypeImageAltTextResult>({ outcome: 'image-not-found' });
    }

    const changed = await updateRoomTypeImageAltTextRow(
      client,
      roomType.roomTypeId,
      image.imageId,
      altText.value,
    );

    if (!changed) {
      // Unreachable: the row is held by this transaction's own lock.
      throw new Error('Room-type image vanished while its alt text was being changed');
    }

    return commit<RoomTypeImageAltTextResult>({ outcome: 'updated' });
  });
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

/**
 * Makes one image the room type's cover.
 *
 * The scoped lookup is not an optimisation and not a courtesy — it is the
 * precondition the repository helper depends on. `setRoomTypeImageAsCover`
 * clears every cover *except* the id it is given, so calling it with an id
 * that does not belong to this room type would clear the real cover and
 * promote nothing. Ownership is therefore proven under the parent lock, on the
 * line before, every time.
 *
 * Selecting the image that is already the cover succeeds and changes nothing,
 * including `updated_at`. An administrator asking for something already true
 * has not made a mistake.
 *
 * No storage call is possible: this function has no storage to call.
 */
export async function setRoomTypeImageCover(input: {
  slug: string;
  imageReference: unknown;
}): Promise<RoomTypeImageCoverResult> {
  const reference = parseMediaReference(input.imageReference);

  if (reference === null) {
    return { outcome: 'invalid-image-reference' };
  }

  return withTransaction(async (client) => {
    const roomType = await lockRoomTypeForMediaChange(client, input.slug);

    if (!roomType) {
      return rollback<RoomTypeImageCoverResult>({ outcome: 'room-type-not-found' });
    }

    // MANDATORY, and in this order: parent locked, then ownership proven, then
    // the cover changed. Never the other way round.
    const image = await lockScopedRoomTypeImage(client, roomType.roomTypeId, reference);

    if (!image) {
      // Nothing has been written, so the existing cover is exactly as it was.
      return rollback<RoomTypeImageCoverResult>({ outcome: 'image-not-found' });
    }

    await setRoomTypeImageAsCover(client, roomType.roomTypeId, image.imageId);

    return commit<RoomTypeImageCoverResult>({ outcome: 'updated' });
  });
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/**
 * Moves one image one place through its gallery.
 *
 * `boundary` is passed through rather than flattened into success or failure.
 * The first image cannot move up, and that is neither an error nor a change —
 * the caller above may want to say so, and it cannot if this layer has already
 * decided for it.
 *
 * Which image is the cover is not read or written anywhere in this path.
 * Ordering and the cover are independent, and moving an image must not quietly
 * promote or demote it.
 *
 * No storage call is possible: this function has no storage to call.
 */
export async function moveRoomTypeImage(input: {
  slug: string;
  imageReference: unknown;
  direction: unknown;
}): Promise<RoomTypeImageMoveServiceResult> {
  const reference = parseMediaReference(input.imageReference);

  if (reference === null) {
    return { outcome: 'invalid-image-reference' };
  }

  const direction = parseMediaOrderDirection(input.direction);

  if (direction === null) {
    return { outcome: 'invalid-order-direction' };
  }

  return withTransaction(async (client) => {
    const roomType = await lockRoomTypeForMediaChange(client, input.slug);

    if (!roomType) {
      return rollback<RoomTypeImageMoveServiceResult>({ outcome: 'room-type-not-found' });
    }

    const moved = await moveRoomTypeImageRows(client, roomType.roomTypeId, reference, direction);

    if (moved.outcome === 'not-found') {
      return rollback<RoomTypeImageMoveServiceResult>({ outcome: 'image-not-found' });
    }

    if (moved.outcome === 'boundary') {
      return rollback<RoomTypeImageMoveServiceResult>({ outcome: 'boundary' });
    }

    return commit<RoomTypeImageMoveServiceResult>({ outcome: 'moved' });
  });
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Removes one image from a room type.
 *
 * The opposite order from an upload, for the same reason an upload has its
 * order: the database owns what is visible, so it goes first and storage
 * follows.
 *
 *    1. BEGIN
 *    2. lock room_types FOR UPDATE
 *    3. lock the scoped image
 *    4. remember what it was: the asset, the reference, the key, the cover
 *    5. delete the relation
 *    6. if it was the cover and images remain, promote the first that is left
 *    7. delete the asset row
 *    8. compact what is left to 0..N-1
 *    9. COMMIT
 *   10. and only then remove the object
 *
 * If anything before step 9 fails, the transaction rolls back and **no storage
 * call is made at all** — the row still exists, and the object it points at
 * must still be there.
 *
 * If step 10 fails, the deletion has still happened. The row is gone, the
 * image is gone from every page that showed it, and what is left in storage is
 * an orphan. Recreating the row to match the object would be the one outcome
 * this architecture refuses: a visible image nobody asked to keep.
 */
export async function deleteRoomTypeImage(
  dependencies: RoomTypeMediaDependencies,
  input: { slug: string; imageReference: unknown },
): Promise<RoomTypeImageDeleteResult> {
  const reference = parseMediaReference(input.imageReference);

  if (reference === null) {
    return { outcome: 'invalid-image-reference' };
  }

  // Captured inside the transaction so that, if COMMIT never answers, the
  // identity of what was being removed is still available to report. Held in
  // an object because a `let` assigned only inside the callback reads as never
  // having changed by the time the catch below runs.
  const pending: { identity: { reference: string; storageKey: string } | null } = { identity: null };

  let removed: { storageKey: string; reference: string } | RoomTypeImageDeleteResult;

  try {
    removed = await withTransaction(async (client) => {
    const roomType = await lockRoomTypeForMediaChange(client, input.slug);

    if (!roomType) {
      return rollback<{ storageKey: string; reference: string } | RoomTypeImageDeleteResult>({
        outcome: 'room-type-not-found',
      });
    }

    const image = await lockScopedRoomTypeImage(client, roomType.roomTypeId, reference);

    if (!image) {
      return rollback<{ storageKey: string; reference: string } | RoomTypeImageDeleteResult>({
        outcome: 'image-not-found',
      });
    }

    const relationRemoved = await deleteRoomTypeImageRelation(client, roomType.roomTypeId, image.imageId);

    if (!relationRemoved) {
      // Unreachable: the row is held by this transaction's own lock.
      throw new Error('Room-type image vanished while it was being deleted');
    }

    if (image.isCover) {
      // Zero images means zero covers, and that is correct. One or more means
      // exactly one, and the replacement is the image a reader would already
      // have seen first.
      const replacement = await findFirstRoomTypeImageId(client, roomType.roomTypeId);

      if (replacement) {
        await setRoomTypeImageAsCover(client, roomType.roomTypeId, replacement);
      }
    }

    await deleteMediaAssetById(client, image.mediaAssetId);
    await compactRoomTypeImageOrder(client, roomType.roomTypeId);

    pending.identity = { storageKey: image.storageKey, reference: image.reference };

    return commit<{ storageKey: string; reference: string } | RoomTypeImageDeleteResult>({
      storageKey: image.storageKey,
      reference: image.reference,
    });
    });
  } catch (error) {
    if (isCommitOutcomeUncertain(error)) {
      // The rows may or may not be gone. Removing the object now would, in the
      // reality where the transaction did not commit, leave a surviving row
      // pointing at nothing. So the object stays, and this is reported as what
      // it is — not as a successful deletion, and not as a failed one.
      throw new MediaPersistenceOutcomeUncertainError(
        'delete',
        { reference: pending.identity?.reference ?? null, storageKey: pending.identity?.storageKey ?? null },
        error.cause,
      );
    }

    throw error;
  }

  if ('outcome' in removed) {
    // Nothing was committed, so nothing is removed from storage.
    return removed;
  }

  // Committed. The object may now go, and its fate no longer affects whether
  // this deletion happened.
  return {
    outcome: 'deleted',
    reference: removed.reference,
    cleanup: await compensate(dependencies.storage, removed.storageKey),
  };
}
