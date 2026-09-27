import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";

// What the journey-image client actually puts on the wire.
//
// The load-bearing claims are about the request, not the response: the body
// is the file's own bytes, the `Content-Type` is the file's own type, and
// nothing is wrapped in multipart, base64 or JSON. Everything goes to
// Express; no request is ever made to a storage host from this process, and
// none could be — the URL is always the API's own.

type ApiModule = typeof import("./adminPackageImagesApi.js");

let uploadAdminPackageImage: ApiModule["uploadAdminPackageImage"];
let replaceAdminPackageImage: ApiModule["replaceAdminPackageImage"];
let deleteAdminPackageImage: ApiModule["deleteAdminPackageImage"];
let updateAdminPackageImageAltText: ApiModule["updateAdminPackageImageAltText"];

const SLUG = "nile-dinner-cruise";
const COOKIE = "admin_session=opaque";
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const IMAGE = {
  reference: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  url: "https://media.example.test/media/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.webp",
  altText: "Dawn over the plateau",
  width: 1200,
  height: 800,
};

before(async () => {
  process.env.API_BASE_URL ??= "http://127.0.0.1:4000";
  ({
    uploadAdminPackageImage,
    replaceAdminPackageImage,
    deleteAdminPackageImage,
    updateAdminPackageImageAltText,
  } = await import("./adminPackageImagesApi.js"));
});

type Call = { url: string; init: RequestInit };

/** Replaces global fetch, recording every request and answering with one response. */
function stubFetch(response: { status: number; body?: unknown }): Call[] {
  const calls: Call[] = [];

  mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() {
        if (response.body === undefined) throw new Error("no body");
        return response.body;
      },
    } as unknown as Response;
  });

  return calls;
}

afterEach(() => {
  mock.restoreAll();
});

const errorBody = (code: string, message: string) => ({ error: { code, message } });

describe("journey image upload and replace: what reaches the wire", () => {
  it("POSTs the file's own bytes under the file's own type", async () => {
    const calls = stubFetch({ status: 201, body: { data: IMAGE } });

    const result = await uploadAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);

    assert.deepEqual(result, { state: "ok", image: IMAGE });
    assert.equal(calls.length, 1);

    const [call] = calls;
    assert.equal(call!.init.method, "POST");
    assert.match(call!.url, /\/api\/v1\/admin\/packages\/nile-dinner-cruise\/image$/);

    const headers = call!.init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "image/jpeg");
    assert.equal(headers.Cookie, COOKIE);

    // The bytes themselves, not a wrapper around them.
    assert.ok(Buffer.isBuffer(call!.init.body));
    assert.deepEqual(call!.init.body, BYTES);
  });

  it("PUTs the same way when replacing", async () => {
    const calls = stubFetch({ status: 200, body: { data: IMAGE } });

    await replaceAdminPackageImage(SLUG, { body: BYTES, contentType: "image/png" }, COOKIE);

    const [call] = calls;
    assert.equal(call!.init.method, "PUT");
    assert.equal((call!.init.headers as Record<string, string>)["Content-Type"], "image/png");
    assert.deepEqual(call!.init.body, BYTES);
  });

  it("never sends multipart, base64 or JSON for the image", async () => {
    for (const send of [uploadAdminPackageImage, replaceAdminPackageImage]) {
      const calls = stubFetch({ status: 200, body: { data: IMAGE } });

      await send(SLUG, { body: BYTES, contentType: "image/webp" }, COOKIE);

      const [call] = calls;
      const headers = call!.init.headers as Record<string, string>;

      assert.ok(!/multipart/i.test(headers["Content-Type"] ?? ""));
      assert.ok(!(call!.init.body instanceof FormData), "never FormData");
      assert.equal(typeof call!.init.body, "object", "never a base64 or JSON string");
      assert.equal((headers["Content-Type"] ?? "").startsWith("image/"), true);

      mock.restoreAll();
    }
  });

  it("carries the browser's declared type through exactly, whatever it is", async () => {
    // The API owns what counts as an accepted declaration. Repairing it here
    // would be a local guess disagreeing with the one rule that matters.
    const calls = stubFetch({ status: 415, body: errorBody("UNSUPPORTED_IMAGE_TYPE", "Unsupported image type") });

    const result = await uploadAdminPackageImage(SLUG, { body: BYTES, contentType: "image/gif" }, COOKIE);

    assert.deepEqual(result, { state: "unsupported-type" });
    assert.equal((calls[0]!.init.headers as Record<string, string>)["Content-Type"], "image/gif");
  });

  it("encodes the slug into one path segment", async () => {
    const calls = stubFetch({ status: 201, body: { data: IMAGE } });

    await uploadAdminPackageImage("a/b?c#d", { body: BYTES, contentType: "image/jpeg" }, COOKIE);

    assert.match(calls[0]!.url, /\/packages\/a%2Fb%3Fc%23d\/image$/);
  });

  it("sends no Cookie header when there is no session to forward", async () => {
    const calls = stubFetch({ status: 201, body: { data: IMAGE } });

    await uploadAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" });

    assert.ok(!("Cookie" in (calls[0]!.init.headers as Record<string, string>)));
  });
});

describe("journey image delete and description", () => {
  it("DELETEs with no body at all", async () => {
    const calls = stubFetch({ status: 204 });

    const result = await deleteAdminPackageImage(SLUG, COOKIE);

    assert.deepEqual(result, { state: "ok" });
    assert.equal(calls[0]!.init.method, "DELETE");
    assert.equal(calls[0]!.init.body, undefined);
  });

  it("PATCHes JSON carrying only altText", async () => {
    const calls = stubFetch({ status: 200, body: { data: IMAGE } });

    await updateAdminPackageImageAltText(SLUG, "  Dawn  ", COOKIE);

    const [call] = calls;
    assert.equal(call!.init.method, "PATCH");
    assert.match(call!.url, /\/image\/alt-text$/);
    assert.equal((call!.init.headers as Record<string, string>)["Content-Type"], "application/json");

    // Exactly one key. The text is sent as typed; the API trims it.
    assert.deepEqual(JSON.parse(call!.init.body as string), { altText: "  Dawn  " });
  });

  it("sends an explicit null to clear the description", async () => {
    const calls = stubFetch({ status: 200, body: { data: { ...IMAGE, altText: null } } });

    const result = await updateAdminPackageImageAltText(SLUG, null, COOKIE);

    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { altText: null });
    assert.equal(result.state === "ok" && result.image.altText, null);
  });

  it("reports the stored description, not the one that was sent", async () => {
    // The API trims and normalizes; what comes back is what exists.
    stubFetch({ status: 200, body: { data: { ...IMAGE, altText: "Dawn" } } });

    const result = await updateAdminPackageImageAltText(SLUG, "   Dawn   ", COOKIE);

    assert.equal(result.state === "ok" && result.image.altText, "Dawn");
  });
});

describe("journey image client: every answer the API can give", () => {
  const cases: Array<[number, ReturnType<typeof errorBody>, string]> = [
    [401, errorBody("UNAUTHENTICATED", "x"), "unauthenticated"],
    [400, errorBody("INVALID_PACKAGE_SLUG", "Invalid package slug"), "invalid-reference"],
    [400, errorBody("INVALID_IMAGE_UPLOAD", "Invalid image upload"), "invalid-image"],
    [400, errorBody("INVALID_JOURNEY_IMAGE_UPDATE", "Invalid journey image update"), "invalid-update"],
    [404, errorBody("PACKAGE_NOT_FOUND", "Package not found"), "not-found"],
    [404, errorBody("JOURNEY_IMAGE_NOT_FOUND", "This journey has no image"), "image-not-found"],
    [409, errorBody("JOURNEY_IMAGE_EXISTS", "This journey already has an image"), "image-exists"],
    [413, errorBody("IMAGE_TOO_LARGE", "Image exceeds the maximum upload size"), "too-large"],
    [415, errorBody("UNSUPPORTED_IMAGE_TYPE", "Unsupported image type"), "unsupported-type"],
    [500, errorBody("MEDIA_OPERATION_FAILED", "The operation could not be completed"), "operation-failed"],
    [
      503,
      errorBody(
        "MEDIA_PERSISTENCE_OUTCOME_UNCERTAIN",
        "The operation outcome could not be confirmed. Refresh the current state before retrying.",
      ),
      "outcome-uncertain",
    ],
    [503, errorBody("MEDIA_STORAGE_UNAVAILABLE", "Media storage is temporarily unavailable"), "storage-unavailable"],
  ];

  it("classifies each locked error body", async () => {
    for (const [status, body, expected] of cases) {
      stubFetch({ status, body });

      const result = await uploadAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);

      assert.equal(result.state, expected, `${status} ${JSON.stringify(body.error.code)}`);
      mock.restoreAll();
    }
  });

  it("refuses to read a right status with a wrong body as a decision", async () => {
    stubFetch({ status: 409, body: errorBody("SOMETHING_ELSE", "not this contract") });

    const result = await uploadAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);

    assert.equal(result.state, "unavailable");
  });

  it("reports an unreachable API without claiming anything", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const result = await deleteAdminPackageImage(SLUG, COOKIE);

    assert.equal(result.state, "unavailable");
    assert.equal(result.state === "unavailable" && result.reason.length > 0, true);
  });

  it("refuses a success body that is not the five-field image", async () => {
    for (const data of [
      null,
      {},
      { ...IMAGE, reference: "" },
      { ...IMAGE, url: 123 },
      { ...IMAGE, width: 0 },
      { ...IMAGE, height: -1 },
      { ...IMAGE, altText: 42 },
    ]) {
      stubFetch({ status: 200, body: { data } });

      const result = await replaceAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);

      assert.equal(result.state, "unavailable", JSON.stringify(data));
      mock.restoreAll();
    }
  });

  it("keeps internal media fields out of what it returns", async () => {
    stubFetch({
      status: 200,
      body: {
        data: {
          ...IMAGE,
          storageKey: "media/x.webp",
          storage_key: "media/x.webp",
          checksum: "a".repeat(64),
          mediaAssetId: "9",
          bucket: "some-bucket",
        },
      },
    });

    const result = await replaceAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);

    assert.equal(result.state, "ok");
    // Built field by field, so a field the API did not promise cannot be
    // passed through even if a body carried one.
    assert.deepEqual(Object.keys(result.state === "ok" ? result.image : {}).sort(), [
      "altText",
      "height",
      "reference",
      "url",
      "width",
    ]);
  });
});

describe("journey image client: where the bytes go", () => {
  it("always addresses the hotel API, never a storage host", async () => {
    const calls = stubFetch({ status: 201, body: { data: IMAGE } });

    await uploadAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);
    await replaceAdminPackageImage(SLUG, { body: BYTES, contentType: "image/jpeg" }, COOKIE);
    await deleteAdminPackageImage(SLUG, COOKIE);
    await updateAdminPackageImageAltText(SLUG, "text", COOKIE);

    assert.equal(calls.length, 4);

    for (const call of calls) {
      assert.match(call.url, /\/api\/v1\/admin\/packages\//);
      for (const host of ["r2.cloudflarestorage", "cloudflare", "amazonaws", "media.example"]) {
        assert.ok(!call.url.includes(host), `${host} must never be addressed from here`);
      }
    }
  });
});
