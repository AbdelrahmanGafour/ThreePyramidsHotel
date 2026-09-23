import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { PutObjectCommandInput } from '@aws-sdk/client-s3';
import {
  MediaConfigurationError,
  isMediaConfigurationError,
  parsePublicMediaBaseUrl,
  parseR2StorageConfig,
  type EnvironmentLike,
} from '../src/modules/media/media.config';
import {
  createMediaStorage,
  createR2MediaStorage,
  r2ClientConfig,
  type S3CommandSender,
} from '../src/modules/media/media.storage';
import {
  MEDIA_CACHE_CONTROL,
  MediaStorageError,
  STORED_CONTENT_TYPE,
  isMediaStorageError,
} from '../src/modules/media/media.types';

// The storage boundary, proven entirely offline.
//
// Nothing here reaches Cloudflare, constructs a real request, or reads the
// machine's own environment: every configuration test is handed a plain object
// and every command test is handed a double that records what it was sent. The
// commands themselves are real `PutObjectCommand` and `DeleteObjectCommand`
// instances, so what is inspected is the actual AWS input the SDK would sign,
// not a paraphrase of it.
//
// No DATABASE_URL, no R2 variable, no network.

const ENDPOINT = 'https://example-account.r2.cloudflarestorage.com';
const ACCESS_KEY_ID = 'AKIAEXAMPLEACCESSKEY';
const SECRET_ACCESS_KEY = 'sUp3r-s3cret-example-value-never-real';
const BUCKET = 'three-pyramids-media-dev';
const PUBLIC_BASE_URL = 'https://media.example.com';

const KEY = 'media/550e8400-e29b-41d4-a716-446655440000.webp';

const completeEnvironment = (): EnvironmentLike => ({
  R2_ENDPOINT: ENDPOINT,
  R2_ACCESS_KEY_ID: ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
  R2_BUCKET: BUCKET,
});

/** Narrows a recorded command to a put, and hands back its real AWS input. */
function putInput(command: PutObjectCommand | DeleteObjectCommand | undefined): PutObjectCommandInput {
  assert.ok(command instanceof PutObjectCommand, 'expected a PutObjectCommand');

  return command.input;
}

/** A sender that records commands and never sends one anywhere. */
function recordingSender(): { sender: S3CommandSender; sent: (PutObjectCommand | DeleteObjectCommand)[] } {
  const sent: (PutObjectCommand | DeleteObjectCommand)[] = [];

  return {
    sent,
    sender: {
      async send(command) {
        sent.push(command);

        return {};
      },
    },
  };
}

/** A sender that fails the way a real outage does, with an SDK-shaped error. */
function failingSender(message: string): S3CommandSender {
  return {
    async send() {
      const error = new Error(message);

      error.name = 'NoSuchBucket';
      throw error;
    },
  };
}

/** Everything a safe error must never repeat back. */
const SECRETS = [ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET, PUBLIC_BASE_URL];

function assertMentionsNoSecret(text: string): void {
  for (const secret of SECRETS) {
    assert.ok(!text.includes(secret), `a configured value leaked: ${text}`);
  }
}

/** Runs something that must throw a configuration error, and returns it. */
function configurationError(run: () => unknown): MediaConfigurationError {
  try {
    run();
  } catch (error) {
    assert.ok(isMediaConfigurationError(error), `expected MediaConfigurationError, got ${String(error)}`);

    return error;
  }

  assert.fail('expected the configuration to be rejected');
}

describe('lazy configuration', () => {
  it('needs no R2 variable to import the storage module', () => {
    // If any of these read the environment at module scope, importing this
    // test file would already have thrown — the suite runs with no R2
    // variable set at all.
    for (const variable of Object.keys(completeEnvironment())) {
      assert.equal(process.env[variable], undefined, `${variable} must not be set while these tests run`);
    }

    assert.equal(typeof createR2MediaStorage, 'function');
    assert.equal(typeof createMediaStorage, 'function');
    assert.equal(typeof r2ClientConfig, 'function');
  });

  it('constructs no client until asked', () => {
    // The factory is where a client would come from, and it refuses before
    // building one when the deployment is not configured.
    const error = configurationError(() => createR2MediaStorage({}));

    assert.equal(error.variable, 'R2_ENDPOINT');
  });

  it('accepts a complete configuration', () => {
    assert.deepEqual(parseR2StorageConfig(completeEnvironment()), {
      endpoint: ENDPOINT,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      bucket: BUCKET,
    });
  });

  it('names each missing variable', () => {
    for (const variable of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      const environment = completeEnvironment();

      delete environment[variable];

      assert.equal(configurationError(() => parseR2StorageConfig(environment)).variable, variable);
    }
  });

  it('treats an empty or non-string value as missing', () => {
    for (const variable of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      const environment = { ...completeEnvironment(), [variable]: '' };

      assert.equal(configurationError(() => parseR2StorageConfig(environment)).variable, variable);
    }
  });

  it('does not repair a secret that needs repairing', () => {
    // A trailing newline from a copy-paste is not the secret. Signing with a
    // tidied-up version would succeed by accident.
    const environment = { ...completeEnvironment(), R2_SECRET_ACCESS_KEY: `${SECRET_ACCESS_KEY}\n` };

    assert.equal(parseR2StorageConfig(environment).secretAccessKey, `${SECRET_ACCESS_KEY}\n`);
  });

  describe('the endpoint', () => {
    const rejects = (endpoint: string, label = endpoint) => {
      const error = configurationError(() => parseR2StorageConfig({ ...completeEnvironment(), R2_ENDPOINT: endpoint }));

      assert.equal(error.variable, 'R2_ENDPOINT', label);

      return error;
    };

    it('rejects a value that is not an absolute URL', () => {
      for (const endpoint of ['not a url', '/bucket', 'example.com', '://x', 'https://']) {
        rejects(endpoint);
      }
    });

    it('rejects any scheme but https', () => {
      for (const endpoint of ['http://example.com', 'ftp://example.com', 's3://example.com']) {
        assert.match(rejects(endpoint).message, /https/);
      }
    });

    it('rejects an embedded username or password', () => {
      assert.match(rejects('https://user:pass@example.com').message, /username or password/);
      assert.match(rejects('https://user@example.com').message, /username or password/);
    });

    it('rejects a query string', () => {
      assert.match(rejects('https://example.com?x=1').message, /query/);
      assert.match(rejects('https://example.com?').message, /query/);
    });

    it('rejects a fragment', () => {
      assert.match(rejects('https://example.com#frag').message, /fragment/);
      assert.match(rejects('https://example.com#').message, /fragment/);
    });

    it('rejects surrounding whitespace rather than stripping it', () => {
      // new URL() would silently accept these. Quiet repair is not this
      // project's habit.
      for (const endpoint of [` ${ENDPOINT}`, `${ENDPOINT} `, `\n${ENDPOINT}`, `${ENDPOINT}\t`]) {
        assert.match(rejects(endpoint, JSON.stringify(endpoint)).message, /whitespace/);
      }
    });

    it('does not insist on a Cloudflare host', () => {
      // A future S3-compatible test endpoint must remain usable.
      for (const endpoint of ['https://localhost:9000', 'https://minio.internal/s3', 'https://s3.example.org']) {
        assert.equal(parseR2StorageConfig({ ...completeEnvironment(), R2_ENDPOINT: endpoint }).endpoint, endpoint);
      }
    });
  });

  it('never echoes a configured value in an error', () => {
    const rejected: EnvironmentLike[] = [
      {},
      { ...completeEnvironment(), R2_ENDPOINT: `http://${ACCESS_KEY_ID}.example.com` },
      { ...completeEnvironment(), R2_ENDPOINT: `https://${ACCESS_KEY_ID}:${SECRET_ACCESS_KEY}@example.com` },
      { ...completeEnvironment(), R2_ENDPOINT: `${ENDPOINT}?key=${SECRET_ACCESS_KEY}` },
      { ...completeEnvironment(), R2_BUCKET: '' },
      { ...completeEnvironment(), R2_SECRET_ACCESS_KEY: '' },
    ];

    for (const environment of rejected) {
      const error = configurationError(() => parseR2StorageConfig(environment));

      assertMentionsNoSecret(error.message);
      assertMentionsNoSecret(JSON.stringify({ message: error.message, variable: error.variable }));
      assert.ok(!/\d+ characters/.test(error.message), 'a secret length was described');
    }
  });
});

describe('the public base URL', () => {
  it('is resolved separately from storage', () => {
    // Storage configuration succeeds with it entirely absent.
    const environment = completeEnvironment();

    assert.equal(environment.R2_PUBLIC_BASE_URL, undefined);
    assert.doesNotThrow(() => parseR2StorageConfig(environment));
    assert.equal(configurationError(() => parsePublicMediaBaseUrl(environment)).variable, 'R2_PUBLIC_BASE_URL');
  });

  it('is never read when building the storage adapter', () => {
    // A deliberately invalid value must not affect storage in any way.
    const environment = { ...completeEnvironment(), R2_PUBLIC_BASE_URL: 'http://insecure.example.com?x=1#y' };

    assert.doesNotThrow(() => parseR2StorageConfig(environment));
    assert.doesNotThrow(() => createR2MediaStorage(environment));
  });

  it('accepts a valid https base URL', () => {
    assert.equal(parsePublicMediaBaseUrl({ R2_PUBLIC_BASE_URL: PUBLIC_BASE_URL }), PUBLIC_BASE_URL);
    assert.equal(parsePublicMediaBaseUrl({ R2_PUBLIC_BASE_URL: 'https://media.example.com/assets' }), 'https://media.example.com/assets');
  });

  it('normalizes only the trailing slash, so keys join cleanly', () => {
    for (const configured of [PUBLIC_BASE_URL, `${PUBLIC_BASE_URL}/`, `${PUBLIC_BASE_URL}///`]) {
      const base = parsePublicMediaBaseUrl({ R2_PUBLIC_BASE_URL: configured });

      assert.equal(base, PUBLIC_BASE_URL, JSON.stringify(configured));
      assert.equal(`${base}/${KEY}`, `${PUBLIC_BASE_URL}/${KEY}`);
    }
  });

  it('rejects an insecure or malformed base URL', () => {
    for (const configured of [
      'http://media.example.com',
      'media.example.com',
      'not a url',
      'https://user:pass@media.example.com',
      'https://media.example.com?v=2',
      'https://media.example.com#top',
      ' https://media.example.com',
      '',
    ]) {
      assert.equal(
        configurationError(() => parsePublicMediaBaseUrl({ R2_PUBLIC_BASE_URL: configured })).variable,
        'R2_PUBLIC_BASE_URL',
        JSON.stringify(configured),
      );
    }
  });

  it('never echoes its configured value in an error', () => {
    for (const configured of [
      `http://${PUBLIC_BASE_URL.slice(8)}`,
      `https://user:${SECRET_ACCESS_KEY}@media.example.com`,
      `${PUBLIC_BASE_URL}?token=${SECRET_ACCESS_KEY}`,
    ]) {
      const error = configurationError(() => parsePublicMediaBaseUrl({ R2_PUBLIC_BASE_URL: configured }));

      assertMentionsNoSecret(error.message);
      assert.ok(!error.message.includes('media.example.com'), `the configured host leaked: ${error.message}`);
    }
  });
});

describe('putObject', () => {
  let recorder: ReturnType<typeof recordingSender>;

  beforeEach(() => {
    recorder = recordingSender();
  });

  const body = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

  it('sends exactly one PutObjectCommand', async () => {
    await createMediaStorage(recorder.sender, BUCKET).putObject({
      key: KEY,
      body,
      contentType: STORED_CONTENT_TYPE,
    });

    assert.equal(recorder.sent.length, 1);
    assert.ok(recorder.sent[0] instanceof PutObjectCommand);
  });

  it('carries the bucket, the key, the bytes and the type', async () => {
    await createMediaStorage(recorder.sender, BUCKET).putObject({
      key: KEY,
      body,
      contentType: STORED_CONTENT_TYPE,
    });

    const input = putInput(recorder.sent[0]);

    assert.equal(input.Bucket, BUCKET);
    assert.equal(input.Key, KEY);
    assert.equal(input.Body, body, 'the exact Buffer, not a copy or a stream');
    assert.equal(input.ContentType, 'image/webp');
  });

  it('marks the object immutable for a year', async () => {
    await createMediaStorage(recorder.sender, BUCKET).putObject({
      key: KEY,
      body,
      contentType: STORED_CONTENT_TYPE,
    });

    assert.equal(putInput(recorder.sent[0]).CacheControl, MEDIA_CACHE_CONTROL);
    assert.equal(MEDIA_CACHE_CONTROL, 'public, max-age=31536000, immutable');
  });

  it('sends those five fields and nothing else', async () => {
    await createMediaStorage(recorder.sender, BUCKET).putObject({
      key: KEY,
      body,
      contentType: STORED_CONTENT_TYPE,
    });

    // No ACL, no ContentDisposition, no Metadata, no Tagging — a filename,
    // a room-type slug or an administrator's identity has nowhere to travel.
    assert.deepEqual(Object.keys(recorder.sent[0]!.input).sort(), [
      'Body',
      'Bucket',
      'CacheControl',
      'ContentType',
      'Key',
    ]);
  });

  it('never leaves the key to be rebuilt here', async () => {
    // Whatever key it is given is the key it sends, unchanged: there is no
    // second implementation of the rule that keeps user input out of keys.
    const storage = createMediaStorage(recorder.sender, BUCKET);

    for (const key of [KEY, 'media/00000000-0000-4000-8000-000000000000.webp']) {
      await storage.putObject({ key, body, contentType: STORED_CONTENT_TYPE });
    }

    assert.deepEqual(
      recorder.sent.map((command) => putInput(command).Key),
      [KEY, 'media/00000000-0000-4000-8000-000000000000.webp'],
    );
  });
});

describe('deleteObject', () => {
  it('sends exactly one DeleteObjectCommand with the bucket and key', async () => {
    const recorder = recordingSender();

    await createMediaStorage(recorder.sender, BUCKET).deleteObject(KEY);

    assert.equal(recorder.sent.length, 1);
    assert.ok(recorder.sent[0] instanceof DeleteObjectCommand);
    assert.deepEqual(recorder.sent[0]!.input, { Bucket: BUCKET, Key: KEY });
  });

  it('involves no listing, copying or administration', async () => {
    const recorder = recordingSender();
    const storage = createMediaStorage(recorder.sender, BUCKET);

    await storage.putObject({ key: KEY, body: Buffer.from([1]), contentType: STORED_CONTENT_TYPE });
    await storage.deleteObject(KEY);

    assert.deepEqual(
      recorder.sent.map((command) => command.constructor.name),
      ['PutObjectCommand', 'DeleteObjectCommand'],
      'the port issues these two commands and no others',
    );
  });

  it('offers exactly two operations', () => {
    const storage = createMediaStorage(recordingSender().sender, BUCKET);

    assert.deepEqual(Object.keys(storage).sort(), ['deleteObject', 'putObject']);
  });
});

describe('storage failures', () => {
  const sdkMessage = `The specified bucket ${BUCKET} does not exist at ${ENDPOINT} for key ${ACCESS_KEY_ID}`;

  it('turns a failed put into a safe MediaStorageError', async () => {
    const storage = createMediaStorage(failingSender(sdkMessage), BUCKET);

    await assert.rejects(
      () => storage.putObject({ key: KEY, body: Buffer.from([1]), contentType: STORED_CONTENT_TYPE }),
      (error: unknown) => {
        assert.ok(isMediaStorageError(error));
        assert.equal(error.operation, 'put');

        return true;
      },
    );
  });

  it('turns a failed delete into a safe MediaStorageError', async () => {
    const storage = createMediaStorage(failingSender(sdkMessage), BUCKET);

    await assert.rejects(
      () => storage.deleteObject(KEY),
      (error: unknown) => {
        assert.ok(isMediaStorageError(error));
        assert.equal(error.operation, 'delete');

        return true;
      },
    );
  });

  it('identifies the operation and nothing more', async () => {
    const storage = createMediaStorage(failingSender(sdkMessage), BUCKET);

    for (const [operation, run] of [
      ['put', () => storage.putObject({ key: KEY, body: Buffer.from([1]), contentType: STORED_CONTENT_TYPE })],
      ['delete', () => storage.deleteObject(KEY)],
    ] as const) {
      const error = await run().then(
        () => assert.fail('expected a rejection'),
        (caught: MediaStorageError) => caught,
      );

      assert.equal(error.message, `Media storage ${operation} failed`);
      assert.equal(error.name, 'MediaStorageError');
      // The operation and the class name, and no field carrying an SDK
      // payload, a request id, a bucket or an endpoint alongside them.
      assert.deepEqual(Object.keys(error).sort(), ['name', 'operation']);
    }
  });

  it('does not carry the SDK error forward, as a message or as a cause', async () => {
    const storage = createMediaStorage(failingSender(sdkMessage), BUCKET);

    const error = await storage
      .deleteObject(KEY)
      .then(() => assert.fail('expected a rejection'), (caught: MediaStorageError) => caught);

    assert.ok(!error.message.includes('does not exist'), 'the SDK message became the safe message');
    assert.equal((error as { cause?: unknown }).cause, undefined, 'the SDK error travelled as a cause');
  });

  it('never repeats a credential, endpoint or bucket', async () => {
    const storage = createMediaStorage(failingSender(sdkMessage), BUCKET);

    const error = await storage
      .putObject({ key: KEY, body: Buffer.from([1]), contentType: STORED_CONTENT_TYPE })
      .then(() => assert.fail('expected a rejection'), (caught: MediaStorageError) => caught);

    assertMentionsNoSecret(error.message);
    assertMentionsNoSecret(String(error));
    assertMentionsNoSecret(error.stack ?? '');
    assertMentionsNoSecret(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  });

  it('is an ordinary Error, so nothing has to know about it to handle it', () => {
    const error = new MediaStorageError('put');

    assert.ok(error instanceof Error);
    assert.equal(isMediaStorageError(error), true);
    assert.equal(isMediaStorageError(new Error('put')), false);
  });
});

describe('the R2 client configuration', () => {
  const config = {
    endpoint: ENDPOINT,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    bucket: BUCKET,
  };

  it('is exactly the locked set of options', () => {
    assert.deepEqual(r2ClientConfig(config), {
      region: 'auto',
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
    });
  });

  it('uses the region R2 requires', () => {
    // R2 has no regions, but the SDK signs with one and will not build a
    // request without it.
    assert.equal(r2ClientConfig(config).region, 'auto');
  });

  it('passes the configured endpoint through unchanged', () => {
    for (const endpoint of [ENDPOINT, 'https://minio.internal/s3', 'https://localhost:9000']) {
      assert.equal(r2ClientConfig({ ...config, endpoint }).endpoint, endpoint);
    }
  });

  it('addresses the bucket by path rather than by hostname', () => {
    assert.equal(r2ClientConfig(config).forcePathStyle, true);
  });

  it('presigns nothing and enables no browser credentials', () => {
    assert.deepEqual(Object.keys(r2ClientConfig(config)).sort(), [
      'credentials',
      'endpoint',
      'forcePathStyle',
      'region',
    ]);
  });

  it('builds a working port from a complete environment', () => {
    // The one place a real client is constructed. No request is made: the
    // client is built, the port is returned, and nothing is sent.
    const storage = createR2MediaStorage(completeEnvironment());

    assert.deepEqual(Object.keys(storage).sort(), ['deleteObject', 'putObject']);
  });
});
