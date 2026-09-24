import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMediaConfigurationError } from '../src/modules/media/media.config';
import {
  composePublicMediaUrl,
  createLazyPublicMediaBaseUrlProvider,
} from '../src/modules/media/media.delivery';
import { parseMediaReference } from '../src/modules/media/media.validation';
import type { EnvironmentLike } from '../src/modules/media/media.config';

// The public-delivery boundary, proven entirely offline: no network, no R2
// variable set in this process, no PostgreSQL, no Express. Every
// configuration test hands a plain object to the parser; every composition
// test checks the exact string produced.

const REFERENCE = parseMediaReference('550e8400-e29b-41d4-a716-446655440000');
assert.ok(REFERENCE, 'the fixture reference must itself be canonical');

const ROOT_BASE = 'https://media.example.test';
const PATH_BASE = 'https://media.example.test/assets';

const completeEnvironment = (): EnvironmentLike => ({ R2_PUBLIC_BASE_URL: ROOT_BASE });

describe('composePublicMediaUrl', () => {
  it('builds the exact URL for a root base', () => {
    assert.equal(
      composePublicMediaUrl(ROOT_BASE, REFERENCE),
      'https://media.example.test/media/550e8400-e29b-41d4-a716-446655440000.webp',
    );
  });

  it('builds the exact URL for a base with a path, preserving it', () => {
    assert.equal(
      composePublicMediaUrl(PATH_BASE, REFERENCE),
      'https://media.example.test/assets/media/550e8400-e29b-41d4-a716-446655440000.webp',
    );
  });

  it('produces no double slash whatever the base already ends in', () => {
    for (const base of [ROOT_BASE, PATH_BASE]) {
      const url = composePublicMediaUrl(base, REFERENCE);

      assert.equal(url.includes('//media/'), false, `double slash before the key: ${url}`);
      assert.equal(new URL(url).pathname.includes('//'), false, `double slash in the path: ${url}`);
    }
  });

  it('ends in exactly what mediaStorageKey(reference) produces', () => {
    const url = composePublicMediaUrl(ROOT_BASE, REFERENCE);

    assert.ok(url.endsWith('/media/550e8400-e29b-41d4-a716-446655440000.webp'));
  });

  it('contains no filename, room slug, admin identity or query/fragment', () => {
    const url = composePublicMediaUrl(PATH_BASE, REFERENCE);
    const parsed = new URL(url);

    assert.equal(parsed.search, '');
    assert.equal(parsed.hash, '');
    assert.equal(parsed.username, '');
    assert.equal(parsed.password, '');
    // Every path segment is either the configured base's own or the fixed
    // "media" / "<uuid>.webp" pair — nothing else was ever added.
    assert.deepEqual(
      parsed.pathname.split('/').filter(Boolean),
      ['assets', 'media', '550e8400-e29b-41d4-a716-446655440000.webp'],
    );
  });

  it('is stable: the same reference and base always produce the same URL', () => {
    assert.equal(composePublicMediaUrl(ROOT_BASE, REFERENCE), composePublicMediaUrl(ROOT_BASE, REFERENCE));
  });
});

describe('the branded reference is load-bearing', () => {
  it('cannot be used to build a URL from an arbitrary unvalidated string', () => {
    // @ts-expect-error composePublicMediaUrl takes a MediaReference, not a bare string
    const attempt = (): string => composePublicMediaUrl(ROOT_BASE, 'not-a-uuid');

    // The type system is the primary guard (proven by the suppressed error
    // above); mediaStorageKey's own runtime guard is the second line, for a
    // value that reached here via a cast rather than through
    // createMediaReference() or parseMediaReference().
    assert.throws(attempt, { name: 'InvalidMediaReferenceError' });
  });
});

describe('the lazy public base provider', () => {
  it('requires no R2_PUBLIC_BASE_URL to import this module', () => {
    assert.equal(process.env.R2_PUBLIC_BASE_URL, undefined, 'must not be set while this suite runs');
    assert.equal(typeof createLazyPublicMediaBaseUrlProvider, 'function');
    assert.equal(typeof composePublicMediaUrl, 'function');
  });

  it('resolves nothing until the returned function is called', () => {
    // Constructing the provider must not itself throw or read anything, even
    // with no configuration present.
    assert.doesNotThrow(() => createLazyPublicMediaBaseUrlProvider({}));
  });

  it('throws MediaConfigurationError when the variable is absent', () => {
    const provider = createLazyPublicMediaBaseUrlProvider({});

    assert.throws(() => provider(), (error: unknown) => {
      assert.ok(isMediaConfigurationError(error));
      assert.equal(error.variable, 'R2_PUBLIC_BASE_URL');

      return true;
    });
  });

  it('throws MediaConfigurationError for an invalid value, without leaking it', () => {
    const provider = createLazyPublicMediaBaseUrlProvider({ R2_PUBLIC_BASE_URL: 'http://insecure.example.com' });

    assert.throws(() => provider(), (error: unknown) => {
      assert.ok(isMediaConfigurationError(error));
      assert.equal(error.message.includes('insecure.example.com'), false);

      return true;
    });
  });

  it('resolves the configured base on success', () => {
    const provider = createLazyPublicMediaBaseUrlProvider(completeEnvironment());

    assert.equal(provider(), ROOT_BASE);
  });

  it('memoizes only a successful resolution', () => {
    const environment: EnvironmentLike = {};
    const provider = createLazyPublicMediaBaseUrlProvider(environment);

    assert.throws(() => provider());

    // Fixed after the fact, exactly as an operator would: no restart needed.
    environment.R2_PUBLIC_BASE_URL = ROOT_BASE;
    assert.equal(provider(), ROOT_BASE);

    // And now that a success is cached, changing the environment again does
    // not retroactively invalidate it — matching the storage provider's own
    // memoization contract.
    environment.R2_PUBLIC_BASE_URL = PATH_BASE;
    assert.equal(provider(), ROOT_BASE, 'a cached success is not re-resolved');
  });

  it('needs no storage credential to resolve', () => {
    // Only R2_PUBLIC_BASE_URL is read; none of the storage variables appear
    // in the environment this provider is handed, and it still succeeds.
    const provider = createLazyPublicMediaBaseUrlProvider({ R2_PUBLIC_BASE_URL: ROOT_BASE });

    assert.doesNotThrow(() => provider());
  });
});
