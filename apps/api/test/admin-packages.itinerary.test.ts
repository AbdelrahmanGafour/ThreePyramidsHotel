import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// Replacing a journey's itinerary, without a database.
//
// Two nullable fields carry meaning rather than absence: a null `dayNumber`
// is a section about the whole journey, a null `heading` is an unheaded
// passage. So the fake below stores exactly what the endpoint sends and the
// tests read it back raw, and the comparison that decides the no-op treats
// null as distinct from every value.
//
// The insert is modelled as the multi-row VALUES list it is, and
// the unique index on (package_id, sort_order) is enforced on every row, so a
// regression that reused a position would fail here.

type RepositoryModule = typeof import('../src/modules/admin-packages/admin-packages.repository.js');
type ControllerModule = typeof import('../src/modules/admin-packages/admin-packages.controller.js');
type RoutesModule = typeof import('../src/modules/admin-packages/admin-packages.routes.js');

let __setClientFactoryForTests: RepositoryModule['__setClientFactoryForTests'];
let replaceAdminPackageItineraryHandler: ControllerModule['replaceAdminPackageItineraryHandler'];
let adminPackagesRouter: RoutesModule['adminPackagesRouter'];

const SLUG = 'nile-dinner-cruise';
const PACKAGE_ID = '42';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/admin-packages/admin-packages.repository.js'
  ));
  ({ replaceAdminPackageItineraryHandler } = await import(
    '../src/modules/admin-packages/admin-packages.controller.js'
  ));
  ({ adminPackagesRouter } = await import('../src/modules/admin-packages/admin-packages.routes.js'));
});

afterEach(() => {
  __setClientFactoryForTests(null);
});

/** One row exactly as the database would hold it. */
type StoredSection = {
  day_number: number | null;
  heading: string | null;
  body: string;
  sort_order: number;
};

const section = (overrides: Record<string, unknown> = {}) => ({
  dayNumber: 1,
  heading: 'Arrival',
  body: 'Meet at the airport and transfer to the hotel.',
  ...overrides,
});

const body = (sections: unknown[] = [section()]) => ({ sections });

/** The stored shape a one-section body produces. */
const storedForDefaultBody = (): StoredSection[] => [
  {
    day_number: 1,
    heading: 'Arrival',
    body: 'Meet at the airport and transfer to the hotel.',
    sort_order: 1,
  },
];

type Recorded = { text: string; values: unknown[] | undefined };

function storedJourney(options: {
  packageExists?: boolean;
  isActive?: boolean;
  seedManaged?: boolean;
  sections?: StoredSection[];
} = {}) {
  const state = {
    packageExists: options.packageExists ?? true,
    isActive: options.isActive ?? false,
    seedManaged: options.seedManaged ?? true,
    sections: options.sections ?? [],
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

      // The writes are matched before any read: both contain the substring
      // `FROM package_itinerary_sections`, and so does the detail projection.
      if (text.includes('DELETE FROM package_itinerary_sections')) {
        state.sections = [];
        state.deletes += 1;
        return { rows: [] } as never;
      }

      if (text.includes('INSERT INTO package_itinerary_sections')) {
        // One multi-row VALUES list: (package_id, day, heading, body, sort_order).
        for (let at = 0; at < values!.length; at += 5) {
          const sortOrder = values![at + 4] as number;

          // What UNIQUE (package_id, sort_order) would do.
          if (state.sections.some((s) => s.sort_order === sortOrder)) {
            throw Object.assign(
              new Error('Duplicate entry'),
              { code: '23505', constraint: 'package_itinerary_sections_package_sort_key' },
            );
          }

          state.sections.push({
            day_number: values![at + 1] as number | null,
            heading: values![at + 2] as string | null,
            body: values![at + 3] as string,
            sort_order: sortOrder,
          });
        }

        state.inserts += 1;
        return { rows: [] } as never;
      }

      // Matched on the unaliased ORDER BY, which only the itinerary read has:
      // the detail projection selects `FROM package_itinerary_sections s` and
      // orders by `s.sort_order`.
      if (text.includes('ORDER BY sort_order')) {
        return {
          rows: [...state.sections]
            .sort((l, r) => l.sort_order - r.sort_order)
            .map((s) => ({ day_number: s.day_number, heading: s.heading, body: s.body })),
        } as never;
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
  sections: StoredSection[];
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
    itinerary: [...state.sections]
      .sort((l, r) => l.sort_order - r.sort_order)
      .map((s) => ({ day_number: s.day_number, heading: s.heading, body: s.body })),
    content: [],
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

async function replaceItinerary(slug: string, requestBody: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await replaceAdminPackageItineraryHandler(request(slug, requestBody), res);
  return captured;
}

const dataOf = (captured: Captured) => (captured.body as { data: Record<string, unknown> }).data;
const itineraryOf = (captured: Captured) =>
  dataOf(captured).itinerary as Array<Record<string, unknown>>;
const errorOf = (captured: Captured) =>
  (captured.body as { error: { code: string; message: string } }).error;

const INVALID_BODY = { error: { code: 'INVALID_PACKAGE', message: 'Invalid package details' } };

describe('admin package itinerary: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackagesRouter as never as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name: string; handle: unknown }>;
        };
      }>;
    }).stack.find((entry) => entry.route?.path === '/:slug/itinerary');

    assert.ok(layer?.route, 'PUT /:slug/itinerary should be registered');
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

describe('admin package itinerary: replacing', () => {
  it('writes the sections and answers with them', async () => {
    const stored = storedJourney({ sections: [] });

    const captured = await replaceItinerary(SLUG, body());

    assert.equal(captured.status, 200);
    assert.deepEqual(stored.sections, storedForDefaultBody());
    assert.deepEqual(itineraryOf(captured), [{
      dayNumber: 1,
      heading: 'Arrival',
      body: 'Meet at the airport and transfer to the hotel.',
    }]);
  });

  it('assigns sort_order 1..n in array order', async () => {
    const stored = storedJourney({ sections: [] });

    await replaceItinerary(SLUG, body([
      section({ body: 'First' }),
      section({ body: 'Second' }),
      section({ body: 'Third' }),
    ]));

    assert.deepEqual(stored.sections.map((s) => [s.body, s.sort_order]), [
      ['First', 1], ['Second', 2], ['Third', 3],
    ]);
  });

  it('preserves the order given, exactly', async () => {
    const stored = storedJourney({ sections: [] });

    await replaceItinerary(SLUG, body([
      section({ dayNumber: 3, body: 'Zebra' }),
      section({ dayNumber: 1, body: 'Apple' }),
      section({ dayNumber: 2, body: 'Mango' }),
    ]));

    assert.deepEqual(
      stored.sections.map((s) => s.body),
      ['Zebra', 'Apple', 'Mango'],
      'never sorted by day number or anything else',
    );
  });

  it('round-trips both nullable fields as null', async () => {
    const stored = storedJourney({ sections: [] });

    const captured = await replaceItinerary(SLUG, body([
      section({ dayNumber: null, heading: null, body: 'Whole-journey note.' }),
    ]));

    assert.equal(stored.sections[0]!.day_number, null, 'stored as null, not zero');
    assert.equal(stored.sections[0]!.heading, null, 'stored as null, not an empty string');
    assert.deepEqual(itineraryOf(captured), [{
      dayNumber: null, heading: null, body: 'Whole-journey note.',
    }]);
  });

  it('keeps a null day beside a numbered one', async () => {
    const stored = storedJourney({ sections: [] });

    await replaceItinerary(SLUG, body([
      section({ dayNumber: 1, heading: 'Arrival', body: 'Day one.' }),
      section({ dayNumber: null, heading: null, body: 'Applies throughout.' }),
    ]));

    assert.deepEqual(stored.sections.map((s) => s.day_number), [1, null]);
    assert.deepEqual(stored.sections.map((s) => s.heading), ['Arrival', null]);
  });

  it('accepts duplicate sections', async () => {
    const stored = storedJourney({ sections: [] });

    const captured = await replaceItinerary(SLUG, body([section(), section()]));

    assert.equal(captured.status, 200);
    assert.equal(stored.sections.length, 2);
    assert.deepEqual(stored.sections.map((s) => s.sort_order), [1, 2]);
  });

  it('accepts an empty itinerary, clearing every section', async () => {
    const stored = storedJourney({ sections: storedForDefaultBody() });

    const captured = await replaceItinerary(SLUG, body([]));

    assert.equal(captured.status, 200);
    assert.deepEqual(stored.sections, []);
    assert.deepEqual(itineraryOf(captured), []);
    assert.equal(stored.deletes, 1);
    assert.equal(stored.inserts, 0, 'nothing is inserted for an empty itinerary');
  });

  it('removes every stale section on a real replacement', async () => {
    const stored = storedJourney({
      sections: [
        { day_number: 1, heading: 'Old one', body: 'A', sort_order: 1 },
        { day_number: 2, heading: 'Old two', body: 'B', sort_order: 2 },
        { day_number: null, heading: null, body: 'C', sort_order: 3 },
      ],
    });

    await replaceItinerary(SLUG, body([section({ body: 'Only this' })]));

    assert.deepEqual(stored.sections, [{
      day_number: 1, heading: 'Arrival', body: 'Only this', sort_order: 1,
    }]);
  });

  it('accepts exactly a hundred sections', async () => {
    const stored = storedJourney({ sections: [] });
    const many = Array.from({ length: 100 }, (_u, i) => section({ body: `Section ${i + 1}` }));

    assert.equal((await replaceItinerary(SLUG, body(many))).status, 200);
    assert.equal(stored.sections.length, 100);
    assert.deepEqual(stored.sections.map((s) => s.sort_order), many.map((_u, i) => i + 1));
  });

  it('replaces a live journey without touching its publication', async () => {
    const stored = storedJourney({ isActive: true, sections: [] });

    const captured = await replaceItinerary(SLUG, body());

    assert.equal(captured.status, 200, 'no deactivation is required');
    assert.equal(stored.isActive, true);
    assert.equal(dataOf(captured).isActive, true);

    for (const call of stored.calls) {
      if (!/^UPDATE /.test(call.text.trim())) continue;
      assert.ok(!call.text.includes('is_active'), 'publication is never written here');
    }
  });

  it('uses no parking of any kind', async () => {
    const stored = storedJourney({ sections: storedForDefaultBody() });

    await replaceItinerary(SLUG, body([section({ body: 'Changed' })]));

    for (const call of stored.calls) {
      assert.ok(!/WITH parked/i.test(call.text), 'no parking pass');
      assert.ok(
        !/UPDATE package_itinerary_sections/i.test(call.text),
        'no row is renumbered; they are deleted and rewritten',
      );
    }
  });
});

describe('admin package itinerary: the no-op', () => {
  it('answers 200 for the itinerary a journey already has', async () => {
    storedJourney({ sections: storedForDefaultBody() });

    const captured = await replaceItinerary(SLUG, body());

    assert.equal(captured.status, 200);
    assert.equal(itineraryOf(captured).length, 1);
  });

  it('writes nothing at all', async () => {
    const stored = storedJourney({ sections: storedForDefaultBody() });

    await replaceItinerary(SLUG, body());

    assert.equal(stored.deletes, 0);
    assert.equal(stored.inserts, 0);
    assert.equal(stored.packageWrites, 0);
    assert.equal(stored.updatedAt, 0, 'when the journey last changed is not rewritten');
  });

  it('does not move ownership, because nothing diverged from the brochure', async () => {
    const stored = storedJourney({ seedManaged: true, sections: storedForDefaultBody() });

    const captured = await replaceItinerary(SLUG, body());

    assert.equal(stored.seedManaged, true);
    assert.equal(dataOf(captured).managementSource, 'brochure');
  });

  it('recognises an empty itinerary submitted as empty', async () => {
    const stored = storedJourney({ seedManaged: true, sections: [] });

    const captured = await replaceItinerary(SLUG, body([]));

    assert.equal(captured.status, 200);
    assert.equal(stored.deletes, 0, 'nothing to remove and nothing changed');
    assert.equal(stored.seedManaged, true);
  });

  it('treats reordered sections as a real change', async () => {
    const stored = storedJourney({
      sections: [
        { day_number: 1, heading: 'One', body: 'A', sort_order: 1 },
        { day_number: 2, heading: 'Two', body: 'B', sort_order: 2 },
      ],
    });

    await replaceItinerary(SLUG, body([
      { dayNumber: 2, heading: 'Two', body: 'B' },
      { dayNumber: 1, heading: 'One', body: 'A' },
    ]));

    assert.equal(stored.deletes, 1, 'order is part of the itinerary');
    assert.deepEqual(stored.sections.map((s) => s.body), ['B', 'A']);
  });

  it('treats a changed nullable field as a real change', async () => {
    // null is distinct from every value: a whole-journey section is not the
    // same as one about day 1, and an unheaded passage is not one titled "".
    for (const changed of [
      { dayNumber: null },
      { dayNumber: 2 },
      { heading: null },
      { heading: 'Different' },
      { body: 'Different' },
    ]) {
      const stored = storedJourney({ sections: storedForDefaultBody() });
      await replaceItinerary(SLUG, body([section(changed)]));

      assert.equal(stored.deletes, 1, `${JSON.stringify(changed)} should rewrite`);
    }
  });

  it('settles after a real replacement, so a repeat becomes the no-op', async () => {
    const stored = storedJourney({ sections: [] });

    await replaceItinerary(SLUG, body());
    const deletesAfterFirst = stored.deletes;

    await replaceItinerary(SLUG, body());

    assert.equal(stored.deletes, deletesAfterFirst, 'the second request wrote nothing');
  });
});

describe('admin package itinerary: validation', () => {
  it('requires the sections key', async () => {
    for (const malformed of [{}, { section: [] }, { items: [] }]) {
      const stored = storedJourney({ sections: [] });
      assert.equal((await replaceItinerary(SLUG, malformed)).status, 400);
      assert.equal(stored.calls.length, 0, 'the transaction never opened');
    }
  });

  it('refuses any extra top-level key', async () => {
    for (const field of ['content', 'sortOrder', 'isActive', 'seedManaged', 'slug']) {
      const stored = storedJourney({ sections: [] });
      const captured = await replaceItinerary(SLUG, { sections: [], [field]: [] });

      assert.equal(captured.status, 400, `${field} should be refused`);
      assert.deepEqual(captured.body, INVALID_BODY);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses sections that is not an array', async () => {
    for (const value of ['Arrival', 42, null, {}, true]) {
      const stored = storedJourney({ sections: [] });
      assert.equal((await replaceItinerary(SLUG, { sections: value })).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a section missing any required key', async () => {
    for (const missing of ['dayNumber', 'heading', 'body']) {
      const partial: Record<string, unknown> = section();
      delete partial[missing];

      const stored = storedJourney({ sections: [] });
      const captured = await replaceItinerary(SLUG, body([partial]));

      assert.equal(captured.status, 400, `a section without ${missing} should be refused`);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses an extra key on a section', async () => {
    for (const field of ['sortOrder', 'id', 'packageId', 'position']) {
      const stored = storedJourney({ sections: [] });
      assert.equal((await replaceItinerary(SLUG, body([section({ [field]: 1 })]))).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a section that is not an object', async () => {
    for (const value of ['Arrival', 42, null, [], true]) {
      const stored = storedJourney({ sections: [] });
      assert.equal((await replaceItinerary(SLUG, body([value]))).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a day number that is not a whole number above zero', async () => {
    for (const dayNumber of [0, -1, 1.5, '1', 2147483648, Number.NaN, Number.POSITIVE_INFINITY,
      true, {}]) {
      const stored = storedJourney({ sections: [] });
      assert.equal(
        (await replaceItinerary(SLUG, body([section({ dayNumber })]))).status,
        400,
        `${String(dayNumber)} should be refused`,
      );
      assert.equal(stored.calls.length, 0);
    }
  });

  it('accepts the largest day number the column holds', async () => {
    const stored = storedJourney({ sections: [] });

    assert.equal(
      (await replaceItinerary(SLUG, body([section({ dayNumber: 2147483647 })]))).status,
      200,
    );
    assert.equal(stored.sections[0]!.day_number, 2147483647);
  });

  it('refuses a blank heading rather than converting it to null', async () => {
    for (const heading of ['', ' ', '   ', '\t']) {
      const stored = storedJourney({ sections: [] });
      assert.equal(
        (await replaceItinerary(SLUG, body([section({ heading })]))).status,
        400,
        `${JSON.stringify(heading)} should be refused, not turned into null`,
      );
      assert.equal(stored.calls.length, 0, 'and nothing is written');
    }
  });

  it('refuses untrimmed text in either field', async () => {
    for (const overrides of [
      { heading: ' Arrival' }, { heading: 'Arrival ' },
      { body: ' Meet at the airport.' }, { body: 'Meet at the airport. ' },
    ]) {
      const stored = storedJourney({ sections: [] });
      assert.equal(
        (await replaceItinerary(SLUG, body([section(overrides)]))).status,
        400,
        `${JSON.stringify(overrides)} should be reported, not repaired`,
      );
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses a heading longer than the cap, and accepts the cap itself', async () => {
    const stored = storedJourney({ sections: [] });
    assert.equal(
      (await replaceItinerary(SLUG, body([section({ heading: 'a'.repeat(201) })]))).status,
      400,
    );
    assert.equal(stored.calls.length, 0);

    const allowed = storedJourney({ sections: [] });
    assert.equal(
      (await replaceItinerary(SLUG, body([section({ heading: 'a'.repeat(200) })]))).status,
      200,
    );
    assert.ok(allowed.calls.length > 0);
  });

  it('refuses a blank or oversized body, and accepts the cap itself', async () => {
    for (const value of ['', ' ', '   ', 'a'.repeat(2001), 42, null, {}]) {
      const stored = storedJourney({ sections: [] });
      assert.equal(
        (await replaceItinerary(SLUG, body([section({ body: value })]))).status,
        400,
        `${String(value).slice(0, 20)} should be refused`,
      );
      assert.equal(stored.calls.length, 0);
    }

    const allowed = storedJourney({ sections: [] });
    assert.equal(
      (await replaceItinerary(SLUG, body([section({ body: 'a'.repeat(2000) })]))).status,
      200,
    );
  });

  it('refuses a heading that is neither null nor a string', async () => {
    for (const heading of [42, {}, [], true]) {
      const stored = storedJourney({ sections: [] });
      assert.equal((await replaceItinerary(SLUG, body([section({ heading })]))).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('refuses more sections than the cap', async () => {
    const many = Array.from({ length: 101 }, (_u, i) => section({ body: `Section ${i}` }));
    const stored = storedJourney({ sections: [] });

    assert.equal((await replaceItinerary(SLUG, body(many))).status, 400);
    assert.equal(stored.calls.length, 0, 'one request cannot insert unbounded rows');
  });

  it('refuses a malformed slug before opening a transaction', async () => {
    const stored = storedJourney({ sections: [] });

    const captured = await replaceItinerary('Not A Slug', body());

    assert.equal(captured.status, 400);
    assert.equal(errorOf(captured).code, 'INVALID_PACKAGE_SLUG');
    assert.equal(stored.calls.length, 0);
  });

  it('refuses a body that is not an object at all', async () => {
    for (const malformed of [null, 'itinerary', 42, [section()]]) {
      const stored = storedJourney({ sections: [] });
      assert.equal((await replaceItinerary(SLUG, malformed)).status, 400);
      assert.equal(stored.calls.length, 0);
    }
  });

  it('answers a journey nothing matches with 404', async () => {
    const stored = storedJourney({ packageExists: false });

    const captured = await replaceItinerary(SLUG, body());

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_NOT_FOUND', message: 'Package not found' },
    });
    assert.equal(stored.deletes, 0);
  });
});

describe('admin package itinerary: transaction and ownership', () => {
  it('takes ownership of a brochure journey on a real replacement', async () => {
    const stored = storedJourney({ seedManaged: true, sections: [] });

    const captured = await replaceItinerary(SLUG, body());

    assert.equal(dataOf(captured).managementSource, 'admin');
    assert.equal(stored.seedManaged, false, 'or the seed would rewrite the itinerary');
    assert.equal(stored.updatedAt, 1);
  });

  it('leaves an already admin-managed journey admin-managed', async () => {
    const stored = storedJourney({ seedManaged: false, sections: [] });

    assert.equal(dataOf(await replaceItinerary(SLUG, body())).managementSource, 'admin');
    assert.equal(stored.seedManaged, false);
  });

  it('runs the whole replacement in one transaction, package locked first', async () => {
    const stored = storedJourney({ sections: [] });
    await replaceItinerary(SLUG, body());

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('COMMIT')) return 'COMMIT';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('DELETE FROM package_itinerary_sections')) return 'DELETE';
      if (call.text.includes('INSERT INTO package_itinerary_sections')) return 'INSERT';
      if (call.text.includes('ORDER BY sort_order')) return 'READ-ITINERARY';
      if (call.text.includes('UPDATE packages')) return 'OWN';
      return 'READ';
    });

    assert.deepEqual(shape, [
      'BEGIN', 'LOCK-PACKAGE', 'READ-ITINERARY', 'DELETE', 'INSERT', 'OWN', 'READ', 'COMMIT',
    ]);
    assert.equal(stored.released, true);
    assert.equal(stored.discarded, false);
  });

  it('ends the no-op transaction without committing', async () => {
    const stored = storedJourney({ sections: storedForDefaultBody() });
    await replaceItinerary(SLUG, body());

    const shape = stored.calls.map((call) => {
      if (call.text.startsWith('BEGIN')) return 'BEGIN';
      if (call.text.startsWith('ROLLBACK')) return 'ROLLBACK';
      if (call.text.includes('FROM packages WHERE slug')) return 'LOCK-PACKAGE';
      if (call.text.includes('ORDER BY sort_order')) return 'READ-ITINERARY';
      return 'READ';
    });

    assert.deepEqual(shape, ['BEGIN', 'LOCK-PACKAGE', 'READ-ITINERARY', 'READ', 'ROLLBACK']);
  });

  it('locks the package as its first statement', async () => {
    const stored = storedJourney({ sections: [] });
    await replaceItinerary(SLUG, body());

    const lock = stored.calls[1]!;

    assert.match(lock.text, /FROM packages WHERE slug = \$1 FOR UPDATE/);
    assert.deepEqual(lock.values, [SLUG]);
  });

  it('rolls the itinerary and the ownership back together when a statement fails', async () => {
    const calls: string[] = [];
    let released = false;

    __setClientFactoryForTests(async () => ({
      async query(text: string) {
        calls.push(text.split('\n')[0]!.trim());
        if (text.includes('UPDATE packages')) throw new Error('deadlock detected');
        if (text.includes('FROM packages WHERE slug')) {
          return { rows: [{ id: PACKAGE_ID, is_active: false }] } as never;
        }
        if (text.includes('ORDER BY sort_order')) return { rows: [] } as never;
        return { rows: [] } as never;
      },
      release() {
        released = true;
      },
    }) as never);

    const { res } = fakeResponse();
    await assert.rejects(
      replaceAdminPackageItineraryHandler(request(SLUG, body()), res),
      /deadlock detected/,
    );

    // The delete and insert were inside the same transaction as the ownership
    // flip, so ending it undoes all of them together.
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
        if (text.includes('ORDER BY sort_order')) return { rows: [] } as never;
        if (text.includes('FROM packages p')) {
          return {
            rows: [detailRow({
              isActive: false, seedManaged: false, sections: storedForDefaultBody(),
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
      replaceAdminPackageItineraryHandler(request(SLUG, body()), res),
      /commit failed/,
    );

    const afterCommit = calls.slice(calls.indexOf('COMMIT') + 1);
    assert.deepEqual(afterCommit, [], 'no statement is sent after a failed COMMIT');
    assert.equal(discarded, true, 'the connection is poisoned rather than reused');
  });
});

describe('admin package itinerary: response', () => {
  it('answers with the whole journey under data, and nothing else', async () => {
    storedJourney({ sections: [] });

    const captured = await replaceItinerary(SLUG, body());

    assert.deepEqual(Object.keys(captured.body as object), ['data']);
    assert.equal(dataOf(captured).slug, SLUG);
  });

  it('leaks no database id, position or raw ownership column', async () => {
    storedJourney({ seedManaged: true, sections: [] });

    const captured = await replaceItinerary(SLUG, body());
    const serialized = JSON.stringify(captured.body);

    for (const leaked of ['"id"', 'seed_managed', 'seedManaged', 'package_id', 'sort_order',
      'day_number']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not appear in the response`);
    }

    // `sortOrder` IS a field of the journey — its own place in the catalogue
    // running order — so the check is scoped: no itinerary SECTION carries a
    // position, because its order is its position in the array.
    for (const entry of itineraryOf(captured)) {
      assert.deepEqual(Object.keys(entry).sort(), ['body', 'dayNumber', 'heading']);
    }
  });
});
