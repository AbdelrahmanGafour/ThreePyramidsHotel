import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createLocalMediaStorage } from '../src/modules/media/media.storage';

test('local storage writes, deletes idempotently, and refuses escaping keys', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'media-'));
  try {
    const storage = createLocalMediaStorage(dir);
    const key = 'media/11111111-1111-4111-8111-111111111111.webp';
    await storage.putObject({ key, body: Buffer.from('abc'), contentType: 'image/webp' as never });
    assert.equal((await readFile(path.join(dir, key))).toString(), 'abc');
    await storage.deleteObject(key);
    await assert.rejects(access(path.join(dir, key)));
    await storage.deleteObject(key);
    await assert.rejects(
      storage.putObject({ key: '../evil.webp', body: Buffer.from('x'), contentType: 'image/webp' as never }),
      { name: 'MediaStorageError' },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
