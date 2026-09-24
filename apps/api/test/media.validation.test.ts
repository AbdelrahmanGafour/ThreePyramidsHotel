import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_ALT_TEXT_LENGTH,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_HEIGHT,
  MAX_OUTPUT_WIDTH,
  MAX_ROOM_TYPE_IMAGES,
  MAX_SOURCE_BYTES,
  MEDIA_ORDER_DIRECTIONS,
  SOURCE_CONTENT_TYPES,
  STORED_CONTENT_TYPE,
  WEBP_QUALITY,
  type SourceContentType,
  type StoredContentType,
} from '../src/modules/media/media.types';
import {
  InvalidMediaReferenceError,
  checkRoomTypeImageCount,
  checkSourceByteSize,
  checkSourceUpload,
  createMediaReference,
  isSourceContentType,
  mediaStorageKey,
  normalizeAltText,
  parseMediaOrderDirection,
  parseMediaReference,
  sniffSourceContentType,
} from '../src/modules/media/media.validation';

// The media domain's pure rules, proven offline. No DATABASE_URL, no R2
// variable, no network, no PostgreSQL, no Sharp: this module reaches none of
// them, and a test that needed one would mean it had started to.
//
// These are the rules the upload endpoint will be built on, so each is proven
// at its boundary rather than somewhere comfortably inside it.

/** A minimal body that sniffs as each accepted type. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
]);

const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'binary');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');

/** A canonical reference, as `crypto.randomUUID()` writes one. */
const CANONICAL = '550e8400-e29b-41d4-a716-446655440000';

describe('source content types', () => {
  it('accepts exactly three types and nothing else', () => {
    assert.deepEqual([...SOURCE_CONTENT_TYPES], ['image/jpeg', 'image/png', 'image/webp']);

    for (const type of SOURCE_CONTENT_TYPES) {
      assert.equal(isSourceContentType(type), true);
    }

    for (const type of ['image/svg+xml', 'image/gif', 'image/avif', 'image/tiff', 'application/octet-stream']) {
      assert.equal(isSourceContentType(type), false, `${type} was accepted`);
    }
  });

  it('matches a declared type exactly, without repairing it', () => {
    // Casing and parameters are refused rather than normalized: the only
    // client sends a browser File.type, which is neither.
    for (const type of ['IMAGE/JPEG', 'image/jpeg; charset=utf-8', ' image/jpeg', 'image/jpeg ']) {
      assert.equal(isSourceContentType(type), false, `${type} was accepted`);
    }
  });

  it('keeps the stored content type distinct from a source content type', () => {
    // The brand is load-bearing. Two of the three source types already fail to
    // assign here; this proves the third — a WebP upload — does too, because
    // the stored object is re-encoded and is never the bytes that arrived. If
    // this ever stops being a compile error, the two concepts have collapsed.
    const asStored = (value: SourceContentType): StoredContentType =>
      // @ts-expect-error a source content type is not the normalized stored object
      value;

    assert.equal(asStored('image/webp'), STORED_CONTENT_TYPE);
  });
});

describe('magic-byte sniffing', () => {
  it('detects a JPEG signature', () => {
    assert.equal(sniffSourceContentType(JPEG), 'image/jpeg');
  });

  it('detects a PNG signature', () => {
    assert.equal(sniffSourceContentType(PNG), 'image/png');
  });

  it('detects a WebP signature', () => {
    assert.equal(sniffSourceContentType(WEBP), 'image/webp');
  });

  it('rejects truncated signatures', () => {
    for (const bytes of [
      Buffer.alloc(0),
      JPEG.subarray(0, 2),
      PNG.subarray(0, 7),
      WEBP.subarray(0, 11),
      // RIFF with nothing after it, and RIFF whose form is not WEBP.
      Buffer.from('RIFF', 'ascii'),
      Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE', 'ascii')]),
    ]) {
      assert.equal(sniffSourceContentType(bytes), null, `${bytes.toString('hex')} was accepted`);
    }
  });

  it('rejects GIF', () => {
    assert.equal(sniffSourceContentType(GIF), null);
  });

  it('rejects SVG and other text', () => {
    assert.equal(sniffSourceContentType(SVG), null);
    assert.equal(sniffSourceContentType(Buffer.from('<!doctype html><html></html>', 'utf8')), null);
    assert.equal(sniffSourceContentType(Buffer.from('not an image at all', 'utf8')), null);
  });

  it('rejects arbitrary bytes', () => {
    for (const first of [0x00, 0x1f, 0x42, 0x7f, 0xfe]) {
      const bytes = Buffer.alloc(32, first);

      assert.equal(sniffSourceContentType(bytes), null, `0x${first.toString(16)} was accepted`);
    }
  });

  it('is a pre-filter, not a decoder', () => {
    // A signature followed by nothing usable still sniffs. That is the whole
    // point of documenting Sharp as the authority: this says "worth trying",
    // never "valid image".
    assert.equal(sniffSourceContentType(Buffer.from([0xff, 0xd8, 0xff])), 'image/jpeg');
  });
});

describe('declared type against bytes', () => {
  it('accepts a matching JPEG', () => {
    assert.deepEqual(checkSourceUpload('image/jpeg', JPEG), {
      ok: true,
      sourceContentType: 'image/jpeg',
      byteSize: JPEG.length,
    });
  });

  it('accepts a matching PNG', () => {
    assert.deepEqual(checkSourceUpload('image/png', PNG), {
      ok: true,
      sourceContentType: 'image/png',
      byteSize: PNG.length,
    });
  });

  it('accepts a matching WebP', () => {
    assert.deepEqual(checkSourceUpload('image/webp', WEBP), {
      ok: true,
      sourceContentType: 'image/webp',
      byteSize: WEBP.length,
    });
  });

  it('rejects a JPEG declaration carrying PNG bytes', () => {
    assert.deepEqual(checkSourceUpload('image/jpeg', PNG), { ok: false, reason: 'content-type-mismatch' });
  });

  it('rejects a PNG declaration carrying WebP bytes', () => {
    assert.deepEqual(checkSourceUpload('image/png', WEBP), { ok: false, reason: 'content-type-mismatch' });
  });

  it('rejects a WebP declaration carrying JPEG bytes', () => {
    assert.deepEqual(checkSourceUpload('image/webp', JPEG), { ok: false, reason: 'content-type-mismatch' });
  });

  it('never repairs a mismatch into the sniffed type', () => {
    const result = checkSourceUpload('image/jpeg', PNG);

    assert.equal(result.ok, false);
    assert.equal('sourceContentType' in result, false, 'a rejection must not hand back a usable type');
  });

  it('rejects an unsupported declared type whatever the body carries', () => {
    for (const bytes of [JPEG, PNG, WEBP, GIF, SVG]) {
      assert.deepEqual(checkSourceUpload('image/svg+xml', bytes), {
        ok: false,
        reason: 'unsupported-content-type',
      });
    }

    assert.deepEqual(checkSourceUpload('image/gif', GIF), { ok: false, reason: 'unsupported-content-type' });
  });

  it('rejects a missing declared type', () => {
    for (const declared of [undefined, null, '']) {
      assert.deepEqual(checkSourceUpload(declared, JPEG), { ok: false, reason: 'missing-content-type' });
    }
  });

  it('rejects a declared type that is not a string', () => {
    for (const declared of [1, true, {}, [], ['image/jpeg']]) {
      assert.deepEqual(checkSourceUpload(declared, JPEG), { ok: false, reason: 'unsupported-content-type' });
    }
  });

  it('rejects an accepted declaration whose body sniffs as nothing', () => {
    assert.deepEqual(checkSourceUpload('image/png', SVG), { ok: false, reason: 'unreadable-signature' });
    assert.deepEqual(checkSourceUpload('image/jpeg', Buffer.from('nope', 'utf8')), {
      ok: false,
      reason: 'unreadable-signature',
    });
  });

  it('settles the declaration before it looks at the body', () => {
    // An SVG declaration is refused for what it claims, so an oversized or
    // unreadable body never has to be considered at all.
    assert.deepEqual(checkSourceUpload('image/svg+xml', Buffer.alloc(0)), {
      ok: false,
      reason: 'unsupported-content-type',
    });
  });
});

describe('source byte size', () => {
  it('rejects an empty body', () => {
    assert.deepEqual(checkSourceByteSize(0), { ok: false, reason: 'empty-body' });
    assert.deepEqual(checkSourceUpload('image/jpeg', Buffer.alloc(0)), { ok: false, reason: 'empty-body' });
  });

  it('accepts one byte at the size rule', () => {
    // Valid as a size, and nothing more — one byte sniffs as nothing, which is
    // a different rule and a different rejection.
    assert.deepEqual(checkSourceByteSize(1), { ok: true });
  });

  it('accepts exactly 8 MiB', () => {
    assert.equal(MAX_SOURCE_BYTES, 8 * 1024 * 1024);
    assert.deepEqual(checkSourceByteSize(MAX_SOURCE_BYTES), { ok: true });
  });

  it('rejects one byte beyond 8 MiB', () => {
    assert.deepEqual(checkSourceByteSize(MAX_SOURCE_BYTES + 1), { ok: false, reason: 'too-large' });
  });

  it('carries a real body at the boundary through the whole check', () => {
    // The one large allocation in this suite. It proves the composite agrees
    // with the size rule at the exact boundary rather than near it.
    const atLimit = Buffer.alloc(MAX_SOURCE_BYTES);
    JPEG.copy(atLimit);

    assert.deepEqual(checkSourceUpload('image/jpeg', atLimit), {
      ok: true,
      sourceContentType: 'image/jpeg',
      byteSize: MAX_SOURCE_BYTES,
    });
  });

  it('rejects a count that is not a whole non-negative number', () => {
    for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
      assert.deepEqual(checkSourceByteSize(size), { ok: false, reason: 'not-a-byte-count' }, `${size} passed`);
    }
  });
});

describe('media references', () => {
  it('generates a canonical lowercase UUID', () => {
    const reference = createMediaReference();

    assert.match(reference, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(reference, reference.toLowerCase());
    assert.equal(reference.length, 36);
    assert.equal(parseMediaReference(reference), reference, 'what it generates, it must accept');
  });

  it('does not repeat itself', () => {
    const sample = new Set<string>();

    for (let index = 0; index < 1000; index += 1) {
      sample.add(createMediaReference());
    }

    assert.equal(sample.size, 1000);
  });

  it('accepts a canonical reference', () => {
    assert.equal(parseMediaReference(CANONICAL), CANONICAL);
  });

  it('rejects an upper-case reference', () => {
    assert.equal(parseMediaReference(CANONICAL.toUpperCase()), null);
    assert.equal(parseMediaReference('550E8400-e29b-41d4-a716-446655440000'), null);
  });

  it('rejects surrounding whitespace', () => {
    for (const value of [` ${CANONICAL}`, `${CANONICAL} `, ` ${CANONICAL} `, `\n${CANONICAL}`, `${CANONICAL}\t`]) {
      assert.equal(parseMediaReference(value), null, `${JSON.stringify(value)} was accepted`);
    }
  });

  it('rejects braces', () => {
    assert.equal(parseMediaReference(`{${CANONICAL}}`), null);
  });

  it('rejects the URN form', () => {
    assert.equal(parseMediaReference(`urn:uuid:${CANONICAL}`), null);
  });

  it('rejects a malformed UUID', () => {
    for (const value of [
      '',
      'not-a-uuid',
      CANONICAL.replace(/-/g, ''),
      CANONICAL.slice(0, 35),
      `${CANONICAL}0`,
      '550e8400-e29b-41d4-a716-44665544000g',
      '550e8400e29b-41d4-a716-446655440000',
      // Right shape, wrong version and variant nibbles: not something
      // crypto.randomUUID() ever produces, so not a reference this issued.
      '550e8400-e29b-11d4-a716-446655440000',
      '550e8400-e29b-41d4-c716-446655440000',
    ]) {
      assert.equal(parseMediaReference(value), null, `${JSON.stringify(value)} was accepted`);
    }
  });

  it('rejects anything that is not a string', () => {
    for (const value of [null, undefined, 1, true, {}, [CANONICAL]]) {
      assert.equal(parseMediaReference(value), null);
    }
  });
});

describe('storage keys', () => {
  it('builds media/<reference>.webp and nothing else', () => {
    const reference = parseMediaReference(CANONICAL);
    assert.ok(reference);

    assert.equal(mediaStorageKey(reference), 'media/550e8400-e29b-41d4-a716-446655440000.webp');
  });

  it('always ends in .webp, because the stored object always is', () => {
    const reference = createMediaReference();

    assert.equal(mediaStorageKey(reference), `media/${reference}.webp`);
    assert.equal(STORED_CONTENT_TYPE, 'image/webp');
  });

  it('admits no input but the reference, by construction', () => {
    // One parameter, so there is nowhere for a filename, a slug, a room-type
    // id or a header to be threaded in without that being a visible change.
    assert.equal(mediaStorageKey.length, 1);

    const reference = createMediaReference();

    // And the result's alphabet leaves no room for one: lowercase hex and
    // hyphens between a fixed prefix and a fixed extension.
    assert.match(mediaStorageKey(reference), /^media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/);
  });

  it('refuses to build a key from a value that is not a reference', () => {
    for (const value of [CANONICAL.toUpperCase(), ` ${CANONICAL} `, `{${CANONICAL}}`, 'not-a-uuid', '']) {
      assert.throws(
        // @ts-expect-error only a generated or parsed reference may build a key
        () => mediaStorageKey(value),
        InvalidMediaReferenceError,
        `${JSON.stringify(value)} produced a key`,
      );
    }
  });
});

describe('alt text', () => {
  it('keeps null as null', () => {
    assert.deepEqual(normalizeAltText(null), { ok: true, value: null });
  });

  it('turns an empty string into null', () => {
    assert.deepEqual(normalizeAltText(''), { ok: true, value: null });
  });

  it('turns whitespace into null', () => {
    for (const value of ['   ', '\t', '\n', ' \t\n ', ' ']) {
      assert.deepEqual(normalizeAltText(value), { ok: true, value: null }, `${JSON.stringify(value)} survived`);
    }
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(normalizeAltText('  A terrace at dusk.  '), { ok: true, value: 'A terrace at dusk.' });
  });

  it('preserves internal text exactly', () => {
    const value = 'A  terrace,\tat dusk — with the  Giza plateau beyond.';

    assert.deepEqual(normalizeAltText(`  ${value}  `), { ok: true, value });
  });

  it('does not lowercase, collapse spaces or escape HTML', () => {
    const value = 'Suite 4 & the "West" Terrace <at dusk>';

    assert.deepEqual(normalizeAltText(value), { ok: true, value });
  });

  it('accepts 240 characters after trimming', () => {
    const value = 'a'.repeat(MAX_ALT_TEXT_LENGTH);

    assert.equal(MAX_ALT_TEXT_LENGTH, 240);
    assert.deepEqual(normalizeAltText(value), { ok: true, value });
    assert.deepEqual(normalizeAltText(`  ${value}  `), { ok: true, value }, 'trailing spaces must not count');
  });

  it('rejects 241 characters', () => {
    assert.deepEqual(normalizeAltText('a'.repeat(MAX_ALT_TEXT_LENGTH + 1)), { ok: false, reason: 'too-long' });
  });

  it('rejects anything that is not a string or null', () => {
    for (const value of [1, 0, true, false, {}, [], ['text'], new Date()]) {
      assert.deepEqual(normalizeAltText(value), { ok: false, reason: 'not-text' }, `${String(value)} was accepted`);
    }
  });

  it('rejects undefined rather than reading it as null', () => {
    // An omitted field means "leave this alone" and an explicit null means
    // "clear it". Folding the first into the second would erase a description
    // because a key was missing from the body.
    assert.deepEqual(normalizeAltText(undefined), { ok: false, reason: 'not-text' });
  });
});

describe('order direction', () => {
  it('accepts up', () => {
    assert.equal(parseMediaOrderDirection('up'), 'up');
  });

  it('accepts down', () => {
    assert.equal(parseMediaOrderDirection('down'), 'down');
  });

  it('is exactly those two', () => {
    assert.deepEqual([...MEDIA_ORDER_DIRECTIONS], ['up', 'down']);
  });

  it('rejects everything else', () => {
    for (const value of [
      'UP',
      'Down',
      'DOWN',
      ' up',
      'up ',
      ' up ',
      '\nup',
      'left',
      'right',
      'first',
      '',
      '0',
      0,
      1,
      -1,
      null,
      undefined,
      true,
      ['up'],
      { direction: 'up' },
    ]) {
      assert.equal(parseMediaOrderDirection(value), null, `${JSON.stringify(value)} was accepted`);
    }
  });
});

describe('room-type image count', () => {
  it('allows an upload when there are none', () => {
    assert.deepEqual(checkRoomTypeImageCount(0), { ok: true, remaining: 12 });
  });

  it('allows an upload at eleven', () => {
    assert.deepEqual(checkRoomTypeImageCount(11), { ok: true, remaining: 1 });
  });

  it('refuses at twelve', () => {
    assert.equal(MAX_ROOM_TYPE_IMAGES, 12);
    assert.deepEqual(checkRoomTypeImageCount(12), { ok: false, reason: 'limit-reached' });
  });

  it('refuses beyond twelve', () => {
    for (const count of [13, 40, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(checkRoomTypeImageCount(count), { ok: false, reason: 'limit-reached' });
    }
  });

  it('refuses a count that is not a whole non-negative number', () => {
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined, {}, []]) {
      assert.deepEqual(
        checkRoomTypeImageCount(count),
        { ok: false, reason: 'not-a-count' },
        `${String(count)} was read as a count`,
      );
    }
  });

  it('is the business rule only, not concurrency protection', () => {
    // Two callers each reading eleven are each told yes. The repository has to
    // count and insert under one lock; this helper does not discharge that.
    assert.deepEqual(checkRoomTypeImageCount(11), { ok: true, remaining: 1 });
    assert.deepEqual(checkRoomTypeImageCount(11), { ok: true, remaining: 1 });
  });
});

describe('locked constants', () => {
  it('fixes the stored content type at image/webp', () => {
    assert.equal(STORED_CONTENT_TYPE, 'image/webp');
  });

  it('carries the architecture-locked processing numbers', () => {
    assert.equal(MAX_INPUT_PIXELS, 60_000_000);
    assert.equal(MAX_OUTPUT_WIDTH, 2560);
    assert.equal(MAX_OUTPUT_HEIGHT, 2560);
    assert.equal(WEBP_QUALITY, 85);
  });

  it('carries the architecture-locked upload numbers', () => {
    assert.equal(MAX_SOURCE_BYTES, 8_388_608);
    assert.equal(MAX_ROOM_TYPE_IMAGES, 12);
    assert.equal(MAX_ALT_TEXT_LENGTH, 240);
  });

  it('matches the alt-text ceiling the database enforces', () => {
    // room_type_images_alt_text_check is length(alt_text) <= 240. JavaScript
    // counts UTF-16 units and PostgreSQL counts characters, so this limit is
    // the stricter of the two and nothing accepted here can be refused there.
    assert.equal(MAX_ALT_TEXT_LENGTH, 240);
  });
});
