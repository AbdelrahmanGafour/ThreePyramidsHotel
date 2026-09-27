import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

// Covers the two account-settings client methods: the exact request each
// sends, and how each answer the API can give becomes one state.
//
// The real server-only module is imported, not a shadow copy — see the note in
// adminRoomsApi.test.ts about the `react-server` export condition. `fetch` is
// replaced per test; no network, no API, no database, and no password leaves
// this process.

type ApiModule = typeof import("./adminAccountApi.js");

let changeAdminAccountEmail: ApiModule["changeAdminAccountEmail"];
let changeAdminAccountPassword: ApiModule["changeAdminAccountPassword"];

const BASE = "http://127.0.0.1:4000";
const COOKIE = "tph_admin_session=abc123";
const CURRENT = "current password 1";
const NEW_EMAIL = "new.manager@example.com";
const NEW_PASSWORD = "replacement password 2";

type RecordedCall = { url: string; init: RequestInit };

let calls: RecordedCall[] = [];
let realFetch: typeof globalThis.fetch;

const apiError = (code: string, message: string) => ({ error: { code, message } });

const NOT_AUTHENTICATED = apiError("NOT_AUTHENTICATED", "Authentication required");
const INVALID_CREDENTIALS = apiError("INVALID_CREDENTIALS", "Invalid email or password");
const INVALID_UPDATE = apiError("INVALID_ADMIN_ACCOUNT_UPDATE", "Invalid account update request");
const EMAIL_IN_USE = apiError("ADMIN_EMAIL_IN_USE", "That email address is already in use");
const PASSWORD_UNCHANGED = apiError(
  "ADMIN_PASSWORD_UNCHANGED",
  "The new password must be different from the current password",
);

const administratorBody = (overrides: Record<string, unknown> = {}) => ({
  data: { administrator: { email: NEW_EMAIL, displayName: "Hotel manager", ...overrides } },
});

function respondWith(status: number, body?: unknown): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

function respondWithUnreadableBody(status: number): void {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response("not json at all", {
      status,
      headers: { "Content-Type": "application/json" },
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

  ({ changeAdminAccountEmail, changeAdminAccountPassword } = await import("./adminAccountApi.js"));

  realFetch = globalThis.fetch;
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// changeAdminAccountEmail
// ---------------------------------------------------------------------------

describe("changeAdminAccountEmail", () => {
  const input = { currentPassword: CURRENT, email: NEW_EMAIL };

  it("patches the email sub-resource with exactly the two contracted fields", async () => {
    respondWith(200, administratorBody());

    await changeAdminAccountEmail(input, COOKIE);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/auth/account/email`);
    assert.equal(calls[0]!.init.method, "PATCH");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, {
      "Content-Type": "application/json",
      Cookie: COOKIE,
    });

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body, { currentPassword: CURRENT, email: NEW_EMAIL });
    assert.deepEqual(Object.keys(body).sort(), ["currentPassword", "email"]);
  });

  it("sends no Cookie header when there is no session to forward", async () => {
    respondWith(401, NOT_AUTHENTICATED);

    await changeAdminAccountEmail(input);

    assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json" });
  });

  it("sends the address exactly as typed, normalising nothing", async () => {
    // The API owns normalisation; a second opinion here could disagree with it.
    respondWith(200, administratorBody());

    await changeAdminAccountEmail({ currentPassword: CURRENT, email: "  Manager@Example.COM  " });

    assert.equal(
      JSON.parse(String(calls[0]!.init.body)).email,
      "  Manager@Example.COM  ",
    );
  });

  it("maps a 200 to the administrator it carries", async () => {
    respondWith(200, administratorBody());

    const result = await changeAdminAccountEmail(input, COOKIE);

    assert.deepEqual(result, {
      state: "ok",
      administrator: { email: NEW_EMAIL, displayName: "Hotel manager" },
    });
  });

  it("carries forward only the two safe fields, never an id the API might add", async () => {
    respondWith(200, administratorBody({ id: "7", passwordHash: "scrypt$..." }));

    const result = await changeAdminAccountEmail(input, COOKIE);

    assert.equal(result.state, "ok");
    assert.deepEqual(
      Object.keys(result.state === "ok" ? result.administrator : {}).sort(),
      ["displayName", "email"],
    );
  });

  describe("keeps each refusal distinct", () => {
    for (const [label, status, body, expected] of [
      ["a malformed request", 400, INVALID_UPDATE, "invalid"],
      ["an ended session", 401, NOT_AUTHENTICATED, "unauthenticated"],
      ["a wrong current password", 401, INVALID_CREDENTIALS, "credentials"],
      ["an address already in use", 409, EMAIL_IN_USE, "email-in-use"],
    ] as const) {
      it(label, async () => {
        respondWith(status, body);

        assert.deepEqual(await changeAdminAccountEmail(input, COOKIE), { state: expected });
      });
    }
  });

  it("does not read an uncontracted body as one of its refusals", async () => {
    for (const [status, body] of [
      [400, apiError("SOMETHING_ELSE", "Something else")],
      [401, apiError("SOMETHING_ELSE", "Something else")],
      [409, PASSWORD_UNCHANGED],
    ] as const) {
      respondWith(status, body);

      assert.equal((await changeAdminAccountEmail(input, COOKIE)).state, "unavailable");
    }
  });

  it("treats a 200 it cannot read as unavailable, never as a confirmed change", async () => {
    respondWithUnreadableBody(200);
    assert.equal((await changeAdminAccountEmail(input, COOKIE)).state, "unavailable");

    respondWith(200, { data: {} });
    assert.equal((await changeAdminAccountEmail(input, COOKIE)).state, "unavailable");

    respondWith(200, administratorBody({ email: 7 }));
    assert.equal((await changeAdminAccountEmail(input, COOKIE)).state, "unavailable");
  });

  it("treats an unexpected status as unavailable", async () => {
    for (const status of [204, 403, 418, 500, 502]) {
      respondWith(status, undefined);
      assert.equal((await changeAdminAccountEmail(input, COOKIE)).state, "unavailable");
    }
  });

  it("reports an unanswered PATCH as unknown, and never retries it", async () => {
    respondWithTransportFailure();

    const result = await changeAdminAccountEmail(input, COOKIE);

    assert.equal(result.state, "unavailable", "the outcome is unknown, never 'failed'");
    assert.equal(calls.length, 1, "a dropped PATCH may already have committed");
  });

  it("never puts a submitted value in the reason it reports", async () => {
    respondWithTransportFailure();

    const result = await changeAdminAccountEmail(input, COOKIE);

    assert.ok(result.state === "unavailable");
    assert.ok(!result.reason.includes(CURRENT));
    assert.ok(!result.reason.includes(NEW_EMAIL));
    assert.ok(!result.reason.includes(BASE), "the configured address is never echoed");
  });
});

// ---------------------------------------------------------------------------
// changeAdminAccountPassword
// ---------------------------------------------------------------------------

describe("changeAdminAccountPassword", () => {
  const input = { currentPassword: CURRENT, newPassword: NEW_PASSWORD };

  it("patches the password sub-resource with exactly the two contracted fields", async () => {
    respondWith(204);

    await changeAdminAccountPassword(input, COOKIE);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/api/v1/admin/auth/account/password`);
    assert.equal(calls[0]!.init.method, "PATCH");
    assert.equal(calls[0]!.init.cache, "no-store");
    assert.deepEqual(calls[0]!.init.headers, {
      "Content-Type": "application/json",
      Cookie: COOKIE,
    });

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body, { currentPassword: CURRENT, newPassword: NEW_PASSWORD });
  });

  it("never sends a confirmation field, whatever the caller was given", async () => {
    // The API contract has two fields. The confirmation is this website's own
    // check and must not be able to reach the wire even by accident.
    respondWith(204);

    await changeAdminAccountPassword(
      { ...input, confirmPassword: NEW_PASSWORD } as never,
      COOKIE,
    );

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(Object.keys(body).sort(), ["currentPassword", "newPassword"]);
    assert.ok(!("confirmPassword" in body));
  });

  it("maps a 204 to success, reading no body", async () => {
    respondWith(204);

    assert.deepEqual(await changeAdminAccountPassword(input, COOKIE), { state: "ok" });
  });

  describe("keeps each refusal distinct", () => {
    for (const [label, status, body, expected] of [
      ["a malformed request or a policy failure", 400, INVALID_UPDATE, "invalid"],
      ["an ended session", 401, NOT_AUTHENTICATED, "unauthenticated"],
      ["a wrong current password", 401, INVALID_CREDENTIALS, "credentials"],
      ["a new password equal to the current one", 409, PASSWORD_UNCHANGED, "password-unchanged"],
    ] as const) {
      it(label, async () => {
        respondWith(status, body);

        assert.deepEqual(await changeAdminAccountPassword(input, COOKIE), { state: expected });
      });
    }
  });

  it("does not read the email conflict as its own", async () => {
    respondWith(409, EMAIL_IN_USE);

    assert.equal((await changeAdminAccountPassword(input, COOKIE)).state, "unavailable");
  });

  it("treats a 200 on a 204 endpoint as unavailable", async () => {
    // Contracted to answer 204. Anything else is not a confirmed change, and
    // reporting success would sign the administrator out on a guess.
    respondWith(200, { data: {} });

    assert.equal((await changeAdminAccountPassword(input, COOKIE)).state, "unavailable");
  });

  it("reports an unanswered PATCH as unknown, and never retries it", async () => {
    respondWithTransportFailure();

    const result = await changeAdminAccountPassword(input, COOKIE);

    assert.equal(result.state, "unavailable");
    assert.equal(calls.length, 1);
  });

  it("never puts a password in the reason it reports", async () => {
    respondWithTransportFailure();

    const result = await changeAdminAccountPassword(input, COOKIE);

    assert.ok(result.state === "unavailable");
    assert.ok(!result.reason.includes(CURRENT));
    assert.ok(!result.reason.includes(NEW_PASSWORD));
  });
});

describe("the client as a whole", () => {
  it("reaches only the two account paths", async () => {
    respondWith(200, administratorBody());
    await changeAdminAccountEmail({ currentPassword: CURRENT, email: NEW_EMAIL }, COOKIE);
    respondWith(204);
    await changeAdminAccountPassword({ currentPassword: CURRENT, newPassword: NEW_PASSWORD }, COOKIE);

    assert.deepEqual(
      calls.map((call) => call.url),
      [
        `${BASE}/api/v1/admin/auth/account/email`,
        `${BASE}/api/v1/admin/auth/account/password`,
      ],
    );
  });

  it("puts no submitted value in a URL", async () => {
    respondWith(204);

    await changeAdminAccountPassword({ currentPassword: CURRENT, newPassword: NEW_PASSWORD }, COOKIE);

    const url = calls[0]!.url;
    assert.ok(!url.includes("?"), "no query string at all");
    assert.ok(!url.includes(CURRENT));
    assert.ok(!url.includes(NEW_PASSWORD));
  });
});
