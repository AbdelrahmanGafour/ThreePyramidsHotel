import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/admin-auth/admin-auth.password';

// Pure: this module touches only node:crypto, so nothing here needs a database.
const PASSWORD = 'correct horse battery staple';

const base64Bytes = (length: number) => randomBytes(length).toString('base64');

/** Builds a stored value with individual pieces replaced, to probe what verification accepts. */
function encodedWith(overrides: { params?: string; salt?: string; hash?: string }): string {
  return [
    'scrypt',
    overrides.params ?? 'N=16384,r=8,p=1',
    overrides.salt ?? base64Bytes(16),
    overrides.hash ?? base64Bytes(64),
  ].join('$');
}

describe('admin password hashing', () => {
  it('verifies the password it hashed', async () => {
    const encoded = await hashPassword(PASSWORD);

    assert.equal(await verifyPassword(PASSWORD, encoded), true);
  });

  it('writes the self-describing scrypt format', async () => {
    const encoded = await hashPassword(PASSWORD);
    const [algorithm, params, salt, hash] = encoded.split('$');

    assert.equal(algorithm, 'scrypt');
    assert.equal(params, 'N=16384,r=8,p=1');
    assert.equal(Buffer.from(salt!, 'base64').length, 16);
    assert.equal(Buffer.from(hash!, 'base64').length, 64);
    // The password never appears in the stored value.
    assert.ok(!encoded.includes(PASSWORD));
  });

  it('rejects a wrong password', async () => {
    const encoded = await hashPassword(PASSWORD);

    assert.equal(await verifyPassword('wrong password entirely', encoded), false);
    assert.equal(await verifyPassword(`${PASSWORD} `, encoded), false);
    assert.equal(await verifyPassword('', encoded), false);
  });

  it('produces a different hash each time, because the salt differs', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    assert.notEqual(first, second);
    // Both still verify: the difference is the salt, not the password.
    assert.equal(await verifyPassword(PASSWORD, first), true);
    assert.equal(await verifyPassword(PASSWORD, second), true);
  });

  it('rejects malformed stored values without throwing', async () => {
    const malformed = [
      '',
      'not-a-hash',
      'scrypt$N=16384,r=8,p=1',
      'scrypt$N=16384,r=8,p=1$only-one-segment',
      'scrypt$N=16384,r=8,p=1$$',
      encodedWith({}).replace('scrypt$', 'bcrypt$'),
      encodedWith({ params: 'N=abc,r=8,p=1' }),
      `${await hashPassword(PASSWORD)}$extra`,
    ];

    for (const encoded of malformed) {
      assert.equal(await verifyPassword(PASSWORD, encoded), false, `should reject: ${encoded.slice(0, 40)}`);
    }
  });

  it('rejects any cost parameters other than the canonical ones', async () => {
    const encoded = await hashPassword(PASSWORD);
    const [, , salt, hash] = encoded.split('$');

    const rejectedParams = [
      'N=8192,r=8,p=1', // lower N
      'N=32768,r=8,p=1', // higher N
      'N=16383,r=8,p=1', // not a power of two
      'N=1073741824,r=8,p=1', // absurd N
      'N=16384,r=4,p=1',
      'N=16384,r=16,p=1',
      'N=16384,r=8,p=0',
      'N=16384,r=8,p=2',
      'N=16384,r=8,p=64',
    ];

    for (const params of rejectedParams) {
      const tampered = ['scrypt', params, salt, hash].join('$');
      assert.equal(await verifyPassword(PASSWORD, tampered), false, `should reject params: ${params}`);
    }
  });

  it('rejects a salt that is not exactly 16 bytes', async () => {
    for (const saltBytes of [0, 1, 8, 15, 17, 32, 1024]) {
      const encoded = encodedWith({ salt: base64Bytes(saltBytes) });
      assert.equal(await verifyPassword(PASSWORD, encoded), false, `should reject ${saltBytes}-byte salt`);
    }
  });

  it('rejects a hash that is not exactly 64 bytes', async () => {
    for (const hashBytes of [0, 1, 32, 63, 65, 96, 4096]) {
      const encoded = encodedWith({ hash: base64Bytes(hashBytes) });
      assert.equal(await verifyPassword(PASSWORD, encoded), false, `should reject ${hashBytes}-byte hash`);
    }
  });

  it('rejects non-canonical base64 encoding', async () => {
    const encoded = await hashPassword(PASSWORD);
    const [algorithm, params, salt, hash] = encoded.split('$');

    // 16 bytes always encode with "==" padding; dropping it still decodes to 16
    // bytes, so only the re-encoding check catches it.
    assert.equal(
      await verifyPassword(PASSWORD, [algorithm, params, salt!.replace(/=+$/, ''), hash].join('$')),
      false,
    );
    assert.equal(
      await verifyPassword(PASSWORD, [algorithm, params, salt, hash!.replace(/=+$/, '')].join('$')),
      false,
    );
  });

  it('rejects a tampered hash or salt of the right size', async () => {
    const encoded = await hashPassword(PASSWORD);
    const [algorithm, params, salt, hash] = encoded.split('$');

    const flip = (segment: string) => (segment.startsWith('A') ? `B${segment.slice(1)}` : `A${segment.slice(1)}`);

    assert.equal(await verifyPassword(PASSWORD, [algorithm, params, salt, flip(hash!)].join('$')), false);
    assert.equal(await verifyPassword(PASSWORD, [algorithm, params, flip(salt!), hash].join('$')), false);
  });

  it('rejects non-string inputs', async () => {
    const encoded = await hashPassword(PASSWORD);

    assert.equal(await verifyPassword(undefined as unknown as string, encoded), false);
    assert.equal(await verifyPassword(PASSWORD, null as unknown as string), false);
  });

  it('refuses to hash an empty password', async () => {
    await assert.rejects(() => hashPassword(''), /password is required/i);
  });
});
