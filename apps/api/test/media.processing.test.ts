import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, describe, it } from 'node:test';
import sharp from 'sharp';
import {
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_HEIGHT,
  MAX_OUTPUT_WIDTH,
  STORED_CONTENT_TYPE,
  WEBP_QUALITY,
  type ImageProcessingOptions,
} from '../src/modules/media/media.types';
import {
  DEFAULT_IMAGE_PROCESSING_OPTIONS,
  isSinglePage,
  normalizeImage,
  resizeOptions,
  scanPngContainer,
  sharpInputOptions,
  webpOptions,
} from '../src/modules/media/media.processing';

/**
 * PNG's CRC-32, written out here so the suite can build chunks a real decoder
 * still accepts. Seven lines and no dependency; the production scanner never
 * computes one, because verifying chunk integrity is libpng's job.
 */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** One well-formed PNG chunk: length, type, data, CRC. */
function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);

  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');

  const crc = Buffer.alloc(4);

  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);

  return Buffer.concat([header, data, crc]);
}

/** Where IHDR ends: the 8-byte signature plus a 13-byte chunk with its frame. */
const AFTER_IHDR = 8 + 8 + 13 + 4;

/** Splices a chunk in at the first legal boundary after IHDR. */
function withChunkAfterIhdr(png: Buffer, type: string, data: Buffer): Buffer {
  assert.equal(png.toString('latin1', 12, 16), 'IHDR', 'the fixture is not laid out as expected');
  assert.equal(png.readUInt32BE(8), 13, 'IHDR is not 13 bytes');

  return Buffer.concat([png.subarray(0, AFTER_IHDR), pngChunk(type, data), png.subarray(AFTER_IHDR)]);
}

/** An APNG animation-control chunk: two frames, looping forever. */
const ACTL_DATA = Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]);

// The real decoder, proven against real images — all of them built in memory
// by sharp itself, so nothing binary is committed and no fixture dependency
// exists.
//
// Offline throughout: no DATABASE_URL, no R2 variable, no network, no
// PostgreSQL, no filesystem write. The only thing on disk that this touches is
// the sharp module itself.

/** Builds a solid-colour source image of a given size in a given format. */
async function source(
  format: 'jpeg' | 'png' | 'webp',
  width: number,
  height: number,
  background: sharp.Color = '#1d4ed8',
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })[format]().toBuffer();
}

/** A PNG whose alpha channel is genuinely partial, not fully opaque. */
async function transparentPng(width = 30, height = 30): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.25 } },
  })
    .png()
    .toBuffer();
}

/**
 * A genuinely animated WebP, assembled without a committed fixture.
 *
 * sharp cannot synthesize a multi-frame image from `create`, so the frames
 * come from a hand-written 85-byte two-frame GIF — the smallest real animated
 * container there is — which sharp then re-encodes as an animated WebP. The
 * result carries real ANIM/ANMF chunks, and `metadata().pages` reports 2, so
 * the rejection path below is exercised against the real thing rather than
 * against a stand-in.
 */
async function animatedWebp(): Promise<Buffer> {
  const hex = (value: string) => Buffer.from(value.replace(/\s/g, ''), 'hex');

  const gif = Buffer.concat([
    hex('47 49 46 38 39 61'), // "GIF89a"
    hex('0100 0100'), // logical screen: 1x1
    hex('80'), // a global colour table of two entries follows
    hex('00 00'), // background colour index, pixel aspect ratio
    hex('FF0000 0000FF'), // the two colours
    hex('21 FF 0B'), // application extension
    Buffer.from('NETSCAPE2.0', 'ascii'),
    hex('03 01 0000 00'), // loop forever
    hex('21 F9 04 00 0A00 00 00'), // frame 1: graphic control, 100ms
    hex('2C 0000 0000 0100 0100 00'), // frame 1: image descriptor
    hex('02 02 4401 00'), // frame 1: LZW, colour index 0
    hex('21 F9 04 00 0A00 00 00'), // frame 2: graphic control, 100ms
    hex('2C 0000 0000 0100 0100 00'), // frame 2: image descriptor
    hex('02 02 4C01 00'), // frame 2: LZW, colour index 1
    hex('3B'), // trailer
  ]);

  return sharp(gif, { animated: true }).webp().toBuffer();
}

/** A JPEG carrying EXIF orientation 6 — "rotate 90° clockwise to view". */
async function orientedJpeg(width: number, height: number): Promise<Buffer> {
  // withMetadata is used here, in a test, to *create* the condition the
  // processor must resolve. The processor itself never calls it.
  return sharp(await source('jpeg', width, height))
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** Reads back what a normalized body actually is, according to sharp. */
async function storedMetadata(body: Buffer) {
  return sharp(body).metadata();
}

function withOptions(overrides: Partial<ImageProcessingOptions>): ImageProcessingOptions {
  return { ...DEFAULT_IMAGE_PROCESSING_OPTIONS, ...overrides };
}

/** Unwraps a success, failing the test with the reason when there is not one. */
function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result)}`);

  return result as Extract<T, { ok: true }>;
}

describe('normalizing a valid image', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    it(`normalizes a ${format.toUpperCase()} source`, async () => {
      const result = await normalizeImage(await source(format, 40, 20), `image/${format}`);
      const { normalized } = expectOk(result);

      assert.equal(normalized.width, 40);
      assert.equal(normalized.height, 20);
      assert.ok(normalized.byteSize > 0);
    });
  }

  it('always produces the stored content type', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const { normalized } = expectOk(await normalizeImage(await source(format, 24, 24), `image/${format}`));

      assert.equal(normalized.contentType, STORED_CONTENT_TYPE);
      assert.equal(normalized.contentType, 'image/webp');
    }
  });

  it('produces bytes that really decode as WebP', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('png', 32, 18), 'image/png'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 32);
    assert.equal(metadata.height, 18);
  });

  it('reports byteSize as the length of the bytes it returns', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('jpeg', 50, 30), 'image/jpeg'));

    assert.equal(normalized.byteSize, normalized.body.length);
  });

  it('reports the width and height the stored WebP actually has', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('png', 61, 37), 'image/png'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(normalized.width, metadata.width);
    assert.equal(normalized.height, metadata.height);
  });
});

describe('the checksum', () => {
  it('is the SHA-256 of the stored bytes, not of the source', async () => {
    const sourceBytes = await source('png', 48, 24);
    const { normalized } = expectOk(await normalizeImage(sourceBytes, 'image/png'));

    assert.equal(normalized.checksumSha256, createHash('sha256').update(normalized.body).digest('hex'));
    assert.notEqual(
      normalized.checksumSha256,
      createHash('sha256').update(sourceBytes).digest('hex'),
      'the digest must describe what is stored, not what arrived',
    );
  });

  it('is 64 lowercase hexadecimal characters', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('webp', 20, 20), 'image/webp'));

    assert.equal(normalized.checksumSha256.length, 64);
    assert.match(normalized.checksumSha256, /^[0-9a-f]{64}$/);
    assert.equal(normalized.checksumSha256, normalized.checksumSha256.toLowerCase());
  });

  it('agrees with byteSize about the same bytes', async () => {
    // Within one call the three must describe one value. Across sharp or
    // libvips versions the bytes may legitimately differ, and nothing here
    // claims otherwise — this is an integrity fact, not reproducibility.
    const { normalized } = expectOk(await normalizeImage(await source('jpeg', 33, 44), 'image/jpeg'));

    assert.equal(normalized.byteSize, normalized.body.length);
    assert.equal(normalized.checksumSha256, createHash('sha256').update(normalized.body).digest('hex'));
  });
});

describe('rejecting what cannot be stored', () => {
  it('rejects a body that is not an image', async () => {
    assert.deepEqual(await normalizeImage(Buffer.from('not an image at all', 'utf8'), 'image/png'), {
      ok: false,
      reason: 'undecodable',
    });
  });

  it('rejects a truncated image', async () => {
    const whole = await source('jpeg', 200, 200);

    assert.deepEqual(await normalizeImage(whole.subarray(0, 60), 'image/jpeg'), {
      ok: false,
      reason: 'undecodable',
    });
  });

  it('rejects an empty body', async () => {
    assert.deepEqual(await normalizeImage(Buffer.alloc(0), 'image/jpeg'), { ok: false, reason: 'undecodable' });
  });

  it('never forwards sharp’s own error text', async () => {
    const result = await normalizeImage(Buffer.from('garbage', 'utf8'), 'image/png');

    assert.equal(result.ok, false);
    // The rejection is one of three domain facts and carries nothing else —
    // no message, no libvips internals, no stack.
    assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason']);
  });

  it('rejects a decoded format that is not the one declared', async () => {
    // T03-C stops this at the signature layer. The decoder must not assume it
    // did: these are genuine PNG bytes arriving labelled as something else.
    const png = await source('png', 30, 30);

    assert.deepEqual(await normalizeImage(png, 'image/jpeg'), { ok: false, reason: 'format-mismatch' });
    assert.deepEqual(await normalizeImage(png, 'image/webp'), { ok: false, reason: 'format-mismatch' });

    const jpeg = await source('jpeg', 30, 30);

    assert.deepEqual(await normalizeImage(jpeg, 'image/png'), { ok: false, reason: 'format-mismatch' });
  });

  it('accepts each format under its own declaration', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const result = await normalizeImage(await source(format, 16, 16), `image/${format}`);

      assert.equal(result.ok, true, `${format} was rejected under its own declaration`);
    }
  });
});

describe('animation and multiple pages', () => {
  let animated: Buffer;

  before(async () => {
    animated = await animatedWebp();
  });

  it('builds a genuinely animated WebP fixture', async () => {
    // Guards the test below: if this ever stops being a real animation, the
    // rejection it proves would start passing for the wrong reason.
    assert.ok(animated.includes(Buffer.from('ANIM', 'ascii')), 'no ANIM chunk');
    assert.ok(animated.includes(Buffer.from('ANMF', 'ascii')), 'no ANMF chunk');
    assert.equal((await storedMetadata(animated)).pages, 2);
  });

  it('rejects an animated WebP rather than storing its first frame', async () => {
    assert.deepEqual(await normalizeImage(animated, 'image/webp'), {
      ok: false,
      reason: 'animated-or-multi-page',
    });
  });

  it('accepts an ordinary single-frame image of the same format', async () => {
    const result = await normalizeImage(await source('webp', 16, 16), 'image/webp');

    assert.equal(result.ok, true);
  });

  describe('the page rule itself', () => {
    it('accepts exactly two values: absent, and one', () => {
      // An ordinary JPEG/PNG/WebP reports undefined; a single-frame GIF
      // reports 1. Those are the only two spellings of "one frame".
      assert.equal(isSinglePage(undefined), true);
      assert.equal(isSinglePage(1), true);
    });

    it('rejects more than one page', () => {
      for (const pages of [2, 3, 12, 600]) {
        assert.equal(isSinglePage(pages), false, `${pages} pages was accepted`);
      }
    });

    it('rejects a page count it cannot explain', () => {
      // None of these is expected from libvips. A count this code cannot
      // account for is not a reason to store an image: refusing an upload is
      // recoverable, storing one frame of something else is not.
      for (const pages of [0, -1, -2, 1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(isSinglePage(pages), false, `${pages} was accepted`);
      }
    });

    it('reads a real single-frame image as one page', async () => {
      const metadata = await storedMetadata(await source('png', 12, 12));

      assert.equal(isSinglePage(metadata.pages), true);
    });
  });
});

describe('the PNG container walk', () => {
  let plain: Buffer;

  before(async () => {
    plain = await source('png', 40, 20);
  });

  it('reads an ordinary PNG as a still image', () => {
    assert.deepEqual(scanPngContainer(plain), { ok: true, animated: false });
  });

  it('finds a structurally reachable acTL chunk', () => {
    assert.deepEqual(scanPngContainer(withChunkAfterIhdr(plain, 'acTL', ACTL_DATA)), {
      ok: true,
      animated: true,
    });
  });

  it('is not fooled by acTL bytes inside another chunk’s data', () => {
    // The four bytes appear in the file, but at no chunk boundary. A
    // substring search would call this an animation and refuse an ordinary
    // photograph; walking the structure steps straight over it.
    const decoy = withChunkAfterIhdr(plain, 'tEXt', Buffer.from('Comment\u0000acTLacTL', 'latin1'));

    assert.ok(decoy.includes(Buffer.from('acTL', 'latin1')), 'the decoy must really contain those bytes');
    assert.deepEqual(scanPngContainer(decoy), { ok: true, animated: false });
  });

  it('still decodes a PNG carrying that decoy chunk', async () => {
    const decoy = withChunkAfterIhdr(plain, 'tEXt', Buffer.from('Comment\u0000acTL', 'latin1'));
    const result = await normalizeImage(decoy, 'image/png');

    assert.equal(result.ok, true, 'a valid PNG with an ancillary chunk must still be storable');
  });

  it('does not throw on a truncated chunk length', () => {
    for (const trailing of [0, 1, 2, 3]) {
      const bytes = Buffer.concat([plain.subarray(0, 8), Buffer.alloc(trailing)]);

      assert.deepEqual(scanPngContainer(bytes), { ok: false, reason: 'malformed' }, `${trailing} trailing bytes`);
    }
  });

  it('does not throw on a truncated chunk type', () => {
    for (const typeBytes of [1, 2, 3]) {
      const bytes = plain.subarray(0, 8 + 4 + typeBytes);

      assert.deepEqual(scanPngContainer(bytes), { ok: false, reason: 'malformed' }, `${typeBytes} type bytes`);
    }
  });

  it('does not throw on truncated chunk data or CRC', () => {
    // IHDR declares 13 bytes; each of these stops short of its data or its CRC.
    for (const length of [AFTER_IHDR - 1, AFTER_IHDR - 4, AFTER_IHDR - 10, 8 + 8]) {
      assert.deepEqual(scanPngContainer(plain.subarray(0, length)), { ok: false, reason: 'malformed' }, `${length}`);
    }
  });

  it('rejects an absurd chunk length rather than trusting it', () => {
    const absurd = Buffer.concat([plain.subarray(0, 8), Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(64)]);

    assert.deepEqual(scanPngContainer(absurd), { ok: false, reason: 'malformed' });
  });

  it('rejects a chunk type that is not four letters', () => {
    const bad = Buffer.concat([
      plain.subarray(0, 8),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x00, 0x31, 0x2d, 0xff]),
      Buffer.alloc(4),
    ]);

    assert.deepEqual(scanPngContainer(bad), { ok: false, reason: 'malformed' });
  });

  it('rejects a stream that never reaches IEND', () => {
    const noEnd = plain.subarray(0, plain.length - 12);

    assert.deepEqual(scanPngContainer(noEnd), { ok: false, reason: 'malformed' });
  });

  it('says "not a PNG" rather than "malformed" for other bytes', async () => {
    for (const bytes of [await source('jpeg', 8, 8), Buffer.from('nope', 'utf8'), Buffer.alloc(0)]) {
      assert.deepEqual(scanPngContainer(bytes), { ok: false, reason: 'not-png' });
    }
  });
});

describe('APNG', () => {
  it('is refused rather than stored as its first frame', async () => {
    // libvips does not report APNG through metadata.pages — it decodes the
    // default image and says nothing about the frames — so without the
    // container walk this would be silently stored.
    const apng = withChunkAfterIhdr(await source('png', 40, 20), 'acTL', ACTL_DATA);

    assert.deepEqual(await normalizeImage(apng, 'image/png'), {
      ok: false,
      reason: 'animated-or-multi-page',
    });
  });

  it('is caught by the container walk, not by the page count', async () => {
    // Recorded as a fact about this libvips build: if a future version starts
    // reporting pages for APNG, this assertion is where that will surface.
    const apng = withChunkAfterIhdr(await source('png', 40, 20), 'acTL', ACTL_DATA);

    assert.equal(isSinglePage((await storedMetadata(apng)).pages), true, 'metadata alone would have let it through');
    assert.deepEqual(scanPngContainer(apng), { ok: true, animated: true });
  });

  it('maps a malformed PNG container to undecodable', async () => {
    const broken = Buffer.concat([
      (await source('png', 40, 20)).subarray(0, 8),
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.alloc(32),
    ]);

    assert.deepEqual(await normalizeImage(broken, 'image/png'), { ok: false, reason: 'undecodable' });
  });

  it('leaves the JPEG and WebP paths untouched', async () => {
    // The walk is a PNG-only supplement; nothing about it should reach the
    // other two formats.
    assert.equal((await normalizeImage(await source('jpeg', 16, 16), 'image/jpeg')).ok, true);
    assert.equal((await normalizeImage(await source('webp', 16, 16), 'image/webp')).ok, true);
  });
});

describe('resizing', () => {
  it('scales a large landscape image into the box', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('jpeg', 4000, 2000), 'image/jpeg'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 2560, height: 1280 });
  });

  it('scales a large portrait image into the box', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('jpeg', 2000, 4000), 'image/jpeg'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 1280, height: 2560 });
  });

  it('preserves the aspect ratio within resize rounding', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('png', 3333, 1111), 'image/png'));

    const sourceRatio = 3333 / 1111;
    const storedRatio = normalized.width / normalized.height;

    assert.ok(
      Math.abs(sourceRatio - storedRatio) < 0.01,
      `aspect ratio drifted: ${sourceRatio} -> ${storedRatio}`,
    );
  });

  it('never enlarges a small image', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('png', 1000, 700), 'image/png'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 1000, height: 700 });
  });

  it('never enlarges a tiny image either', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('webp', 4, 2), 'image/webp'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 4, height: 2 });
  });

  it('does not crop', async () => {
    // A cropped 4000x1000 would come back at the box's own ratio. Fitting
    // inside keeps 4:1, which is what proves no crop happened.
    const { normalized } = expectOk(await normalizeImage(await source('jpeg', 4000, 1000), 'image/jpeg'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 2560, height: 640 });
    assert.equal(normalized.width / normalized.height, 4);
  });

  it('never exceeds the locked bounds', async () => {
    for (const [width, height] of [
      [4000, 2000],
      [2000, 4000],
      [4000, 4000],
      [2561, 2561],
      [2560, 2560],
    ] as const) {
      const { normalized } = expectOk(await normalizeImage(await source('png', width, height), 'image/png'));

      assert.ok(normalized.width <= MAX_OUTPUT_WIDTH, `${width}x${height} produced width ${normalized.width}`);
      assert.ok(normalized.height <= MAX_OUTPUT_HEIGHT, `${width}x${height} produced height ${normalized.height}`);
    }
  });
});

describe('orientation', () => {
  it('resolves EXIF orientation into the stored dimensions', async () => {
    // 40x20 tagged "rotate 90° clockwise" is a 20x40 picture, and that is what
    // must be stored.
    const { normalized } = expectOk(await normalizeImage(await orientedJpeg(40, 20), 'image/jpeg'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 20, height: 40 });
  });

  it('orients before resizing, so the box applies to the visible picture', async () => {
    // 4000x2000 tagged orientation 6 is a 2000x4000 picture. Resizing first
    // would give 2560x1280; orienting first gives 1280x2560.
    const { normalized } = expectOk(await normalizeImage(await orientedJpeg(4000, 2000), 'image/jpeg'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 1280, height: 2560 });
  });

  it('does not leave the orientation tag behind', async () => {
    const { normalized } = expectOk(await normalizeImage(await orientedJpeg(40, 20), 'image/jpeg'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(metadata.orientation, undefined, 'the rotation is in the pixels now, not in a tag');
  });

  it('leaves an un-tagged image alone', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('jpeg', 40, 20), 'image/jpeg'));

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 40, height: 20 });
  });
});

describe('metadata stripping', () => {
  it('drops EXIF that was present on the source', async () => {
    const tagged = await sharp(await source('jpeg', 40, 20))
      .withMetadata({ orientation: 3, exif: { IFD0: { Copyright: 'Three Pyramids Boutique Hotel' } } })
      .toBuffer();

    assert.ok((await storedMetadata(tagged)).exif, 'the fixture must actually carry EXIF');

    const { normalized } = expectOk(await normalizeImage(tagged, 'image/jpeg'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
  });

  it('drops the source ICC profile and XMP', async () => {
    const tagged = await sharp(await source('png', 40, 20))
      .withMetadata({ icc: 'p3' })
      .toBuffer();

    const { normalized } = expectOk(await normalizeImage(tagged, 'image/png'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
  });

  it('keeps no trace of a filename, because it never receives one', async () => {
    // The processor's signature has no filename parameter at all, so there is
    // nothing to strip and nowhere for one to be recorded.
    assert.equal(normalizeImage.length, 2, 'source bytes and a declared type, and nothing else');
  });
});

describe('transparency', () => {
  it('keeps alpha through normalization', async () => {
    const png = await transparentPng();

    assert.equal((await storedMetadata(png)).hasAlpha, true, 'the fixture must actually have alpha');

    const { normalized } = expectOk(await normalizeImage(png, 'image/png'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.channels, 4);
  });

  it('does not flatten alpha onto a background', async () => {
    // hasAlpha alone would survive a flatten that left an opaque alpha
    // channel, so the pixel data is read: a quarter-opaque source must stay
    // roughly a quarter opaque, nowhere near 255.
    const { normalized } = expectOk(await normalizeImage(await transparentPng(), 'image/png'));
    const stats = await sharp(normalized.body).stats();
    const alpha = stats.channels[3];

    assert.ok(alpha, 'the stored WebP has no alpha channel');
    assert.ok(alpha.mean < 128, `alpha was flattened: mean ${alpha.mean}`);
    assert.ok(alpha.mean > 0, `alpha was erased: mean ${alpha.mean}`);
  });

  it('leaves an opaque image opaque and valid', async () => {
    const { normalized } = expectOk(await normalizeImage(await source('png', 30, 30), 'image/png'));
    const metadata = await storedMetadata(normalized.body);

    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.hasAlpha, false);
    assert.equal(metadata.channels, 3);
  });

  it('keeps alpha when the image is also resized down', async () => {
    const { normalized } = expectOk(await normalizeImage(await transparentPng(4000, 4000), 'image/png'));
    const metadata = await storedMetadata(normalized.body);

    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 2560, height: 2560 });
    assert.equal(metadata.hasAlpha, true);
  });
});

describe('the processing options are the ones that act', () => {
  it('defaults to the architecture-locked numbers', () => {
    assert.deepEqual(DEFAULT_IMAGE_PROCESSING_OPTIONS, {
      maxInputPixels: MAX_INPUT_PIXELS,
      maxOutputWidth: MAX_OUTPUT_WIDTH,
      maxOutputHeight: MAX_OUTPUT_HEIGHT,
      webpQuality: WEBP_QUALITY,
    });

    assert.equal(MAX_INPUT_PIXELS, 60_000_000);
    assert.equal(WEBP_QUALITY, 85);
  });

  it('wires maxInputPixels to sharp’s input limit', async () => {
    // Proven by shrinking the ceiling rather than by building a 60-megapixel
    // image: an 800-pixel picture is refused when the limit is 100, and
    // accepted when it is not.
    const small = await source('png', 40, 20);

    assert.deepEqual(sharpInputOptions(withOptions({ maxInputPixels: 100 })), {
      limitInputPixels: 100,
      failOn: 'warning',
    });
    assert.deepEqual(await normalizeImage(small, 'image/png', withOptions({ maxInputPixels: 100 })), {
      ok: false,
      reason: 'undecodable',
    });
    assert.equal((await normalizeImage(small, 'image/png', withOptions({ maxInputPixels: 800 }))).ok, true);

    assert.equal(sharpInputOptions(DEFAULT_IMAGE_PROCESSING_OPTIONS).limitInputPixels, MAX_INPUT_PIXELS);
  });

  it('states the strict fail policy rather than inheriting it', () => {
    assert.deepEqual(sharpInputOptions(DEFAULT_IMAGE_PROCESSING_OPTIONS), {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'warning',
    });
  });

  it('behaves like failOn warning, not like a relaxed reader', async () => {
    // A half-truncated PNG is the case that separates the two policies: sharp
    // reading with failOn 'none' produces a picture from it, and reading with
    // 'warning' refuses. If the pipeline ever inherited a relaxed default,
    // this would start returning a half-decoded image instead of a rejection.
    const whole = await source('png', 200, 200);
    const half = whole.subarray(0, Math.floor(whole.length / 2));

    const relaxed = await sharp(half, { failOn: 'none' }).webp().toBuffer();

    assert.ok(relaxed.length > 0, 'the fixture must be one a relaxed reader would accept');
    assert.deepEqual(await normalizeImage(half, 'image/png'), { ok: false, reason: 'undecodable' });
  });

  it('wires webpQuality to the encoder', async () => {
    const detailed = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: '#000000',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();

    const low = expectOk(await normalizeImage(detailed, 'image/png', withOptions({ webpQuality: 10 })));
    const high = expectOk(await normalizeImage(detailed, 'image/png', withOptions({ webpQuality: 95 })));

    assert.ok(
      low.normalized.byteSize < high.normalized.byteSize,
      `quality had no effect: ${low.normalized.byteSize} vs ${high.normalized.byteSize}`,
    );
    assert.deepEqual(webpOptions(DEFAULT_IMAGE_PROCESSING_OPTIONS), { quality: WEBP_QUALITY });
  });

  it('wires the output box to the resize', async () => {
    const { normalized } = expectOk(
      await normalizeImage(
        await source('png', 40, 20),
        'image/png',
        withOptions({ maxOutputWidth: 10, maxOutputHeight: 10 }),
      ),
    );

    assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 10, height: 5 });
  });

  it('resizes inside the box without enlargement and without cropping', () => {
    assert.deepEqual(resizeOptions(DEFAULT_IMAGE_PROCESSING_OPTIONS), {
      width: MAX_OUTPUT_WIDTH,
      height: MAX_OUTPUT_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    });
  });

  it('proves withoutEnlargement by behaviour, not only by the option', async () => {
    // With the same box, a picture below it is returned at its own size while
    // one above it is brought down. Only withoutEnlargement produces both.
    const belowBox = expectOk(
      await normalizeImage(await source('png', 8, 4), 'image/png', withOptions({ maxOutputWidth: 100, maxOutputHeight: 100 })),
    );
    const aboveBox = expectOk(
      await normalizeImage(await source('png', 400, 200), 'image/png', withOptions({ maxOutputWidth: 100, maxOutputHeight: 100 })),
    );

    assert.deepEqual({ width: belowBox.normalized.width, height: belowBox.normalized.height }, { width: 8, height: 4 });
    assert.deepEqual({ width: aboveBox.normalized.width, height: aboveBox.normalized.height }, { width: 100, height: 50 });
  });
});
