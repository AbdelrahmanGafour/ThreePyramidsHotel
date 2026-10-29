import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { parseR2StorageConfig, type EnvironmentLike, type R2StorageConfig } from './media.config';
import { MEDIA_CACHE_CONTROL, MediaStorageError, type MediaStorage } from './media.types';

/**
 * The Cloudflare R2 adapter behind the `MediaStorage` port.
 *
 * R2 speaks S3, so this is the AWS SDK pointed at an R2 endpoint rather than
 * anything Cloudflare-specific. Request signing is the SDK's — hand-rolling
 * SigV4 is not a trade this project should make — and nothing here presigns,
 * lists, copies or administers a bucket, because the application does none of
 * those and the deployment token is not scoped for them.
 *
 * Nothing happens when this module is imported. There is no client at module
 * scope, no configuration read at module scope, and no environment variable
 * required to load it. A client exists only after something explicitly calls
 * `createR2MediaStorage`, which is what keeps `app.ts`, every service and every
 * unit test able to import this file with no R2 credentials present at all.
 *
 * The SDK stops here. `S3Client`, the command classes and every AWS response
 * type stay inside this file; a service is handed a `MediaStorage` and can be
 * run against an in-memory double without knowing R2 exists.
 */

/**
 * As much of the SDK client as this adapter uses.
 *
 * Narrow on purpose: it is what makes an offline test able to supply a double
 * that records the exact commands, and it keeps the adapter from quietly
 * growing a dependency on the rest of the client's surface.
 */
export type S3CommandSender = {
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown>;
};

/**
 * The client options for Cloudflare R2, as a value rather than as a literal
 * buried in a constructor call, so a test can read them without a network.
 *
 * `region: 'auto'` is R2's: it has no regions, but the SDK signs with one and
 * refuses to build a request without it. `forcePathStyle` puts the bucket in
 * the path instead of the hostname, which is how an S3-compatible endpoint is
 * addressed, and which also keeps a bucket name out of DNS.
 *
 * Retries, timeouts and the flexible-checksum settings are left as the SDK
 * resolves them. Changing a signing-adjacent default from memory would be
 * guessing at how R2 responds; whether R2 needs an explicit
 * `requestChecksumCalculation` is a question only a real request can answer,
 * and that is the next step's job rather than this one's.
 */
export function r2ClientConfig(config: R2StorageConfig): S3ClientConfig {
  return {
    region: 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
}

/**
 * The port, over any sender and one bucket.
 *
 * Separate from the R2 factory below so the command-building — which is the
 * part with a contract worth proving — can be exercised without credentials,
 * without a client and without a network.
 */
export function createMediaStorage(sender: S3CommandSender, bucket: string): MediaStorage {
  return {
    async putObject({ key, body, contentType }): Promise<void> {
      // What is deliberately absent matters as much as what is here. No ACL:
      // the bucket's own policy decides what is public, and an object-level
      // grant is a second answer to that question that nobody would think to
      // look for. No ContentDisposition and no Metadata: the only place a
      // filename could come from is the upload, and a filename is the one
      // piece of an upload this system never keeps. No room-type slug and no
      // administrator identity — an object should not be able to tell a reader
      // who uploaded it.
      //
      // The key arrives already built. Rebuilding it here would be a second
      // implementation of the one rule that keeps user input out of object
      // keys entirely.
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: MEDIA_CACHE_CONTROL,
      });

      try {
        await sender.send(command);
      } catch {
        throw new MediaStorageError('put');
      }
    },

    async deleteObject(key): Promise<void> {
      // Idempotent by the protocol rather than by anything done here: S3 and
      // R2 both answer a delete of an absent key with a success. That is what
      // lets the system keep its rule that storage may hold objects the
      // database has forgotten, but never the other way round — a delete that
      // arrives twice is not an error to handle.
      const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });

      try {
        await sender.send(command);
      } catch {
        throw new MediaStorageError('delete');
      }
    },
  };
}

/**
 * The real thing: resolve configuration, build a client, return the port.
 *
 * This call is the only moment any R2 variable is read and the only moment a
 * client is constructed. It throws `MediaConfigurationError` when the
 * deployment is not configured — before a client exists, so a misconfiguration
 * is never a failed request.
 *
 * `R2_PUBLIC_BASE_URL` is not read here. Serving media publicly is a separate
 * concern with its own resolver, and an upload has no reason to fail because
 * public delivery has not been set up.
 */
export function createR2MediaStorage(environment: EnvironmentLike = process.env): MediaStorage {
  const config = parseR2StorageConfig(environment);

  return createMediaStorage(new S3Client(r2ClientConfig(config)), config.bucket);
}

/**
 * The local-disk adapter behind the same `MediaStorage` port, for hosts with
 * no object storage (shared hosting, a single VPS).
 *
 * Keys are `media/<uuid>.webp`, built upstream from a validated reference. The
 * resolved path is still checked to stay inside `rootDir`, so a malformed key
 * can never write or delete outside it. Deleting an absent file succeeds,
 * matching the idempotent delete the R2 adapter gets from the protocol.
 */
export function createLocalMediaStorage(rootDir: string): MediaStorage {
  const root = path.resolve(rootDir);

  function resolveKey(key: string): string {
    const target = path.resolve(root, key);

    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('media key escapes the storage root');
    }

    return target;
  }

  return {
    async putObject({ key, body }): Promise<void> {
      try {
        const target = resolveKey(key);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, body);
      } catch {
        throw new MediaStorageError('put');
      }
    },

    async deleteObject(key): Promise<void> {
      try {
        await fs.rm(resolveKey(key), { force: true });
      } catch {
        throw new MediaStorageError('delete');
      }
    },
  };
}

/** Where the local driver keeps files, and what Express serves under `/media`. */
export function localMediaRoot(environment: EnvironmentLike = process.env): string {
  return path.resolve(environment.MEDIA_LOCAL_DIR || 'uploads');
}

export function isLocalMediaDriver(environment: EnvironmentLike = process.env): boolean {
  return environment.MEDIA_DRIVER === 'local';
}

/**
 * Something that hands back a working `MediaStorage`, resolved only when
 * asked.
 *
 * The room-type media HTTP layer depends on this, never on
 * `createR2MediaStorage` directly — which is what lets a test hand it a
 * function that returns an in-memory double, and what keeps importing the
 * router from reading a single R2 variable. A future package-media feature can
 * take the exact same shape.
 */
export type MediaStorageProvider = () => MediaStorage;

/**
 * The production provider: build the real adapter the first time it is asked
 * for, and remember it.
 *
 * Only a *successful* construction is memoized. If configuration is missing or
 * invalid, `createR2MediaStorage` throws `MediaConfigurationError` and nothing
 * is cached — the next request tries again from scratch, so a deployment fixed
 * without a restart recovers on its own rather than being stuck on the first
 * answer.
 *
 * Calling this function does not read any environment variable; only calling
 * the provider IT RETURNS does, and only the first time that succeeds. A
 * router built with this provider can be imported, and its GET/PATCH routes
 * can run, with every R2 variable absent.
 */
export function createLazyR2MediaStorageProvider(
  environment: EnvironmentLike = process.env,
): MediaStorageProvider {
  let cached: MediaStorage | null = null;

  return () => {
    if (!cached) {
      cached = isLocalMediaDriver(environment)
        ? createLocalMediaStorage(localMediaRoot(environment))
        : createR2MediaStorage(environment);
    }

    return cached;
  };
}
