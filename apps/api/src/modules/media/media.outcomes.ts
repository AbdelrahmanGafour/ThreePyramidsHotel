/**
 * What happens at the seam between PostgreSQL and object storage.
 *
 * Two systems that do not commit together, and the three facts a caller needs
 * when they disagree: what became of an object the database declined to own,
 * an upload whose object could not be removed again, and a COMMIT that never
 * answered.
 *
 * Shared on purpose. Room-type images and journey images run the same
 * sequence for the same reason, and the doctrine these types encode — storage
 * may hold an object the database has never heard of, but the database must
 * never hold a row pointing at an object that is gone — is one rule for the
 * whole system rather than one per owner.
 *
 * No HTTP here. No status codes, no messages meant for a person, no Express:
 * each admin media layer maps these onto its own locked responses. Nothing in
 * this file imports anything at all.
 */

/**
 * What became of an object the database declined to take ownership of, or
 * released ownership of.
 *
 * Kept because it is operationally real: a failed cleanup leaves an orphan,
 * and the key is the only way anyone would ever find it again. A storage key
 * is a random UUID under a fixed prefix and reveals nothing about the hotel,
 * its guests or its configuration — but it is internal diagnostics, not a
 * public API field, and this step does not put it in a response.
 */
export type AttemptedStorageCleanup =
  | { attempted: true; removed: true }
  | { attempted: true; removed: false; storageKey: string };

export type StorageCleanup = { attempted: false } | AttemptedStorageCleanup;

/**
 * An upload failed *and* the object it had already written could not be
 * removed again.
 *
 * Thrown only when both are true. When cleanup succeeds the original failure
 * is re-thrown untouched, because there is nothing extra to say; when it does
 * not, the orphan is the fact that would otherwise be lost, so it is named and
 * the original travels as the cause.
 *
 * Carries the storage key, and nothing else that anything will serialise. No
 * endpoint, no bucket, no credential, no SDK payload, no SQL.
 *
 * The original failure is attached through `Error`'s own `cause` option rather
 * than by assignment, which is the difference between a non-enumerable
 * property and one that `JSON.stringify` would copy out. A database error can
 * carry query detail, and an error that travels is an error that eventually
 * gets logged somewhere it should not be — but it is still the only thing that
 * explains what went wrong, so it stays reachable for a debugger and invisible
 * to a serialiser.
 */
export class MediaUploadCleanupError extends Error {
  readonly storageKey: string;

  constructor(storageKey: string, cause: unknown) {
    super('Media upload failed and its stored object could not be removed', { cause });
    this.name = 'MediaUploadCleanupError';
    this.storageKey = storageKey;
  }
}

export function isMediaUploadCleanupError(error: unknown): error is MediaUploadCleanupError {
  return error instanceof MediaUploadCleanupError;
}

/**
 * Which write was in flight when the commit stopped answering.
 *
 * `replace` is its own value rather than an upload followed by a delete: a
 * journey's image is swapped inside one transaction, and an uncertain outcome
 * there leaves TWO objects whose fate is unknown, not one.
 *
 * `alt-text` writes no object at all, so its `reference` and `storageKey` are
 * both null. It is still this error rather than a plain failure, because the
 * row's own fate is just as unknown and a caller must be told to look again
 * rather than assume the description was or was not stored.
 */
export type MediaPersistenceOperation = 'upload' | 'replace' | 'delete' | 'alt-text';

/**
 * PostgreSQL was asked to commit and did not say whether it did.
 *
 * This is not a failure. A `COMMIT` that throws means the answer never
 * arrived, and the two possible realities are both live: the transaction may
 * have committed and the acknowledgement been lost, or it may never have
 * committed at all. Nothing available to this process can tell them apart —
 * issuing a `ROLLBACK` afterwards proves nothing, because a rollback of a
 * transaction that already committed is a no-op that still answers "ok".
 *
 * It matters because compensation depends on knowing. Deleting the object
 * after an uncertain upload commit would, in the reality where the row exists,
 * leave a committed row pointing at nothing — the one outcome this
 * architecture refuses. So the object is kept and the uncertainty is reported,
 * which at worst leaves an orphan.
 *
 * Named for what is true: the outcome is uncertain. Never "failed", never
 * "rolled back", never "not created" — none of those is known.
 *
 * Carries the reference and the storage key, because reconciliation will need
 * them and neither is a secret. It carries no connection string, endpoint,
 * bucket, credential, AWS request or query text, and the underlying error is
 * attached non-enumerably so nothing serialises it by accident.
 */
export class MediaPersistenceOutcomeUncertainError extends Error {
  readonly operation: MediaPersistenceOperation;
  readonly reference: string | null;
  readonly storageKey: string | null;

  constructor(
    operation: MediaPersistenceOperation,
    identity: { reference: string | null; storageKey: string | null },
    cause: unknown,
  ) {
    super(`Media ${operation} persistence outcome uncertain`, { cause });
    this.name = 'MediaPersistenceOutcomeUncertainError';
    this.operation = operation;
    this.reference = identity.reference;
    this.storageKey = identity.storageKey;
  }
}

export function isMediaPersistenceOutcomeUncertainError(
  error: unknown,
): error is MediaPersistenceOutcomeUncertainError {
  return error instanceof MediaPersistenceOutcomeUncertainError;
}
