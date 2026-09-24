import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MediaConfigurationError,
  isMediaConfigurationError,
  resolveMediaRemotePattern,
} from "./mediaPublicBaseUrl";

// Pure, offline, and independent of the owner's real environment: every case
// below hands the function a literal string or `undefined` directly, so
// nothing here depends on what MEDIA_PUBLIC_BASE_URL happens to be set to on
// this machine. No real media hostname appears anywhere in this file — every
// value is example.test or a deliberately-invalid string built to exercise
// one rule.

describe("resolveMediaRemotePattern", () => {
  it("returns null when the variable is absent", () => {
    assert.equal(resolveMediaRemotePattern(undefined), null);
  });

  it("derives /media/** for a root base", () => {
    assert.deepEqual(resolveMediaRemotePattern("https://media.example.test"), {
      protocol: "https",
      hostname: "media.example.test",
      port: "",
      pathname: "/media/**",
    });
  });

  it("derives /assets/media/** for a base with a path", () => {
    assert.deepEqual(resolveMediaRemotePattern("https://media.example.test/assets"), {
      protocol: "https",
      hostname: "media.example.test",
      port: "",
      pathname: "/assets/media/**",
    });
  });

  it("treats a trailing slash identically to none, with no double slash", () => {
    const withSlash = resolveMediaRemotePattern("https://media.example.test/assets/");
    const without = resolveMediaRemotePattern("https://media.example.test/assets");

    assert.deepEqual(withSlash, without);
    assert.equal(withSlash?.pathname.includes("//"), false);

    const rootWithSlash = resolveMediaRemotePattern("https://media.example.test/");
    assert.equal(rootWithSlash?.pathname, "/media/**");
    assert.equal(rootWithSlash?.pathname.includes("//"), false);
  });

  it("accepts https", () => {
    assert.doesNotThrow(() => resolveMediaRemotePattern("https://media.example.test"));
  });

  it("rejects http", () => {
    assert.throws(() => resolveMediaRemotePattern("http://media.example.test"), (error: unknown) => {
      assert.ok(isMediaConfigurationError(error));
      assert.match(error.message, /https/);
      return true;
    });
  });

  it("rejects embedded credentials", () => {
    for (const value of [
      "https://user:pass@media.example.test",
      "https://user@media.example.test",
    ]) {
      assert.throws(() => resolveMediaRemotePattern(value), (error: unknown) => {
        assert.ok(isMediaConfigurationError(error));
        assert.match(error.message, /username or password/);
        return true;
      });
    }
  });

  it("rejects a query string", () => {
    for (const value of ["https://media.example.test?v=1", "https://media.example.test?"]) {
      assert.throws(() => resolveMediaRemotePattern(value), (error: unknown) => {
        assert.ok(isMediaConfigurationError(error));
        assert.match(error.message, /query/);
        return true;
      });
    }
  });

  it("rejects a fragment", () => {
    for (const value of ["https://media.example.test#frag", "https://media.example.test#"]) {
      assert.throws(() => resolveMediaRemotePattern(value), (error: unknown) => {
        assert.ok(isMediaConfigurationError(error));
        assert.match(error.message, /fragment/);
        return true;
      });
    }
  });

  it("rejects surrounding whitespace rather than silently repairing it", () => {
    // new URL() would accept these unchanged; quiet repair is not this
    // app's habit for a value that must exactly match what was configured.
    for (const value of [
      " https://media.example.test",
      "https://media.example.test ",
      "\nhttps://media.example.test",
      "https://media.example.test\t",
    ]) {
      assert.throws(() => resolveMediaRemotePattern(value), (error: unknown) => {
        assert.ok(isMediaConfigurationError(error));
        assert.match(error.message, /whitespace/);
        return true;
      });
    }
  });

  it("never echoes the configured value in the thrown error", () => {
    const rejected = [
      "http://media.example.test",
      "https://user:swordfish@media.example.test",
      "https://media.example.test?token=swordfish",
      "not a url at all",
    ];

    for (const value of rejected) {
      try {
        resolveMediaRemotePattern(value);
        assert.fail(`expected ${value} to be rejected`);
      } catch (error) {
        assert.ok(isMediaConfigurationError(error));
        assert.equal(error.message.includes(value.trim()), false, `leaked the configured value: ${error.message}`);
        assert.equal(error.message.includes("swordfish"), false);
      }
    }
  });

  it("preserves an explicit port", () => {
    assert.deepEqual(resolveMediaRemotePattern("https://media.example.test:8443/assets"), {
      protocol: "https",
      hostname: "media.example.test",
      port: "8443",
      pathname: "/assets/media/**",
    });
  });

  it("does not restrict the host to Cloudflare or r2.dev", () => {
    // A future S3-compatible or otherwise unrelated host must remain usable;
    // this function has no allowlist of hostnames at all.
    for (const value of [
      "https://media.example.test",
      "https://minio.internal.example",
      "https://cdn.some-other-provider.example",
    ]) {
      const pattern = resolveMediaRemotePattern(value);

      assert.equal(pattern?.hostname, new URL(value).hostname);
    }
  });

  it("throws MediaConfigurationError, not a bare Error, for every rejection", () => {
    for (const value of ["http://media.example.test", "https://u:p@media.example.test"]) {
      assert.throws(() => resolveMediaRemotePattern(value), MediaConfigurationError);
    }
  });

  it("has no allowlist a real provider hostname could be found on", () => {
    // The behavioural proof that matters: nothing about how this function
    // decides is keyed to a specific hostname. r2.dev, a Cloudflare account
    // hostname and an arbitrary unrelated host are all accepted identically,
    // which is only possible if none of them is special-cased in the
    // implementation. (Scanning the source text for the substring "r2.dev"
    // is not used here — this file's own comments legitimately discuss its
    // absence in prose, which such a scan cannot tell apart from a real,
    // load-bearing value.)
    const hosts = ["r2.dev", "some-account.r2.cloudflarestorage.com", "media.example.test", "cdn.unrelated.example"];
    const results = hosts.map((host) => resolveMediaRemotePattern(`https://${host}`)?.hostname);

    assert.deepEqual(results, hosts);
  });
});
