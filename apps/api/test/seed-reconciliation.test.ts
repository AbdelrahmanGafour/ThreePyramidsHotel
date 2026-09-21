import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AmbiguousSeedStateError,
  decideSeedReconciliation,
} from '../src/db/seeds/seed-reconciliation';

// Pure: no pg, no I/O. Exercises the full { canonicalExists, legacyExists }
// decision matrix dev.ts relies on to stay safe across a clean DB, a
// pre-canonical-slug (demo-*) DB, and re-runs of either.

describe('decideSeedReconciliation', () => {
  it('clean DB (neither slug present): upserts the canonical row', () => {
    const action = decideSeedReconciliation({
      canonicalSlug: 'room-concept-01',
      legacySlug: 'demo-standard',
      canonicalExists: false,
      legacyExists: false,
    });

    assert.equal(action, 'upsert-canonical');
  });

  it('legacy-only DB (only demo-* exists): migrates the legacy row in place', () => {
    const action = decideSeedReconciliation({
      canonicalSlug: 'room-concept-01',
      legacySlug: 'demo-standard',
      canonicalExists: false,
      legacyExists: true,
    });

    assert.equal(action, 'migrate-legacy');
  });

  it('already-canonical DB (only the canonical slug exists): idempotent upsert', () => {
    const action = decideSeedReconciliation({
      canonicalSlug: 'room-concept-01',
      legacySlug: 'demo-standard',
      canonicalExists: true,
      legacyExists: false,
    });

    assert.equal(action, 'upsert-canonical');
  });

  it('running the migration twice: the second run sees no legacy row left, so it stays idempotent', () => {
    // First run: legacy-only -> migrate-legacy (already covered above). After
    // that migration, the legacy slug no longer exists anywhere and the
    // canonical slug now does — this is exactly the "already-canonical" case.
    const secondRun = decideSeedReconciliation({
      canonicalSlug: 'room-concept-01',
      legacySlug: 'demo-standard',
      canonicalExists: true,
      legacyExists: false,
    });

    assert.equal(secondRun, 'upsert-canonical');
  });

  it('mixed/ambiguous DB (both slugs exist): throws rather than guessing', () => {
    assert.throws(
      () =>
        decideSeedReconciliation({
          canonicalSlug: 'room-concept-01',
          legacySlug: 'demo-standard',
          canonicalExists: true,
          legacyExists: true,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AmbiguousSeedStateError);
        assert.equal(error.canonicalSlug, 'room-concept-01');
        assert.equal(error.legacySlug, 'demo-standard');
        assert.match(error.message, /room-concept-01/);
        assert.match(error.message, /demo-standard/);
        return true;
      },
    );
  });

  it('never returns an action that deletes or reassigns anything — only the two documented actions exist', () => {
    const allOutcomes = [
      decideSeedReconciliation({
        canonicalSlug: 'a',
        legacySlug: 'b',
        canonicalExists: false,
        legacyExists: false,
      }),
      decideSeedReconciliation({ canonicalSlug: 'a', legacySlug: 'b', canonicalExists: true, legacyExists: false }),
      decideSeedReconciliation({ canonicalSlug: 'a', legacySlug: 'b', canonicalExists: false, legacyExists: true }),
    ];

    for (const outcome of allOutcomes) {
      assert.ok(outcome === 'upsert-canonical' || outcome === 'migrate-legacy');
    }
  });
});
