import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BROCHURE_PACKAGE_CATALOGUE } from '../src/db/seeds/packageCatalogue';
import {
  runPackageCatalogueSeed,
  safeMessage,
  type TransactionalClient,
} from '../src/db/seeds/packageCatalogueRunner';
import type { BrochurePackageSeed } from '../src/db/seeds/packageCatalogueSeed';

// Transaction orchestration only. No pool, no PostgreSQL, and deliberately no
// import of the entry point, so nothing here can reach a real database.

type Recorded = { statements: string[]; released: boolean; discarded: boolean | undefined };

function fakeClient(failOn?: { statement: string; error: Error }): TransactionalClient & Recorded {
  const recorder: Recorded = { statements: [], released: false, discarded: undefined };

  return {
    ...recorder,
    statements: recorder.statements,
    async query(queryText: string): Promise<unknown> {
      this.statements.push(queryText);
      if (failOn && failOn.statement === queryText) throw failOn.error;
      return { rows: [] };
    },
    release(destroy?: boolean): void {
      this.released = true;
      this.discarded = destroy;
    },
  } as TransactionalClient & Recorded;
}

/** A seed double that records what it was handed and how often it ran. */
function seedSpy(behaviour?: { error: Error }) {
  const calls: { catalogue: readonly BrochurePackageSeed[] }[] = [];

  return {
    calls,
    fn: async (_client: TransactionalClient, catalogue: readonly BrochurePackageSeed[]) => {
      calls.push({ catalogue });
      if (behaviour) throw behaviour.error;
    },
  };
}

const CATALOGUE = BROCHURE_PACKAGE_CATALOGUE;

describe('package catalogue seed runner — success', () => {
  it('runs BEGIN, the seed, then COMMIT, and releases the connection', async () => {
    const client = fakeClient();
    const seed = seedSpy();

    const result = await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    assert.deepEqual(result, { outcome: 'seeded', offerings: 42 });
    assert.deepEqual(client.statements, ['BEGIN', 'COMMIT']);
    assert.equal(seed.calls.length, 1);
    assert.equal(client.released, true);
    assert.equal(client.discarded, false, 'a healthy connection returns to the pool');
  });

  it('hands the seed exactly the authoritative 42-row catalogue', async () => {
    const client = fakeClient();
    const seed = seedSpy();

    await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    const handed = seed.calls[0]!.catalogue;
    assert.equal(handed, BROCHURE_PACKAGE_CATALOGUE, 'the same array, not a copy or a subset');
    assert.equal(handed.length, 42);
    assert.deepEqual(
      handed.map((item) => item.code).slice(0, 3),
      ['T001', 'T002', 'T003'],
    );
  });

  it('never truncates or deletes the catalogue', async () => {
    const client = fakeClient();

    await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seedSpy().fn });

    for (const statement of client.statements) {
      assert.doesNotMatch(statement, /TRUNCATE|DELETE/i);
    }
  });
});

describe('package catalogue seed runner — failure before commit', () => {
  it('rolls back when the seed throws, and reports nothing was written', async () => {
    const client = fakeClient();
    const seed = seedSpy({ error: new Error('reconciliation conflict') });

    const result = await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    assert.deepEqual(result, {
      outcome: 'failed',
      stage: 'seed',
      message: 'reconciliation conflict',
    });
    assert.deepEqual(client.statements, ['BEGIN', 'ROLLBACK']);
    assert.equal(client.released, true);
    assert.equal(client.discarded, false);
  });

  it('does not retry a failed seed', async () => {
    const client = fakeClient();
    const seed = seedSpy({ error: new Error('reconciliation conflict') });

    await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    assert.equal(seed.calls.length, 1, 'exactly one attempt, ever');
  });

  it('discards the connection when the rollback itself fails', async () => {
    const client = fakeClient({ statement: 'ROLLBACK', error: new Error('connection reset') });
    const seed = seedSpy({ error: new Error('reconciliation conflict') });

    const result = await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    // The seed's own failure is what is reported; the rollback problem only
    // decides that the connection must not be reused.
    assert.equal(result.outcome, 'failed');
    assert.equal(client.discarded, true);
  });
});

describe('package catalogue seed runner — BEGIN failure', () => {
  it('never runs the seed and never issues COMMIT', async () => {
    const client = fakeClient({ statement: 'BEGIN', error: new Error('too many connections') });
    const seed = seedSpy();

    const result = await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    assert.deepEqual(result, {
      outcome: 'failed',
      stage: 'begin',
      message: 'too many connections',
    });
    assert.equal(seed.calls.length, 0, 'the seed must not run');
    assert.deepEqual(client.statements, ['BEGIN'], 'no COMMIT and no ROLLBACK');
    assert.equal(client.released, true);
    assert.equal(client.discarded, true);
  });
});

describe('package catalogue seed runner — COMMIT failure', () => {
  it('reports the outcome as uncertain rather than failed', async () => {
    const client = fakeClient({ statement: 'COMMIT', error: new Error('connection terminated') });

    const result = await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seedSpy().fn });

    assert.deepEqual(result, { outcome: 'uncertain', message: 'connection terminated' });
    assert.notEqual(result.outcome, 'failed');
  });

  it('issues no rollback after a commit was attempted', async () => {
    const client = fakeClient({ statement: 'COMMIT', error: new Error('connection terminated') });

    await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seedSpy().fn });

    assert.deepEqual(client.statements, ['BEGIN', 'COMMIT']);
    assert.ok(
      !client.statements.includes('ROLLBACK'),
      'a rollback here would claim the write was undone, which nobody knows',
    );
  });

  it('discards the connection and still releases it', async () => {
    const client = fakeClient({ statement: 'COMMIT', error: new Error('connection terminated') });

    await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seedSpy().fn });

    assert.equal(client.released, true);
    assert.equal(client.discarded, true);
  });

  it('does not retry after an uncertain commit', async () => {
    const client = fakeClient({ statement: 'COMMIT', error: new Error('connection terminated') });
    const seed = seedSpy();

    await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    assert.equal(seed.calls.length, 1, 'retrying could apply the catalogue twice');
  });
});

describe('diagnostics never leak secrets', () => {
  it('reads only the error message, never the error object', () => {
    const pgLike = Object.assign(new Error('duplicate key value violates unique constraint'), {
      detail: 'Key (code)=(T001) already exists.',
      where: 'SQL statement',
      internalQuery: "INSERT INTO packages VALUES ('secret-value')",
    });

    const message = safeMessage(pgLike);

    assert.equal(message, 'duplicate key value violates unique constraint');
    assert.doesNotMatch(message, /secret-value/);
    assert.doesNotMatch(message, /already exists/);
  });

  it('degrades to a fixed string for a non-Error throwable', () => {
    assert.equal(safeMessage({ connectionString: 'postgres://user:pw@host/db' }), 'unknown error');
    assert.equal(safeMessage(undefined), 'unknown error');
    assert.equal(safeMessage(new Error('')), 'unknown error');
  });

  it('carries only the message into a failure outcome', async () => {
    const client = fakeClient();
    const seed = seedSpy({
      error: Object.assign(new Error('seed refused'), { detail: 'postgres://user:pw@host/db' }),
    });

    const result = await runPackageCatalogueSeed({ client, catalogue: CATALOGUE, seed: seed.fn });

    assert.equal(result.outcome, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /postgres:\/\//);
  });
});
