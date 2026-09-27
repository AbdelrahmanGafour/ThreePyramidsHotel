import type { PoolClient } from 'pg';
import { dbPool } from '../../db/pool';
import { deleteMediaAssetById, insertMediaAsset } from '../media/media.repository';
import { normalizeImage } from '../media/media.processing';
import {
  checkSourceUpload,
  createMediaReference,
  mediaStorageKey,
  normalizeAltText,
} from '../media/media.validation';
import type {
  ImageNormalization,
  MediaStorage,
  SourceUploadRejection,
} from '../media/media.types';
import {
  MediaPersistenceOutcomeUncertainError,
  MediaUploadCleanupError,
  type AttemptedStorageCleanup,
} from '../media/media.outcomes';
import {
  deletePackageMedia,
  findAdminPackageImage,
  findPackageImageForUpdate,
  insertPackageMedia,
  lockPackageForMediaChange,
  repointPackageMedia,
  updatePackageMediaAltText,
} from './admin-package-media.repository';
import type {
  AdminPackageImage,
  PackageImageAltTextResult,
  PackageImageDeleteResult,
  PackageImageReplaceResult,
  PackageImageUploadResult,
  PackageMediaDependencies,
} from './admin-package-media.types';

/**
 * A journey's one image: what happens, in what order, and what is true
 * afterwards.
 *
 * Everything this layer does is orchestration. The rules themselves live
 * where they were written — the source-upload rules in the pure media
 * module, the decoding and normalization rules in the processing module, the
 * one-image-per-journey rule in `package_media_package_id_key`, the SQL and
 * the lock in the repositories — and none of them is restated here.
 *
 * ---------------------------------------------------------------------------
 * TWO SYSTEMS, ONE DIRECTION OF FAILURE
 *
 * The same doctrine the room-type media service follows, because it is one
 * rule for the whole system rather than one per owner:
 *
 *     storage may hold an object the database has never heard of;
 *     the database must never hold a row pointing at an object that is gone.
 *
 * An orphan object is invisible, costs a fraction of a cent, and can be swept
 * later. A row with no object is a broken image on a guest-facing page, and
 * nothing can repair it. Every ordering decision below follows from it:
 *
 *     uploading:  storage first, then the database
 *     replacing:  the NEW object first, the OLD one only after the commit
 *     deleting:   the database first, then storage
 *
 * ---------------------------------------------------------------------------
 * CANONICAL MUTATION SEQUENCE
 *
 *     connect -> BEGIN -> lock packages FOR UPDATE -> read package_media
 *             -> write -> COMMIT
 *
 * The journey row is the serialization point, and it is the first statement
 * of every one of these. It is the same lock every other admin journey write
 * already takes first — including the hard delete — so a media change and a
 * journey deletion queue on each other with no new mechanism.
 *
 * The R2 PUT happens strictly outside the transaction. Holding a row lock
 * across a network call to another provider would make every other
 * administrator's edit wait on Cloudflare.
 * ---------------------------------------------------------------------------
 *
 * Storage is injected, into all three operations, because all three touch it.
 * Nothing here reads an R2 environment variable, constructs the real adapter,
 * imports an AWS type, or composes a public URL.
 */

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
 * whose `COMMIT` throws — the one failure that cannot be provoked against a
 * real, healthy PostgreSQL connection, and the one whose handling matters
 * most. Production never replaces it.
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
 * It owns five things and nothing else:
 *
 *   - the client is always released
 *   - a failure *before* COMMIT is attempted always rolls back
 *   - a caller that decided not to commit gets a real ROLLBACK
 *   - a committed transaction is never rolled back afterwards
 *   - a COMMIT that throws is reported as its own type, never as a database
 *     failure
 *
 * A thrown COMMIT does not mean the transaction failed; it means nobody
 * knows. The connection is destroyed rather than returned to the pool,
 * because a session whose transaction state is unknown is not a session to
 * hand to the next caller.
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
 * random UUID under a fixed prefix and identifies nothing about the hotel;
 * the endpoint, the bucket and the credential are never part of this.
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
// Everything that happens before a transaction is opened
// ---------------------------------------------------------------------------

/** A refusal that can be decided without a database, in the domain's terms. */
type PreparationRefusal =
  | { outcome: 'invalid-upload'; reason: SourceUploadRejection }
  | { outcome: 'invalid-image' }
  | { outcome: 'media-storage-unavailable' };

/** A new object, written and waiting for a row to own it. */
type PreparedObject = {
  reference: string;
  storageKey: string;
  normalized: ImageNormalization;
};

type Preparation = { ok: true; object: PreparedObject } | { ok: false; refusal: PreparationRefusal };

/**
 * Validate, normalize, mint an identity, and write the object.
 *
 * Shared by upload and replace because it is identical for both: they differ
 * only in what they then do with the row, never in how the new bytes reach
 * storage. Every refusal here happens before a transaction exists, so there
 * is never anything to roll back and — except where the PUT itself failed —
 * never anything to compensate.
 */
async function prepareAndStore(
  storage: MediaStorage,
  input: { declaredContentType: unknown; body: Buffer },
): Promise<Preparation> {
  // 1. The source rules, as the media module wrote them: the accepted types,
  //    the 8 MiB ceiling, the signature, and the declared-versus-sniffed
  //    check. None of it is restated here.
  const source = checkSourceUpload(input.declaredContentType, input.body);

  if (!source.ok) {
    return { ok: false, refusal: { outcome: 'invalid-upload', reason: source.reason } };
  }

  // 2. The decoder is the authority on whether this is really an image: one
  //    frame, decodable, within the pixel ceiling, and the format it claimed.
  const normalization = await normalizeImage(input.body, source.sourceContentType);

  if (!normalization.ok) {
    return { ok: false, refusal: { outcome: 'invalid-image' } };
  }

  const normalized = normalization.normalized;

  // 3. The identity is the application's, never SQL's, and nothing about the
  //    upload enters it — no filename, no slug, no journey id, no timestamp.
  //    The key format is the shared one, unchanged: media/<uuid>.webp.
  const reference = createMediaReference();
  const storageKey = mediaStorageKey(reference);

  // 4. Storage first, with no transaction open. If this fails, nothing has
  //    been written anywhere and there is nothing to undo — in particular,
  //    on a replacement, the journey's existing image is untouched.
  try {
    await storage.putObject({
      key: storageKey,
      body: normalized.body,
      contentType: normalized.contentType,
    });
  } catch {
    return { ok: false, refusal: { outcome: 'media-storage-unavailable' } };
  }

  return { ok: true, object: { reference, storageKey, normalized } };
}

/** Writes one `media_assets` row for a prepared object. */
async function recordAsset(client: PoolClient, object: PreparedObject): Promise<string> {
  const asset = await insertMediaAsset(client, {
    reference: object.reference,
    storageKey: object.storageKey,
    contentType: object.normalized.contentType,
    byteSize: object.normalized.byteSize,
    checksumSha256: object.normalized.checksumSha256,
    width: object.normalized.width,
    height: object.normalized.height,
  });

  return asset.mediaAssetId;
}

// ---------------------------------------------------------------------------
// Upload — the journey's first image
// ---------------------------------------------------------------------------

/** What the upload transaction decided. */
type UploadTransactionOutcome =
  | { image: AdminPackageImage }
  | { refused: 'package-not-found' | 'image-exists' };

/**
 * Adds the one image a journey does not yet have.
 *
 * The order is the contract, and it is this:
 *
 *    1. check the source against the upload rules      (no I/O)
 *    2. decode and normalize it                        (no I/O)
 *    3. mint a reference and a storage key
 *    4. PUT the normalized bytes                       (no transaction open)
 *    5. BEGIN
 *    6. lock packages FOR UPDATE
 *    7. refuse if the journey is gone
 *    8. read package_media under that lock
 *    9. refuse if an image is already there
 *   10. insert media_assets
 *   11. insert package_media, alt_text NULL
 *   12. COMMIT
 *
 * There is deliberately no unlocked pre-flight read. The room-type upload has
 * one because a gallery upload is the common case and several megabytes for a
 * slug that does not exist helps nobody; here the same question is asked
 * under the lock one statement later, and a second unlocked read would be a
 * round trip that proves nothing.
 *
 * Step 9 is a real check rather than a reliance on `UNIQUE (package_id)`.
 * Both are true — the constraint is what makes the rule hold if this code is
 * ever wrong — but a checked refusal is a clean 409, and a constraint
 * violation would be a 500.
 *
 * `seed_managed` is not read and not written. A journey's image says nothing
 * about whether the brochure catalogue owns its text.
 */
export async function uploadPackageImage(
  dependencies: PackageMediaDependencies,
  input: { slug: string; declaredContentType: unknown; body: Buffer },
): Promise<PackageImageUploadResult> {
  const { storage } = dependencies;

  const prepared = await prepareAndStore(storage, input);

  if (!prepared.ok) {
    return prepared.refusal;
  }

  const { reference, storageKey } = prepared.object;

  // From here the object exists. Every exit below either commits a row that
  // owns it, or removes it again.
  let committed: UploadTransactionOutcome;

  try {
    committed = await withTransaction(async (client) => {
      const locked = await lockPackageForMediaChange(client, input.slug);

      if (!locked) {
        return rollback<UploadTransactionOutcome>({ refused: 'package-not-found' });
      }

      const existing = await findPackageImageForUpdate(client, locked.packageId);

      if (existing) {
        return rollback<UploadTransactionOutcome>({ refused: 'image-exists' });
      }

      const mediaAssetId = await recordAsset(client, prepared.object);

      await insertPackageMedia(client, { packageId: locked.packageId, mediaAssetId });

      const image = await findAdminPackageImage(client, locked.packageId);

      if (!image) {
        // Unreachable: the row was just inserted inside this transaction.
        throw new Error('Journey image vanished immediately after being inserted');
      }

      return commit<UploadTransactionOutcome>({ image });
    });
  } catch (error) {
    if (isCommitOutcomeUncertain(error)) {
      // COMMIT was sent and did not answer. The row may exist, and if it does
      // it owns this object — so the object stays. Deleting it here would, in
      // that reality, leave a committed row pointing at nothing, which is the
      // one failure this architecture refuses.
      throw new MediaPersistenceOutcomeUncertainError('upload', { reference, storageKey }, error.cause);
    }

    // Anything else is a failure *before* COMMIT was attempted. The
    // transaction is already rolled back and no row exists, so the object it
    // would have belonged to goes now.
    const cleanup = await compensate(storage, storageKey);

    if (!cleanup.removed) {
      // The original failure and an orphan both matter, and only one of them
      // can be thrown. The orphan is the one that would otherwise be
      // forgotten, so it is named, and the original travels as the cause.
      throw new MediaUploadCleanupError(storageKey, error);
    }

    throw error;
  }

  if ('image' in committed) {
    return { outcome: 'uploaded', image: committed.image };
  }

  // A refusal the transaction reached on purpose. Nothing was written, so the
  // object it would have owned is removed again.
  const cleanup = await compensate(storage, storageKey);

  return committed.refused === 'image-exists'
    ? { outcome: 'image-exists', cleanup }
    : { outcome: 'package-not-found', cleanup };
}

// ---------------------------------------------------------------------------
// Replace — swapping the image a journey already has
// ---------------------------------------------------------------------------

/** What the replacement transaction decided, plus the object it displaced. */
type ReplaceTransactionOutcome =
  | { image: AdminPackageImage; displacedStorageKey: string }
  | { refused: 'package-not-found' | 'image-not-found' };

/**
 * Swaps a journey's image for a new one, atomically.
 *
 * The critical property is that there is never an instant at which the
 * journey has no usable image. The new object is written before the
 * transaction opens; the old object is removed only after the transaction
 * has committed; and in between, one UPDATE moves the relation from one to
 * the other:
 *
 *    1. validate and normalize the NEW image           (no I/O)
 *    2. PUT the NEW object                             (no transaction open)
 *    3. BEGIN
 *    4. lock packages FOR UPDATE
 *    5. refuse if the journey is gone
 *    6. read the existing relation: old asset id, old key, existing alt text
 *    7. refuse if there is no existing image
 *    8. INSERT the NEW media_assets row          <- before the UPDATE
 *    9. UPDATE package_media to point at it      <- alt_text untouched
 *   10. DELETE the OLD media_assets row          <- now unreferenced
 *   11. COMMIT
 *   12. remove the OLD object, best effort, exactly once
 *
 * Steps 8, 9 and 10 are in that order because the constraints are checked
 * immediately, not deferred. The relation's foreign key needs the new asset
 * to exist before it can point at it, and the old asset cannot be deleted
 * until nothing points at it — `package_media_media_asset_id_fkey` is
 * RESTRICT, so PostgreSQL refuses any other order rather than allowing a
 * dangling pointer.
 *
 * Refusing when there is no image is deliberate: replacing something a
 * journey does not have is a different request from adding it, and quietly
 * turning one into the other would let a stale page create an image its
 * administrator believed was already there.
 *
 * `seed_managed` is not read and not written.
 */
export async function replacePackageImage(
  dependencies: PackageMediaDependencies,
  input: { slug: string; declaredContentType: unknown; body: Buffer },
): Promise<PackageImageReplaceResult> {
  const { storage } = dependencies;

  const prepared = await prepareAndStore(storage, input);

  if (!prepared.ok) {
    return prepared.refusal;
  }

  const { reference, storageKey } = prepared.object;

  // Captured inside the transaction so that, if COMMIT never answers, the
  // key of the object that may or may not have been displaced is still
  // available to report alongside the new one.
  const pending: { displaced: string | null } = { displaced: null };

  let committed: ReplaceTransactionOutcome;

  try {
    committed = await withTransaction(async (client) => {
      const locked = await lockPackageForMediaChange(client, input.slug);

      if (!locked) {
        return rollback<ReplaceTransactionOutcome>({ refused: 'package-not-found' });
      }

      const existing = await findPackageImageForUpdate(client, locked.packageId);

      if (!existing) {
        return rollback<ReplaceTransactionOutcome>({ refused: 'image-not-found' });
      }

      // 8. The new asset first: the relation's foreign key is checked the
      //    moment the UPDATE below runs, so the row it will point at has to
      //    be there already.
      const mediaAssetId = await recordAsset(client, prepared.object);

      // 9. One UPDATE. `alt_text` is deliberately not in the SET list, so a
      //    description an administrator wrote survives the new picture.
      const repointed = await repointPackageMedia(client, {
        packageId: locked.packageId,
        mediaAssetId,
      });

      if (!repointed) {
        // Unreachable: the row is held by this transaction's own lock.
        throw new Error('Journey image vanished while it was being replaced');
      }

      // 10. Now that nothing references it, the old asset row can go.
      await deleteMediaAssetById(client, existing.mediaAssetId);

      const image = await findAdminPackageImage(client, locked.packageId);

      if (!image) {
        throw new Error('Journey image vanished immediately after being replaced');
      }

      pending.displaced = existing.storageKey;

      return commit<ReplaceTransactionOutcome>({ image, displacedStorageKey: existing.storageKey });
    });
  } catch (error) {
    if (isCommitOutcomeUncertain(error)) {
      // Neither object may be removed. In the reality where the transaction
      // committed, the NEW object is live and deleting it would break the
      // page; in the reality where it did not, the OLD object is still the
      // journey's image and deleting that would break it just as badly. Both
      // keys are carried out so the pair can be reconciled.
      throw new MediaPersistenceOutcomeUncertainError(
        'replace',
        { reference, storageKey },
        error.cause,
      );
    }

    // A failure before COMMIT. The old relation and the old asset are exactly
    // as they were, the old object was never touched, and the new object is
    // the only thing to undo.
    const cleanup = await compensate(storage, storageKey);

    if (!cleanup.removed) {
      throw new MediaUploadCleanupError(storageKey, error);
    }

    throw error;
  }

  if ('image' in committed) {
    // Committed. The displaced object may now go, and its fate no longer
    // affects whether this replacement happened.
    await compensate(storage, committed.displacedStorageKey);

    return { outcome: 'replaced', image: committed.image };
  }

  const cleanup = await compensate(storage, storageKey);

  return committed.refused === 'image-not-found'
    ? { outcome: 'image-not-found', cleanup }
    : { outcome: 'package-not-found', cleanup };
}

// ---------------------------------------------------------------------------
// Delete — removing a journey's image
// ---------------------------------------------------------------------------

/**
 * Removes a journey's one image.
 *
 * The opposite order from an upload, for the same reason an upload has its
 * order: the database owns what is visible, so it goes first and storage
 * follows.
 *
 *    1. BEGIN
 *    2. lock packages FOR UPDATE
 *    3. refuse if the journey is gone
 *    4. read the relation, remembering the asset id and the object key
 *    5. refuse if there is no image
 *    6. delete package_media
 *    7. delete media_assets
 *    8. COMMIT
 *    9. and only then remove the object
 *
 * If anything before step 8 fails, the transaction rolls back and **no
 * storage call is made at all** — the row still exists, and the object it
 * points at must still be there.
 *
 * If step 9 fails, the deletion has still happened. The row is gone, the
 * image is gone from every page that showed it, and what is left in storage
 * is an orphan. Recreating the row to match the object would be the one
 * outcome this architecture refuses: a visible image nobody asked to keep.
 *
 * `seed_managed` is not read and not written.
 */
export async function deletePackageImage(
  dependencies: PackageMediaDependencies,
  input: { slug: string },
): Promise<PackageImageDeleteResult> {
  const pending: { storageKey: string | null; reference: string | null } = {
    storageKey: null,
    reference: null,
  };

  let removed: { storageKey: string } | PackageImageDeleteResult;

  try {
    removed = await withTransaction(async (client) => {
      const locked = await lockPackageForMediaChange(client, input.slug);

      if (!locked) {
        return rollback<{ storageKey: string } | PackageImageDeleteResult>({
          outcome: 'package-not-found',
        });
      }

      const existing = await findPackageImageForUpdate(client, locked.packageId);

      if (!existing) {
        return rollback<{ storageKey: string } | PackageImageDeleteResult>({
          outcome: 'image-not-found',
        });
      }

      const relationRemoved = await deletePackageMedia(client, locked.packageId);

      if (!relationRemoved) {
        // Unreachable: the row is held by this transaction's own lock.
        throw new Error('Journey image vanished while it was being deleted');
      }

      // Only now, with nothing referencing it: the asset's foreign key from
      // the relation is RESTRICT, so the other order is refused outright.
      await deleteMediaAssetById(client, existing.mediaAssetId);

      pending.storageKey = existing.storageKey;
      pending.reference = existing.reference;

      return commit<{ storageKey: string } | PackageImageDeleteResult>({
        storageKey: existing.storageKey,
      });
    });
  } catch (error) {
    if (isCommitOutcomeUncertain(error)) {
      // The rows may or may not be gone. Removing the object now would, in
      // the reality where the transaction did not commit, leave a surviving
      // row pointing at nothing.
      throw new MediaPersistenceOutcomeUncertainError(
        'delete',
        { reference: pending.reference, storageKey: pending.storageKey },
        error.cause,
      );
    }

    throw error;
  }

  if ('outcome' in removed) {
    // Nothing was committed, so nothing is removed from storage.
    return removed;
  }

  return {
    outcome: 'deleted',
    cleanup: await compensate(dependencies.storage, removed.storageKey),
  };
}

// ---------------------------------------------------------------------------
// Alt text — describing the image, without touching it
// ---------------------------------------------------------------------------

/**
 * Replaces the description of the image a journey already has.
 *
 * The only journey media operation that touches no object, and the only one
 * that takes no storage: there is no `PackageMediaDependencies` parameter,
 * so "this operation performs no storage call" is a fact about the code
 * rather than a promise in a comment. Nothing here can PUT or DELETE an
 * object, and no provider is resolved — which also means this route keeps
 * working on a deployment with no R2 configuration at all.
 *
 *    1. normalize the text                            no I/O
 *    2. BEGIN
 *    3. lock packages FOR UPDATE
 *    4. refuse if the journey is gone
 *    5. read package_media under that lock
 *    6. refuse if there is no image to describe
 *    7. UPDATE package_media: alt_text and updated_at, nothing else
 *    8. read back, COMMIT
 *
 * Step 1 happens before anything is locked: a value the domain refuses is an
 * answer this function can give without a transaction, and giving it early
 * means a bad request never takes a lock another administrator is waiting
 * for.
 *
 * `media_asset_id` is never written, so describing a picture cannot change
 * which picture it is. `media_assets` is not touched at all — an asset is
 * immutable, and the description belongs to the placement rather than to the
 * bytes. `seed_managed` is not read and not written.
 *
 * Setting the description that is already stored succeeds and writes it
 * again, moving `updated_at`. An administrator asking for something already
 * true has not made a mistake, and detecting the no-op would mean reading to
 * compare before writing for no gain a caller can observe.
 */
export async function updatePackageImageAltText(input: {
  slug: string;
  altText: unknown;
}): Promise<PackageImageAltTextResult> {
  // The shared rule, and the only place the 240-character ceiling lives.
  // Absent, empty and whitespace-only all become null, because all three
  // mean the same thing.
  const altText = normalizeAltText(input.altText);

  if (!altText.ok) {
    return { outcome: 'invalid-alt-text' };
  }

  try {
    return await withTransaction(async (client) => {
      const locked = await lockPackageForMediaChange(client, input.slug);

      if (!locked) {
        return rollback<PackageImageAltTextResult>({ outcome: 'package-not-found' });
      }

      const existing = await findPackageImageForUpdate(client, locked.packageId);

      if (!existing) {
        return rollback<PackageImageAltTextResult>({ outcome: 'image-not-found' });
      }

      const written = await updatePackageMediaAltText(client, {
        packageId: locked.packageId,
        altText: altText.value,
      });

      if (!written) {
        // Unreachable: the row is held by this transaction's own lock.
        throw new Error('Journey image vanished while its description was being changed');
      }

      const image = await findAdminPackageImage(client, locked.packageId);

      if (!image) {
        throw new Error('Journey image vanished immediately after being described');
      }

      return commit<PackageImageAltTextResult>({ outcome: 'updated', image });
    });
  } catch (error) {
    if (isCommitOutcomeUncertain(error)) {
      // No object is in doubt — this operation wrote none — but the row's
      // fate is, so the caller is told to look again rather than assume the
      // description was or was not stored. Both identity fields are null
      // because there is nothing in storage to reconcile.
      throw new MediaPersistenceOutcomeUncertainError(
        'alt-text',
        { reference: null, storageKey: null },
        error.cause,
      );
    }

    throw error;
  }
}
