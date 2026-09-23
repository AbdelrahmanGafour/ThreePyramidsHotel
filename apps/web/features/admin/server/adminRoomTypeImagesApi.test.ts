import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

// The real server-only module is imported, not a shadow copy — see the note
// in adminRoomsApi.test.ts about the `react-server` export condition. `fetch`
// is replaced per test; no network, no API, no database, and no R2 variable
// is read anywhere in this file or the module it tests.

type ApiModule = typeof import("./adminRoomTypeImagesApi.js");

let fetchAdminRoomTypeImages: ApiModule["fetchAdminRoomTypeImages"];
let uploadAdminRoomTypeImage: ApiModule["uploadAdminRoomTypeImage"];
let updateAdminRoomTypeImageAltText: ApiModule["updateAdminRoomTypeImageAltText"];
let setAdminRoomTypeImageCover: ApiModule["setAdminRoomTypeImageCover"];
let moveAdminRoomTypeImage: ApiModule["moveAdminRoomTypeImage"];
let deleteAdminRoomTypeImage: ApiModule["deleteAdminRoomTypeImage"];

const BASE = "http://127.0.0.1:4000";
const SLUG = "garden-suite";
const REFERENCE = "550e8400-e29b-41d4-a716-446655440000";
const COOKIE = "tph_admin_session=abc123";

type RecordedCall = { url: string; init: RequestInit };

let calls: RecordedCall[] = [];
let realFetch: typeof globalThis.fetch;

/** A well-formed admin image DTO, as the API returns one. */
const imageBody = (overrides: Record<string, unknown> = {}) => ({
  reference: REFERENCE,
  url: `https://media.example.test/media/${REFERENCE}.webp`,
  contentType: "image/webp",
  byteSize: 184_320,
  width: 2560,
  height: 1707,
  altText: null,
  sortOrder: 0,
  isCover: true,
  createdAt: "2026-09-18T08:30:00.000Z",
  updatedAt: "2026-09-22T09:15:00.000Z",
  ...overrides,
});

const apiError = (code: string, message: string) => ({ error: { code, message } });

function respondWith(status: number, body: unknown): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

function respondWithTransportFailure(): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
}

before(async () => {
  process.env.API_BASE_URL = BASE;

  ({
    fetchAdminRoomTypeImages,
    uploadAdminRoomTypeImage,
    updateAdminRoomTypeImageAltText,
    setAdminRoomTypeImageCover,
    moveAdminRoomTypeImage,
    deleteAdminRoomTypeImage,
  } = await import("./adminRoomTypeImagesApi.js"));

  realFetch = globalThis.fetch;
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchAdminRoomTypeImages", () => {
  it("requests the exact URL with the cookie forwarded and no caching", async () => {
    respondWith(200, { data: { images: [] } });

    await fetchAdminRoomTypeImages(SLUG, COOKIE);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/${SLUG}/images`);
    assert.equal(calls[0]!.init.method, "GET");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, { Cookie: COOKIE });
  });

  it("parses a well-formed 200 field by field", async () => {
    respondWith(200, { data: { images: [imageBody()] } });

    const result = await fetchAdminRoomTypeImages(SLUG, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.length, 1);
    assert.equal(result.state === "ok" && result.data[0]!.reference, REFERENCE);
    assert.equal(result.state === "ok" && result.data[0]!.isCover, true);
  });

  describe("treats a malformed image as unavailable", () => {
    for (const [label, overrides] of [
      ["a wrong content type", { contentType: "image/png" }],
      ["a non-https url", { url: `http://media.example.test/media/${REFERENCE}.webp` }],
      ["a url with embedded credentials", { url: `https://user:pass@media.example.test/media/${REFERENCE}.webp` }],
      ["a numeric byteSize as a string", { byteSize: "184320" }],
      ["a zero width", { width: 0 }],
      ["a negative sortOrder", { sortOrder: -1 }],
      ["a non-canonical timestamp", { createdAt: "2026-09-18" }],
    ] as const) {
      it(label, async () => {
        respondWith(200, { data: { images: [imageBody(overrides)] } });

        assert.equal((await fetchAdminRoomTypeImages(SLUG, COOKIE)).state, "unavailable");
      });
    }
  });

  it("never carries a storageKey, a checksum or an internal id from an unexpected payload into the trusted shape", async () => {
    respondWith(200, {
      data: {
        images: [
          imageBody({
            storageKey: "media/leaked.webp",
            checksumSha256: "a".repeat(64),
            id: "999",
          }),
        ],
      },
    });

    const result = await fetchAdminRoomTypeImages(SLUG, COOKIE);

    assert.equal(result.state, "ok");
    assert.ok(result.state === "ok");
    const image = result.data[0]! as Record<string, unknown>;

    assert.equal("storageKey" in image, false);
    assert.equal("checksumSha256" in image, false);
    assert.equal("id" in image, false);
    assert.deepEqual(Object.keys(image).sort(), [
      "altText",
      "byteSize",
      "contentType",
      "createdAt",
      "height",
      "isCover",
      "reference",
      "sortOrder",
      "updatedAt",
      "url",
      "width",
    ]);
  });

  it("classifies a room-type-not-found 404", async () => {
    respondWith(404, apiError("ROOM_TYPE_NOT_FOUND", "Room type not found"));

    assert.deepEqual(await fetchAdminRoomTypeImages(SLUG, COOKIE), { state: "not-found" });
  });

  it("classifies a delivery-unavailable 503 distinctly from a generic outage", async () => {
    respondWith(503, apiError("MEDIA_DELIVERY_UNAVAILABLE", "Media delivery is temporarily unavailable."));

    assert.deepEqual(await fetchAdminRoomTypeImages(SLUG, COOKIE), { state: "delivery-unavailable" });
  });

  it("classifies the guard's own 401", async () => {
    respondWith(401, apiError("NOT_AUTHENTICATED", "Authentication required"));

    assert.deepEqual(await fetchAdminRoomTypeImages(SLUG, COOKIE), { state: "unauthenticated" });
  });
});

describe("uploadAdminRoomTypeImage", () => {
  const body = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

  it("sends a POST with the exact Buffer bytes and the exact Content-Type", async () => {
    respondWith(201, { data: imageBody() });

    await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.body, body, "the exact Buffer instance, not a copy or a re-encoding");
    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "image/png", Cookie: COOKIE });
  });

  it("never JSON.stringifies, base64-encodes or multipart-wraps the body", async () => {
    respondWith(201, { data: imageBody() });

    await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/jpeg" }, COOKIE);

    const sentBody = calls[0]!.init.body;

    assert.ok(Buffer.isBuffer(sentBody), "the body must remain a raw Buffer");
    assert.notEqual(typeof sentBody, "string", "a string body would mean it was stringified or encoded");
  });

  it("passes an unusual declared type through unchanged", async () => {
    respondWith(415, apiError("UNSUPPORTED_IMAGE_TYPE", "Unsupported image type"));

    await uploadAdminRoomTypeImage(SLUG, { body, contentType: "IMAGE/PNG; charset=utf-8" }, COOKIE);

    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "IMAGE/PNG; charset=utf-8", "must not be lower-cased or stripped");
  });

  it("forwards the cookie", async () => {
    respondWith(201, { data: imageBody() });

    await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal((calls[0]!.init.headers as Record<string, string>).Cookie, COOKIE);
  });

  it("parses a well-formed 201", async () => {
    respondWith(201, { data: imageBody() });

    const result = await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal(result.state, "ok");
    assert.equal(result.state === "ok" && result.data.reference, REFERENCE);
  });

  it("never carries storageKey or checksum on a successful upload", async () => {
    respondWith(201, { data: imageBody({ storageKey: "media/leaked.webp", checksumSha256: "a".repeat(64) }) });

    const result = await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal(result.state, "ok");
    assert.ok(result.state === "ok");
    assert.equal("storageKey" in result.data, false);
    assert.equal("checksumSha256" in result.data, false);
  });

  it("classifies 400 INVALID_ROOM_TYPE_SLUG as invalid-reference, not invalid-image", async () => {
    respondWith(400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage("Not Valid!", { body, contentType: "image/png" }, COOKIE),
      { state: "invalid-reference" },
    );
  });

  it("classifies 400 INVALID_IMAGE_UPLOAD as invalid-image, not invalid-reference", async () => {
    respondWith(400, apiError("INVALID_IMAGE_UPLOAD", "Invalid image upload"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE),
      { state: "invalid-image" },
    );
  });

  it("keeps the two 400 upload outcomes distinct from each other", async () => {
    respondWith(400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"));
    const slugResult = await uploadAdminRoomTypeImage("Not Valid!", { body, contentType: "image/png" }, COOKIE);

    respondWith(400, apiError("INVALID_IMAGE_UPLOAD", "Invalid image upload"));
    const uploadResult = await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.notDeepEqual(slugResult, uploadResult);
    assert.deepEqual(slugResult, { state: "invalid-reference" });
    assert.deepEqual(uploadResult, { state: "invalid-image" });
  });

  it("falls through to unavailable for an unrecognized 400 body", async () => {
    // Same status as both contracted cases above, but a body neither one is
    // contracted to send — some other failure wearing the same number.
    respondWith(400, apiError("SOMETHING_ELSE_ENTIRELY", "Not a contract this client knows"));

    const result = await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal(result.state, "unavailable");
    assert.notEqual(result.state, "invalid-reference");
    assert.notEqual(result.state, "invalid-image");
  });

  it("classifies 413 IMAGE_TOO_LARGE", async () => {
    respondWith(413, apiError("IMAGE_TOO_LARGE", "Image exceeds the maximum upload size"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE),
      { state: "too-large" },
    );
  });

  it("classifies 415 UNSUPPORTED_IMAGE_TYPE", async () => {
    respondWith(415, apiError("UNSUPPORTED_IMAGE_TYPE", "Unsupported image type"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "text/plain" }, COOKIE),
      { state: "unsupported-type" },
    );
  });

  it("classifies 409 ROOM_TYPE_IMAGE_LIMIT_REACHED", async () => {
    respondWith(409, apiError("ROOM_TYPE_IMAGE_LIMIT_REACHED", "Room type has reached its image limit"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE),
      { state: "limit-reached" },
    );
  });

  it("classifies 503 MEDIA_STORAGE_UNAVAILABLE", async () => {
    respondWith(503, apiError("MEDIA_STORAGE_UNAVAILABLE", "Media storage is temporarily unavailable"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE),
      { state: "storage-unavailable" },
    );
  });

  it("classifies 503 MEDIA_DELIVERY_UNAVAILABLE distinctly from storage", async () => {
    respondWith(503, apiError("MEDIA_DELIVERY_UNAVAILABLE", "Media delivery is temporarily unavailable."));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE),
      { state: "delivery-unavailable" },
    );
  });

  it("classifies 503 MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN as its own state, never a generic failure", async () => {
    respondWith(
      503,
      apiError(
        "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
        "The operation outcome could not be confirmed. Refresh the current state before retrying.",
      ),
    );

    const result = await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.deepEqual(result, { state: "outcome-uncertain" });
    assert.notDeepEqual(result, { state: "unavailable", reason: "The hotel API returned 503." });
  });

  it("classifies 500 MEDIA_OPERATION_FAILED", async () => {
    respondWith(500, apiError("MEDIA_OPERATION_FAILED", "The operation could not be completed"));

    assert.deepEqual(
      await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE),
      { state: "operation-failed" },
    );
  });

  it("sends one POST and never retries, including on an uncertain outcome", async () => {
    respondWith(
      503,
      apiError(
        "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
        "The operation outcome could not be confirmed. Refresh the current state before retrying.",
      ),
    );

    await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal(calls.length, 1);
  });

  it("reports a transport failure as unavailable, once, never retried", async () => {
    respondWithTransportFailure();

    const result = await uploadAdminRoomTypeImage(SLUG, { body, contentType: "image/png" }, COOKIE);

    assert.equal(result.state, "unavailable");
    assert.equal(calls.length, 1);
  });
});

describe("updateAdminRoomTypeImageAltText", () => {
  it("sends the exact JSON body", async () => {
    respondWith(204, undefined);

    await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, "A terrace at dusk.", COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/${SLUG}/images/${REFERENCE}/alt-text`);
    assert.equal(calls[0]!.init.method, "PATCH");
    assert.equal(calls[0]!.init.body, JSON.stringify({ altText: "A terrace at dusk." }));
    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json", Cookie: COOKIE });
  });

  it("sends null exactly, for clearing", async () => {
    respondWith(204, undefined);

    await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, null, COOKIE);

    assert.equal(calls[0]!.init.body, JSON.stringify({ altText: null }));
  });

  it("succeeds on 204 without attempting to parse a body", async () => {
    // A body-less 204: json() on this Response would throw if the client
    // called it, since there is no content and no Content-Type header.
    respondWith(204, undefined);

    const result = await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, "x", COOKIE);

    assert.deepEqual(result, { state: "ok" });
  });

  it("classifies the update-body contract, the reference contract, and not-found pairs", async () => {
    respondWith(400, apiError("INVALID_ROOM_TYPE_IMAGE_UPDATE", "Invalid room type image update"));
    assert.deepEqual(
      await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, "a".repeat(241), COOKIE),
      { state: "invalid-update" },
    );

    respondWith(400, apiError("INVALID_ROOM_TYPE_IMAGE_REFERENCE", "Invalid room type image reference"));
    assert.deepEqual(
      await updateAdminRoomTypeImageAltText(SLUG, "not-a-uuid", "x", COOKIE),
      { state: "invalid-image-reference" },
    );

    respondWith(404, apiError("ROOM_TYPE_IMAGE_NOT_FOUND", "Room type image not found"));
    assert.deepEqual(
      await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, "x", COOKIE),
      { state: "image-not-found" },
    );
  });

  it("classifies an uncertain outcome distinctly", async () => {
    respondWith(
      503,
      apiError(
        "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
        "The operation outcome could not be confirmed. Refresh the current state before retrying.",
      ),
    );

    assert.deepEqual(
      await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, "x", COOKIE),
      { state: "outcome-uncertain" },
    );
  });
});

describe("setAdminRoomTypeImageCover", () => {
  it("sends no body and no JSON Content-Type", async () => {
    respondWith(204, undefined);

    await setAdminRoomTypeImageCover(SLUG, REFERENCE, COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/${SLUG}/images/${REFERENCE}/cover`);
    assert.equal(calls[0]!.init.method, "PATCH");
    assert.equal(calls[0]!.init.body, undefined, "the cover route names the action; no field describes it");
    assert.deepEqual(calls[0]!.init.headers, { Cookie: COOKIE }, "no Content-Type: there is no JSON body");
  });

  it("succeeds on 204 without parsing a body", async () => {
    respondWith(204, undefined);

    assert.deepEqual(await setAdminRoomTypeImageCover(SLUG, REFERENCE, COOKIE), { state: "ok" });
  });

  it("classifies the reference contract and the not-found pair", async () => {
    respondWith(400, apiError("INVALID_ROOM_TYPE_IMAGE_REFERENCE", "Invalid room type image reference"));
    assert.deepEqual(await setAdminRoomTypeImageCover(SLUG, "{bad}", COOKIE), { state: "invalid-image-reference" });

    respondWith(404, apiError("ROOM_TYPE_IMAGE_NOT_FOUND", "Room type image not found"));
    assert.deepEqual(await setAdminRoomTypeImageCover(SLUG, REFERENCE, COOKIE), { state: "image-not-found" });
  });
});

describe("moveAdminRoomTypeImage", () => {
  it("sends the exact direction JSON, untrimmed", async () => {
    respondWith(204, undefined);

    await moveAdminRoomTypeImage(SLUG, REFERENCE, "up", COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/${SLUG}/images/${REFERENCE}/order`);
    assert.equal(calls[0]!.init.body, JSON.stringify({ direction: "up" }));
  });

  it("passes a value straight through even if it were not the exact expected form", async () => {
    // Bypassing the type on purpose: the client's own job is to forward
    // whatever it is given, letting the API's own rule decide, not to trim or
    // re-case it first.
    respondWith(400, apiError("INVALID_ROOM_TYPE_IMAGE_UPDATE", "Invalid room type image update"));

    await moveAdminRoomTypeImage(SLUG, REFERENCE, " up" as never, COOKIE);

    assert.equal(calls[0]!.init.body, JSON.stringify({ direction: " up" }), "must not be trimmed before sending");
  });

  it("succeeds on 204, covering both a real move and a boundary no-op identically", async () => {
    respondWith(204, undefined);

    assert.deepEqual(await moveAdminRoomTypeImage(SLUG, REFERENCE, "down", COOKIE), { state: "ok" });
  });

  it("classifies the direction contract, the reference contract, and not-found", async () => {
    respondWith(400, apiError("INVALID_ROOM_TYPE_IMAGE_UPDATE", "Invalid room type image update"));
    assert.deepEqual(
      await moveAdminRoomTypeImage(SLUG, REFERENCE, "sideways" as never, COOKIE),
      { state: "invalid-direction" },
    );

    respondWith(404, apiError("ROOM_TYPE_IMAGE_NOT_FOUND", "Room type image not found"));
    assert.deepEqual(await moveAdminRoomTypeImage(SLUG, REFERENCE, "up", COOKIE), { state: "image-not-found" });
  });
});

describe("deleteAdminRoomTypeImage", () => {
  it("sends no body", async () => {
    respondWith(204, undefined);

    await deleteAdminRoomTypeImage(SLUG, REFERENCE, COOKIE);

    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/room-types/${SLUG}/images/${REFERENCE}`);
    assert.equal(calls[0]!.init.method, "DELETE");
    assert.equal(calls[0]!.init.body, undefined);
  });

  it("succeeds on 204 without parsing a body — even a failed R2 cleanup is still ok", async () => {
    // The API answers this identically whether or not the storage object was
    // actually removed afterward; this client has no orphan-cleanup state to
    // invent and does not attempt to.
    respondWith(204, undefined);

    assert.deepEqual(await deleteAdminRoomTypeImage(SLUG, REFERENCE, COOKIE), { state: "ok" });
  });

  it("preserves an uncertain outcome distinctly from ok or a generic failure", async () => {
    respondWith(
      503,
      apiError(
        "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
        "The operation outcome could not be confirmed. Refresh the current state before retrying.",
      ),
    );

    const result = await deleteAdminRoomTypeImage(SLUG, REFERENCE, COOKIE);

    assert.deepEqual(result, { state: "outcome-uncertain" });
    assert.notDeepEqual(result, { state: "ok" });
  });

  it("maps a foreign image and an unknown image to the identical result", async () => {
    respondWith(404, apiError("ROOM_TYPE_IMAGE_NOT_FOUND", "Room type image not found"));
    const foreign = await deleteAdminRoomTypeImage(SLUG, REFERENCE, COOKIE);

    respondWith(404, apiError("ROOM_TYPE_IMAGE_NOT_FOUND", "Room type image not found"));
    const unknown = await deleteAdminRoomTypeImage(SLUG, "00000000-0000-4000-8000-000000000000", COOKIE);

    assert.deepEqual(foreign, unknown);
    assert.deepEqual(foreign, { state: "image-not-found" });
  });

  it("classifies the slug and reference route contracts", async () => {
    respondWith(400, apiError("INVALID_ROOM_TYPE_SLUG", "Invalid room type slug"));
    assert.deepEqual(await deleteAdminRoomTypeImage("Not Valid!", REFERENCE, COOKIE), { state: "invalid-reference" });

    respondWith(400, apiError("INVALID_ROOM_TYPE_IMAGE_REFERENCE", "Invalid room type image reference"));
    assert.deepEqual(await deleteAdminRoomTypeImage(SLUG, "nope", COOKIE), { state: "invalid-image-reference" });
  });
});

describe("safety", () => {
  it("reports a network failure as unavailable for every operation, never throwing", async () => {
    respondWithTransportFailure();
    assert.equal((await fetchAdminRoomTypeImages(SLUG, COOKIE)).state, "unavailable");

    respondWithTransportFailure();
    assert.equal(
      (await updateAdminRoomTypeImageAltText(SLUG, REFERENCE, "x", COOKIE)).state,
      "unavailable",
    );

    respondWithTransportFailure();
    assert.equal((await setAdminRoomTypeImageCover(SLUG, REFERENCE, COOKIE)).state, "unavailable");

    respondWithTransportFailure();
    assert.equal((await moveAdminRoomTypeImage(SLUG, REFERENCE, "up", COOKIE)).state, "unavailable");

    respondWithTransportFailure();
    assert.equal((await deleteAdminRoomTypeImage(SLUG, REFERENCE, COOKIE)).state, "unavailable");
  });

  it("reports a misconfigured API base as unavailable before any fetch is attempted", async () => {
    const before = process.env.API_BASE_URL;
    const previousNodeEnv = process.env.NODE_ENV;

    process.env.API_BASE_URL = "";
    // @ts-expect-error test-only override of a readonly-typed env var
    process.env.NODE_ENV = "production";

    let fetchCalled = false;
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalled = true;

      return realFetch(...(args as Parameters<typeof fetch>));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await fetchAdminRoomTypeImages(SLUG, COOKIE);

      assert.equal(result.state, "unavailable");
      assert.equal(fetchCalled, false, "a configuration fault must be caught before fetch runs");
    } finally {
      process.env.API_BASE_URL = before;
      // @ts-expect-error restoring the test-only override
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("never fetches an image's own url", async () => {
    let fetchedUrls: string[] = [];

    respondWith(200, { data: { images: [imageBody()] } });
    await fetchAdminRoomTypeImages(SLUG, COOKIE);
    fetchedUrls = calls.map((call) => call.url);

    // The only URL this client ever requests is the API's own admin path —
    // never the public media URL carried inside the DTO it just parsed.
    assert.ok(fetchedUrls.every((url) => url.startsWith(`${BASE}/api/v1/admin/`)));
    assert.equal(
      fetchedUrls.some((url) => url.includes("media.example.test")),
      false,
    );
  });

  it("performs exactly one fetch per operation call, with no retry", async () => {
    respondWith(200, { data: { images: [] } });
    await fetchAdminRoomTypeImages(SLUG, COOKIE);
    assert.equal(calls.length, 1);
  });
});
