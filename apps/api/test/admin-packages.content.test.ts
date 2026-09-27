import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Replacing a journey's content lists, without a database.
//
// Two things are load-bearing. The stored kind is the singular `note` while
// the contract says `notes`, and that translation happens in exactly one
// place — so the fake below stores what the endpoint actually sends, and the
// tests read it back raw. And each kind is numbered from 1 independently,
// because `UNIQUE (package_id, kind, sort_order)` is scoped per kind; the
// fake enforces that constraint, so a single global sequence would fail here.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let replaceAdminPackageContentHandler: ControllerModule['replaceAdminPackageContentHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ replaceAdminPackageContentHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

/** One row exactly as the database would hold it. */
type StoredItem = { kind: string; text: string; sort_order: number };

const body = (overrides: Record<string, unknown> = {}) => ({
  included: ['Dinner', 'Guide'],
  excluded: ['Drinks'],
  notes: ['Smart dress.'],
  ...overrides,
});

/** The stored shape the default body produces. */
const storedForDefaultBody = (): StoredItem[] => [
  { kind: 'included', text: 'Dinner', sort_order: 1 },
  { kind: 'included', text: 'Guide', sort_order: 2 },
  { kind: 'excluded', text: 'Drinks', sort_order: 1 },
  { kind: 'note', text: 'Smart dress.', sort_order: 1 },
];

type Recorded = { text: string; values: unknown[] | undefined };

/**
 * One journey, with the transaction applied to real state.
 *
 * The insert is modelled the way `unnest ... WITH ORDINALITY` behaves, and
 * the per-kind unique index is enforced on every row written, so a regression
 * that numbered all three kinds from one sequence would collide here.
 */
function storedJourney(options: {
  packageExists?: boolean;
  isActive?: boolean;
  seedManaged?: boolean;
  items?: StoredItem[];
} = {}) {
  const state = {
    packageExists: options.packageExists ?? true,
    isActive: options.isActive ?? false,
    seedManaged: options.seedManaged ?? true,
    items: options.items ?? [],
    updatedAt: 0,
    deletes: 0,
    inserts: 0,
    packageWrites: 0,
    released: false,
    discarded: false,
    calls: [] as Recorded[],
  };

  __setClientFactoryForTests(async () => ({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] } as never;
      }

      if (text.includes('FROM packages WHERE slug')) {
        return {
          rows: state.packageExists ? [{ id: PACKAGE_ID, is_active: state.isActive }] : [],
        } as never;
      }

      // The writes are matched before any read: `DELETE FROM
      // package_content_items` contains the substring `FROM
      // package_content_items` too, and so does the detail projection.
      if (text.includes('DELETE FROM package_content_items')) {
        state.items = [];
        state.deletes += 1;
        return { rows: [] } as never;
      }

      // Matched on the unaliased ORDER BY, which only the content-list read
      // has: the detail projection selects `FROM package_content_items c` and
      // orders by `c.kind, c.sort_order`, so a looser match would answer the
      // final read with content rows.
      if (text.includes('ORDER BY kind, sort_order')) {
        return {
          rows: [...state.items]
            .sort((l, r) => l.kind.localeCompare(r.kind) || l.sort_order - r.sort_order)
            .map((item) => ({ kind: item.kind, text: item.text })),
        } as never;
      }

      if (text.includes('INSERT INTO package_content_items')) {
        const kind = values![1] as string;
        const entries = values![2] as string[];

        entries.forEach((entry, index) => {
          const sortOrder = index + 1;

          // What UNIQUE (package_id, kind, sort_order) would do.
          if (state.items.some((i) => i.kind === kind && i.sort_order === sortOrder)) {
            throw Object.assign(
              new Error('duplicate key value violates unique constraint'),
              { code: '23505', constraint: 'package_content_items_package_kind_sort_key' },
            );
          }

          state.items.push({ kind, text: entry, sort_order: sortOrder });
        });

        state.inserts += 1;
        return { rows: [] } as never;
      }

      if (text.includes('UPDATE packages')) {
        state.seedManaged = false;
        state.updatedAt += 1;
        state.packageWrites += 1;
        return { rows: [] } as never;
      }

      return { rows: [detailRow(state)] } as never;
    },
    release(discard?: boolean) {
      state.released = true;
      state.discarded = discard === true;
    },
  }) as never);

  return state;
}

function detailRow(state: {
  isActive: boolean;
  seedManaged: boolean;
  items: StoredItem[];
}) {
  return {
    code: 'T016',
    slug: SLUG,
    title: 'Nile Dinner Cruise',
    summary: null,
    duration_label: null,
    schedule_label: null,
    requires_price_confirmation: false,
    is_active: state.isActive,
    sort_order: 16,
    seed_managed: state.seedManaged,
    description: null,
    operating_days: null,
    variant_count: 0,
    default_variant_label: null,
    // Selected by PACKAGE_DETAIL_COLUMNS now; a row without it is one
    // this repository would never produce. null is no image.
    image: null,
    itinerary: [],
    // The projection's own ordering, so the DTO reflects what is stored.
    content: [...state.items]
      .sort((l, r) => l.kind.localeCompare(r.kind) || l.sort_order - r.sort_order)
      .map((item) => ({ kind: item.kind, text: item.text })),
    variants: [],
  };
}

type Captured = { status: number | undefined; body: unknown };

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { status: undefined, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
}

const request = (slug: string, requestBody: unknown) =>
  ({ params: { slug }, body: requestBody }) as unknown as Request<{ slug: string }>;

async function replaceContent(slug: string, requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await replaceAdminPackageContentHandler(request(slug, requestBody), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const contentOf = (captured: Captured) =>
  dataOf(captured).content as { included: string[]; excluded: string[]; notes: string[] };
const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

/** The stored rows of one kind, in written order. */
const kindRows = (state: { items: StoredItem[] }, kind: string) =>
  state.items.filter((item) => item.kind === kind).sort((l, r) => l.sort_order - r.sort_order);

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin package content: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/content');

    assert.ok(layer?.route, 'PUT /:slug/content should be registered');
    assert.equal(layer.route.methods.put, true, 'it should be a PUT route');

    const chain = layer.route.stack;
    assert.equal(chain[0].name, 'requireAdminSession', 'the guard must come first in the chain');
    assert.equal(chain.length, 2, 'the chain should be guard + handler and nothing else');

    const guard = chain[0].handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;
    const { res, captured } = fakeResponse();
    let nextCalls = 0;

    await guard({ headers: {} } as Request, res, () => {
      nextCalls += 1;
    });

    assert.equal(captured.status, 401);
    assert.equal(nextCalls, 0, 'the handler must never run for an unauthenticated request');
  });
});

describe('admin package content: replacing', () => {
  it('writes all three lists and answers with them', async () => {
    const stored = storedJourney({ items: [] });

    const captured = await replaceContent(SLUG, body());

    assert.equal(captured.status, 200);
    assert.deepEqual(contentOf(captured), {
      included: ['Dinner', 'Guide'],
      excluded: ['Drinks'],
      notes: ['Smart dress.'],
    });
    assert.deepEqual(stored.items, storedForDefaultBody());
  });

  it('stores the singular kind while the contract says notes', async () => {
    const stored = storedJourney({ items: [] });

    const captured = await replaceContent(SLUG, body({ notes: ['Smart dress.', 'Bring a coat.'] }));

    assert.deepEqual(
      kindRows(stored, 'note').map((item) => item.text),
      ['Smart dress.', 'Bring a coat.'],
      'the database keeps `note`',
    );
    assert.equal(stored.items.some((item) => item.kind === 'notes'), false);
    assert.deepEqual(
      contentOf(captured).notes,
      ['Smart dress.', 'Bring a coat.'],
      'and the response says `notes`',
    );
  });

  it('numbers each kind from 1 independently', async () => {
    const stored = storedJourney({ items: [] });

    await replaceContent(SLUG, {
      included: ['a', 'b', 'c'],
      excluded: ['d', 'e'],
      notes: ['f'],
    });

    assert.deepEqual(kindRows(stored, 'included').map((i) => i.sort_order), [1, 2, 3]);
    assert.deepEqual(kindRows(stored, 'excluded').map((i) => i.sort_order), [1, 2]);
    assert.deepEqual(kindRows(stored, 'note').map((i) => i.sort_order), [1]);
  });

  it('preserves the order given, exactly', async () => {
    const stored = storedJourney({ items: [] });

    await replaceContent(SLUG, {
      included: ['zebra', 'apple', 'mango'],
      excluded: [],
      notes: [],
    });

    assert.deepEqual(
      kindRows(stored, 'included').map((item) => item.text),
      ['zebra', 'apple', 'mango'],
      'never sorted alphabetically or otherwise',
    );
  });

  it('accepts duplicate text within a list', async () => {
    const stored = storedJourney({ items: [] });

    const captured = await replaceContent(SLUG, {
      included: ['Transfer', 'Transfer'],
      excluded: [],
      notes: [],
    });

    assert.equal(captured.status, 200);
    assert.deepEqual(kindRows(stored, 'included').map((i) => i.text), ['Transfer', 'Transfer']);
    assert.deepEqual(contentOf(captured).included, ['Transfer', 'Transfer']);
  });

  it('accepts all three lists empty, clearing the content', async () => {
    const stored = storedJourney({ items: storedForDefaultBody() });

    const captured = await replaceContent(SLUG, { included: [], excluded: [], notes: [] });

    assert.equal(captured.status, 200);
    assert.deepEqual(stored.items, [], 'every row is gone');
    assert.deepEqual(contentOf(captured), { included: [], excluded: [], notes: [] });
    assert.equal(stored.deletes, 1);
    assert.equal(stored.inserts, 0, 'nothing is inserted for an empty list');
  });

  it('removes every stale row, not only the ones being replaced', async () => {
    const stored = storedJourney({
      items: [
        { kind: 'included', text: 'Old one', sort_order: 1 },
        { kind: 'included', text: 'Old two', sort_order: 2 },
        { kind: 'excluded', text: 'Old three', sort_order: 1 },
        { kind: 'note', text: 'Old four', sort_order: 1 },
      ],
    });

    await replaceContent(SLUG, { included: ['Only this'], excluded: [], notes: [] });

    assert.deepEqual(stored.items, [{ kind: 'included', text: 'Only this', sort_order: 1 }]);
  });

  it('replaces a live journey without touching its publication', async () => {
    const stored = storedJourney({ isActive: true, items: [] });

    const captured = await replaceContent(SLUG, body());

    assert.equal(captured.status, 200, 'no deactivation is required');
    assert.equal(stored.isActive, true);
    assert.equal(dataOf(captured).isActive, true);

    for (const call of stored.calls) {
      if (!/^UPDATE /.test(call.text.trim())) continue;
      assert.ok(!call.text.includes('is_active'), 'publication is never written here');
    }
  });

  it('uses no parking of any kind', async () => {
    // The delete empties the ordering space, so there is nothing to park
    // around. The variant helper exists only because reservations hold
    // variant ids; content items are referenced by nothing.
    const stored = storedJourney({ items: storedForDefaultBody() });

    await replaceContent(SLUG, { included: ['x'], excluded: ['y'], notes: ['z'] });

    for (const call of stored.calls) {
      assert.ok(!/WITH parked/i.test(call.text), 'no parking pass');
      assert.ok(
        !/UPDATE package_content_items/i.test(call.text),
        'no row is renumbered; they are deleted and rewritten',
      );
    }
  });
});

describe('admin package content: the no-op', () => {
  it('answers 200 for the content a journey already has', async () => {
    const stored = storedJourney({ items: storedForDefaultBody() });

    const captured = await replaceContent(SLUG, body());

    assert.equal(captured.status, 200);
    assert.deepEqual(contentOf(captured), {
      included: ['Dinner', 'Guide'],
      excluded: ['Drinks'],
      notes: ['Smart dress.'],
    });
  });

  it('writes nothing at all', async () => {
    const stored = storedJourney({ items: storedForDefaultBody() });

    await replaceContent(SLUG, body());

    assert.equal(stored.deletes, 0, 'no rows are removed and rewritten');
    assert.equal(stored.inserts, 0);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.updatedAt, 0, 'when the journey last changed is not rewritten');
  });

  it('does not move ownership, because nothing diverged from the brochure', async () => {
    const stored = storedJourney({ seedManaged: true, items: storedForDefaultBody() });

    const captured = await replaceContent(SLUG, body());

    assert.equal(stored.seedManaged, true);
    assert.equal(dataOf(captured).managementSource, 'brochure');
  });

  it('treats a reordered list as a real change, not a no-op', async () => {
    const stored = storedJourney({ items: storedForDefaultBody() });

    await replaceContent(SLUG, body({ included: ['Guide', 'Dinner'] }));

    assert.equal(stored.deletes, 1, 'order is part of the content');
    assert.deepEqual(kindRows(stored, 'included').map((i) => i.text), ['Guide', 'Dinner']);
  });

  it('treats a changed list length as a real change', async () => {
    for (const changed of [
      { included: ['Dinner'] },
      { included: ['Dinner', 'Guide', 'Extra'] },
      { excluded: [] },
      { notes: [] },
    ]) {
      const stored = storedJourney({ items: storedForDefaultBody() });
      await replaceContent(SLUG, body(changed));

      assert.equal(stored.deletes, 1, `${JSON.stringify(changed)} should rewrite`);
    }
  });

  it('recognises an empty journey submitted as empty', async () => {
    const stored = storedJourney({ seedManaged: true, items: [] });

    const captured = await replaceContent(SLUG, { included: [], excluded: [], notes: [] });

    assert.equal(captured.status, 200);
    assert.equal(stored.deletes, 0, 'nothing to remove and nothing changed');
    assert.equal(stored.seedManaged, true);
  });

  it('settles after a real replacement, so a repeat becomes the no-op', async () => {
    const stored = storedJourney({ items: [] });

    await replaceContent(SLUG, body());
    const deletesAfterFirst = stored.deletes;

    await replaceContent(SLUG, body());

    assert.equal(stored.deletes, deletesAfterFirst, 'the second request wrote nothing');
  });
});

describe('admin package content: validation', () => {
  it('requires all three lists', async () => {
    for (const missing of ['included', 'excluded', 'notes']) {
      const partial: Record<string, unknown> = body();
      delete partial[missing];

      const stored = storedJourney({ items: [] });
      const captured = await replaceContent(SLUG, partial);

      assert.equal(captured.status, 400, `a body without ${missing} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0, 'the transaction never opened');
    }
  });

  it('refuses any extra field', async () => {
    for (const field of ['note', 'sortOrder', 'kind', 'itinerary', 'isActive', 'seedManaged']) {
      const stored = storedJourney({ items: [] });
      assert.equal((await replaceContent(SLUG, body({ [field]: [] }))).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a list that is not an array', async () => {
    for (const value of ['Dinner', 42, null, {}, true]) {
      const stored = storedJourney({ items: [] });
      assert.equal((await replaceContent(SLUG, body({ included: value }))).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses an entry that is not a string', async () => {
    for (const entry of [42, null, {}, [], true, undefined]) {
      const stored = storedJourney({ items: [] });
      assert.equal((await replaceContent(SLUG, body({ included: [entry] }))).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a blank entry', async () => {
    for (const entry of ['', ' ', '   ', '\t', '\n']) {
      const stored = storedJourney({ items: [] });
      assert.equal(
        (await replaceContent(SLUG, body({ included: [entry] }))).status,
        400,
        `${JSON.stringify(entry)} should be refused`,
      );
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses untrimmed text rather than repairing it', async () => {
    // The database would accept it — it only demands non-blank — but storing
    // something the administrator did not type is worse than refusing.
    for (const entry of [' Dinner', 'Dinner ', ' Dinner ', '\tDinner']) {
      const stored = storedJourney({ items: [] });
      assert.equal(
        (await replaceContent(SLUG, body({ included: [entry] }))).status,
        400,
        `${JSON.stringify(entry)} should be refused`,
      );
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses an entry longer than the cap', async () => {
    const stored = storedJourney({ items: [] });

    assert.equal(
      (await replaceContent(SLUG, body({ included: ['a'.repeat(501)] }))).status,
      400,
    );
    assert.equal(stored.calls.length, 0);

    const allowed = storedJourney({ items: [] });
    assert.equal(
      (await replaceContent(SLUG, body({ included: ['a'.repeat(500)] }))).status,
      200,
      'the cap itself is allowed',
    );
    assert.ok(allowed.calls.length > 0);
  });

  it('refuses a list longer than the cap', async () => {
    const tooMany = Array.from({ length: 101 }, (_unused, index) => `Item ${index}`);
    const stored = storedJourney({ items: [] });

    assert.equal((await replaceContent(SLUG, body({ included: tooMany }))).status, 400);
    assert.equal(stored.calls.length, 0, 'one request cannot insert unbounded rows');

    const allowed = storedJourney({ items: [] });
    assert.equal(
      (await replaceContent(SLUG, body({ included: tooMany.slice(0, 100) }))).status,
      200,
      'the cap itself is allowed',
    );
  });

  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney({ items: [] });

    const captured = await replaceContent('Not A Slug', body());

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('refuses a body that is not an object at all', async () => {
    for (const malformed of [null, 'content', 42, [body()]]) {
      const stored = storedJourney({ items: [] });
      assert.equal((await replaceContent(SLUG, malformed)).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('answers a journey nothing matches with 404', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await replaceContent(SLUG, body());

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.deletes, 0);
  });
});

describe('admin package content: transaction and ownership', () => {
  it('takes ownership of a brochure journey on a real replacement', async () => {
    const stored = storedJourney({ seedManaged: true, items: [] });

    const captured = await replaceContent(SLUG, body());

    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'or the seed would rewrite the content');
    assert.equal(stored.updatedAt, 1);
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false, items: [] });

    assert.equal(dataOf(await replaceContent(SLUG, body())).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('runs the whole replacement in one transaction, package locked first', async () => {
    const stored = storedJourney({ items: [] });
    await replaceContent(SLUG, body());

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('DELETE FROM package_content_items')) return 'DELETE';
      if (call.text.includes('ORDER BY kind, sort_order')) return 'READ-CONTENT';
      if (call.text.includes('INSERT INTO package_content_items')) return 'INSERT';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(shape, [
      'BEGIN', 'LOCK-PACKAGE', 'READ-CONTENT', 'DELETE',
      'INSERT', 'INSERT', 'INSERT', 'OWN', 'READ', 'COMMIT',
    ]);
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });

  it('ends the no-op transaction without committing', async () => {
    const stored = storedJourney({ items: storedForDefaultBody() });
    await replaceContent(SLUG, body());

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('ROLLBACK')) return 'ROLLBACK';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('ORDER BY kind, sort_order')) return 'READ-CONTENT';
      return 'READ';
    });

    assert.deepEqual(shape, ['BEGIN', 'LOCK-PACKAGE', 'READ-CONTENT', 'READ', 'ROLLBACK']);
  });

  it('locks the package as its first statement', async () => {
    const stored = storedJourney({ items: [] });
    await replaceContent(SLUG, body());

    const lock = stored.calls[1]!;

    assert.match(lock.text, /FROM packages WHERE slug = \$1 FOR UPDATE/);
    assert.deepEqual(lock.values, [SLUG]);
  });

  it('rolls the content and the ownership back together when a statement fails', async () => {
    const calls: string[] = [];
    let released = false;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.split('\n')[0]!.trim());
        if (text.includes('UPDATE packages')) throw new Error('deadlock detected');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('ORDER BY kind, sort_order')) return { rows: [] } as never;
        return { rows: [] } as never;
      },
      release() {
        released = true;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      replaceAdminPackageContentHandler(request(SLUG, body()), res),
      /deadlock detected/,
    );

    // The delete and inserts were inside the same transaction as the
    // ownership flip, so ending it undoes all of them together.
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(released, true);
  });

  it('discards the connection and sends no rollback when COMMIT itself fails', async () => {
    const calls: string[] = [];
    let discarded: boolean | undefined;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.trim().split(/\s/)[0]!);
        if (text.startsWith('COMMIT')) throw new Error('commit failed');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('ORDER BY kind, sort_order')) return { rows: [] } as never;
        if (text.includes('FROM packages p')) {
          return {
            rows: [detailRow({
              isActive: false, seedManaged: false, items: storedForDefaultBody(),
            })],
          } as never;
        }
        return { rows: [] } as never;
      },
      release(discard?: boolean) {
        discarded = discard;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      replaceAdminPackageContentHandler(request(SLUG, body()), res),
      /commit failed/,
    );

    const afterCommit = calls.slice(calls.indexOf('COMMIT') + 1);
    assert.deepEqual(afterCommit, [], 'no statement is sent after a failed COMMIT');
    assert.equal(discarded, true, 'the connection is poisoned rather than reused');
  });
});

describe('admin package content: response', () => {
  it('answers with the whole journey under data, and nothing else', async () => {
    storedJourney({ items: [] });

    const captured = await replaceContent(SLUG, body());

    assert.deepEqual(Object.keys(captured.body as object), ['data']);
    assert.equal(dataOf(captured).slug, SLUG);
  });

  it('leaks no database id and no raw ownership column', async () => {
    storedJourney({ seedManaged: true, items: [] });

    const captured = await replaceContent(SLUG, body());
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'seedManaged', 'package_id', 'sort_order',
      '"kind"']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not appear in the response`);
    }
  });
});
