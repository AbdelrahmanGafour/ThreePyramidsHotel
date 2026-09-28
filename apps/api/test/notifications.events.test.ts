import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPackageReservationConfirmedEvent,
  buildPackageReservationCreatedEvent,
  buildRoomReservationConfirmedEvent,
  buildRoomReservationCreatedEvent,
} from '../src/modules/notifications/notifications.events';
import type {
  NotificationEvent,
  PackageReservationConfirmedInput,
  PackageReservationCreatedInput,
  RoomReservationConfirmedInput,
  RoomReservationCreatedInput,
} from '../src/modules/notifications/notifications.types';

// The event domain is pure, so this suite needs nothing: no database, no
// server, no clock control, no fixtures beyond plain objects. If any of that
// were ever required here it would mean the builders had stopped being pure.
//
// What is actually under test is not arithmetic — the builders barely compute.
// It is the four contracts a stored row must satisfy for the rest of the
// notification stack to be safe:
//
//   * the event/template/recipient triple, because the dispatcher renders from
//     `template_key` and addresses from `recipient_kind`, and a mismatch would
//     send the wrong message or send it to nobody;
//   * what a payload is allowed to contain, because it is written to `jsonb`
//     and read back months later by a renderer that cannot ask for anything
//     else;
//   * determinism, because every retry rebuilds the provider request from the
//     stored row under one idempotency key;
//   * that building an event changes nothing, because these run inside a
//     reservation transaction.

const GUEST_EMAIL = 'guest@example.test';
const ROOM_REFERENCE = 'TPH-A2B3C4D5E6F7';
const PACKAGE_REFERENCE = 'TPH-J8K9L2M3N4P5';

/**
 * A value that must never reach an event.
 *
 * Distinctive so it can be looked for in the serialised row, not just in key
 * names — a leak under an expected key would pass a key-list assertion.
 */
const PLANTED = 'planted-internal-value';

/**
 * Widens an input with the things its flow really does have in scope.
 *
 * Every builder is called from somewhere holding far more than a message needs:
 * row ids, slugs, variant keys, whole ORM-ish objects. This reproduces that, so
 * the tests below are checking what the builders EXCLUDE and not merely what a
 * hand-written fixture happened to omit. The cast is the point — these fields
 * are deliberately not on the input types.
 */
function withSurroundingScope<TInput>(input: TInput): TInput {
  return {
    ...input,
    id: PLANTED,
    roomTypeId: PLANTED,
    roomId: PLANTED,
    packageId: PLANTED,
    variantId: PLANTED,
    roomTypeSlug: PLANTED,
    packageSlug: PLANTED,
    variantKey: PLANTED,
    passwordHash: PLANTED,
  } as TInput;
}

const roomCreatedInput: RoomReservationCreatedInput = withSurroundingScope({
  bookingReference: ROOM_REFERENCE,
  guestFirstName: 'Amina',
  guestLastName: 'Khalil',
  guestEmail: GUEST_EMAIL,
  guestPhone: '+20 100 000 0000',
  guestCountry: 'EG',
  roomTypeName: 'Nile View Suite',
  checkIn: '2026-04-10',
  checkOut: '2026-04-13',
  nights: 3,
  adults: 2,
  children: 1,
  nightlyRate: '4200.00',
  totalAmount: '12600.00',
  specialRequests: 'Late arrival, around 23:00.',
});

const roomConfirmedInput: RoomReservationConfirmedInput = withSurroundingScope({
  bookingReference: ROOM_REFERENCE,
  guestFirstName: 'Amina',
  guestLastName: 'Khalil',
  guestEmail: GUEST_EMAIL,
  roomTypeName: 'Nile View Suite',
  checkIn: '2026-04-10',
  checkOut: '2026-04-13',
  nights: 3,
  adults: 2,
  children: 1,
  nightlyRate: '4200.00',
  totalAmount: '12600.00',
  specialRequests: 'Late arrival, around 23:00.',
});

const packageCreatedInput: PackageReservationCreatedInput = withSurroundingScope({
  bookingReference: PACKAGE_REFERENCE,
  guestFirstName: 'Tomas',
  guestLastName: 'Novak',
  guestEmail: GUEST_EMAIL,
  guestPhone: '+420 600 000 000',
  guestCountry: 'CZ',
  packageCode: 'TPJ-001',
  packageTitle: 'Giza Plateau at Dawn',
  variantLabel: 'Private tour',
  tourDate: '2026-05-02',
  adults: 2,
  children: 2,
  childAges: [7, 11],
  pricingStatus: 'quoted',
  adultUnitRate: '180.00',
  childUnitRate: '90.00',
  totalAmount: '540.00',
  specialRequests: null,
});

const packageConfirmedInput: PackageReservationConfirmedInput = withSurroundingScope({
  bookingReference: PACKAGE_REFERENCE,
  guestFirstName: 'Tomas',
  guestLastName: 'Novak',
  guestEmail: GUEST_EMAIL,
  packageTitle: 'Giza Plateau at Dawn',
  variantLabel: 'Private tour',
  tourDate: '2026-05-02',
  adults: 2,
  children: 2,
  pricingStatus: 'quoted',
  adultUnitRate: '180.00',
  childUnitRate: '90.00',
  totalAmount: '540.00',
  specialRequests: null,
});

/**
 * Every RESERVATION event, beside the input it was built from.
 *
 * Narrowed to exclude the contact event deliberately. This suite is about the
 * four events that describe a booking, and they share a payload shape — a
 * `bookingReference` in both the column and the payload — that a contact
 * inquiry does not have. The contact event has its own suite.
 */
const ALL_EVENTS: ReadonlyArray<{
  readonly label: string;
  readonly event: Exclude<NotificationEvent, { eventType: 'contact_inquiry_received' }>;
  readonly input: unknown;
}> = [
  {
    label: 'room_reservation_created',
    event: buildRoomReservationCreatedEvent(roomCreatedInput),
    input: roomCreatedInput,
  },
  {
    label: 'room_reservation_confirmed',
    event: buildRoomReservationConfirmedEvent(roomConfirmedInput),
    input: roomConfirmedInput,
  },
  {
    label: 'package_reservation_created',
    event: buildPackageReservationCreatedEvent(packageCreatedInput),
    input: packageCreatedInput,
  },
  {
    label: 'package_reservation_confirmed',
    event: buildPackageReservationConfirmedEvent(packageConfirmedInput),
    input: packageConfirmedInput,
  },
];

/** Rebuilds each event from the same input, for the determinism checks. */
function rebuildAll(): ReadonlyArray<{ label: string; event: NotificationEvent }> {
  return [
    { label: 'room_reservation_created', event: buildRoomReservationCreatedEvent(roomCreatedInput) },
    { label: 'room_reservation_confirmed', event: buildRoomReservationConfirmedEvent(roomConfirmedInput) },
    { label: 'package_reservation_created', event: buildPackageReservationCreatedEvent(packageCreatedInput) },
    {
      label: 'package_reservation_confirmed',
      event: buildPackageReservationConfirmedEvent(packageConfirmedInput),
    },
  ];
}

const keysOf = (value: object): string[] => Object.keys(value).sort();

describe('notification event identity', () => {
  // The triple the whole dispatcher depends on. Written out per event rather
  // than derived from a table, so a wrong template key has to be wrong here
  // too before these pass.
  it('pairs each event type with one template key and one recipient kind', () => {
    const created = buildRoomReservationCreatedEvent(roomCreatedInput);
    assert.equal(created.eventType, 'room_reservation_created');
    assert.equal(created.recipientKind, 'hotel');
    assert.equal(created.templateKey, 'room_created_hotel.v1');

    const confirmed = buildRoomReservationConfirmedEvent(roomConfirmedInput);
    assert.equal(confirmed.eventType, 'room_reservation_confirmed');
    assert.equal(confirmed.recipientKind, 'guest');
    assert.equal(confirmed.templateKey, 'room_confirmed_guest.v1');

    const packageCreated = buildPackageReservationCreatedEvent(packageCreatedInput);
    assert.equal(packageCreated.eventType, 'package_reservation_created');
    assert.equal(packageCreated.recipientKind, 'hotel');
    assert.equal(packageCreated.templateKey, 'package_created_hotel.v1');

    const packageConfirmed = buildPackageReservationConfirmedEvent(packageConfirmedInput);
    assert.equal(packageConfirmed.eventType, 'package_reservation_confirmed');
    assert.equal(packageConfirmed.recipientKind, 'guest');
    assert.equal(packageConfirmed.templateKey, 'package_confirmed_guest.v1');
  });

  it('gives every event exactly the six columns the outbox takes at insert', () => {
    // Not "at least these": exactly these. A seventh field would be dispatch
    // state, and this layer has no business holding any.
    for (const { label, event } of ALL_EVENTS) {
      assert.deepEqual(
        keysOf(event),
        ['bookingReference', 'eventType', 'payload', 'recipientEmail', 'recipientKind', 'templateKey'],
        `${label} must carry exactly the six insert columns`,
      );
    }
  });

  it('carries the booking reference at both levels, identically', () => {
    // The column is what the unique constraint and the idempotency key use; the
    // payload copy is what the template prints. They must never disagree.
    for (const { label, event } of ALL_EVENTS) {
      assert.equal(
        event.payload.bookingReference,
        event.bookingReference,
        `${label} must print the reference it is keyed by`,
      );
    }
  });

  it('uses a versioned template key for all four', () => {
    for (const { label, event } of ALL_EVENTS) {
      assert.match(event.templateKey, /\.v\d+$/, `${label} must name a template version`);
    }
  });
});

describe('notification recipients', () => {
  it('leaves a hotel event unaddressed', () => {
    // The hotel's address is deployment configuration. Resolving it here would
    // let an unset mail setting refuse a booking, so the column stays null and
    // the dispatcher fills the envelope on its first claim.
    assert.equal(buildRoomReservationCreatedEvent(roomCreatedInput).recipientEmail, null);
    assert.equal(buildPackageReservationCreatedEvent(packageCreatedInput).recipientEmail, null);
  });

  it('snapshots the guest address on a guest event', () => {
    assert.equal(buildRoomReservationConfirmedEvent(roomConfirmedInput).recipientEmail, GUEST_EMAIL);
    assert.equal(buildPackageReservationConfirmedEvent(packageConfirmedInput).recipientEmail, GUEST_EMAIL);
  });

  it('agrees with the schema constraint on which kind carries an address', () => {
    // The mirror of `notification_outbox_recipient_pairing_check`. A builder
    // producing a shape the database rejects would abort a reservation.
    for (const { label, event } of ALL_EVENTS) {
      assert.equal(
        event.recipientKind === 'guest',
        event.recipientEmail !== null,
        `${label} must satisfy the recipient pairing rule`,
      );
    }
  });

  it('puts the guest email in a hotel payload and never in a guest one', () => {
    // Two different roles for one address. On a hotel notification it is
    // content, because acting on the message means replying to the guest. On a
    // guest notification it is only the destination, and a confirmation does
    // not read somebody their own address back.
    assert.equal(buildRoomReservationCreatedEvent(roomCreatedInput).payload.guestEmail, GUEST_EMAIL);
    assert.equal(buildPackageReservationCreatedEvent(packageCreatedInput).payload.guestEmail, GUEST_EMAIL);

    for (const builder of [
      () => buildRoomReservationConfirmedEvent(roomConfirmedInput),
      () => buildPackageReservationConfirmedEvent(packageConfirmedInput),
    ]) {
      const { payload } = builder();

      assert.ok(!('guestEmail' in payload), 'a guest payload must not repeat the address');
      assert.ok(
        !JSON.stringify(payload).includes(GUEST_EMAIL),
        'a guest payload must not carry the address under any other field',
      );
    }
  });

  it('keeps the guest phone and country to hotel events', () => {
    // Contact details the hotel needs and the guest already has.
    for (const payload of [
      buildRoomReservationConfirmedEvent(roomConfirmedInput).payload,
      buildPackageReservationConfirmedEvent(packageConfirmedInput).payload,
    ]) {
      assert.ok(!('guestPhone' in payload));
      assert.ok(!('guestCountry' in payload));
    }
  });
});

describe('notification payload contents', () => {
  // The exact field list per event. This is the renderer's contract: a template
  // for a given key may read these and nothing else, and a queued row written
  // before a change still holds only these. Adding a field is a deliberate act
  // that has to be made here first.
  it('builds the room creation payload from the booking facts only', () => {
    assert.deepEqual(keysOf(buildRoomReservationCreatedEvent(roomCreatedInput).payload), [
      'adults',
      'bookingReference',
      'checkIn',
      'checkOut',
      'children',
      'currency',
      'guestCountry',
      'guestEmail',
      'guestFirstName',
      'guestLastName',
      'guestPhone',
      'nightlyRate',
      'nights',
      'roomTypeName',
      'specialRequests',
      'totalAmount',
    ]);
  });

  it('builds the room confirmation payload without contact details', () => {
    assert.deepEqual(keysOf(buildRoomReservationConfirmedEvent(roomConfirmedInput).payload), [
      'adults',
      'bookingReference',
      'checkIn',
      'checkOut',
      'children',
      'currency',
      'guestFirstName',
      'guestLastName',
      'nightlyRate',
      'nights',
      'roomTypeName',
      'specialRequests',
      'totalAmount',
    ]);
  });

  it('builds the journey creation payload from the booking facts only', () => {
    assert.deepEqual(keysOf(buildPackageReservationCreatedEvent(packageCreatedInput).payload), [
      'adultUnitRate',
      'adults',
      'bookingReference',
      'childAges',
      'childUnitRate',
      'children',
      'currency',
      'guestCountry',
      'guestEmail',
      'guestFirstName',
      'guestLastName',
      'guestPhone',
      'packageCode',
      'packageTitle',
      'pricingStatus',
      'specialRequests',
      'totalAmount',
      'tourDate',
      'variantLabel',
    ]);
  });

  it('builds the journey confirmation payload without contact details or the code', () => {
    assert.deepEqual(keysOf(buildPackageReservationConfirmedEvent(packageConfirmedInput).payload), [
      'adultUnitRate',
      'adults',
      'bookingReference',
      'childUnitRate',
      'children',
      'currency',
      'guestFirstName',
      'guestLastName',
      'packageTitle',
      'pricingStatus',
      'specialRequests',
      'totalAmount',
      'tourDate',
      'variantLabel',
    ]);
  });

  it('stamps the currency each flow actually prices in', () => {
    assert.equal(buildRoomReservationCreatedEvent(roomCreatedInput).payload.currency, 'EGP');
    assert.equal(buildRoomReservationConfirmedEvent(roomConfirmedInput).payload.currency, 'EGP');
    assert.equal(buildPackageReservationCreatedEvent(packageCreatedInput).payload.currency, 'USD');
    assert.equal(buildPackageReservationConfirmedEvent(packageConfirmedInput).payload.currency, 'USD');
  });

  it('carries money as the exact strings it was given', () => {
    // Never numbers. A total parsed to a float and printed back could show a
    // guest a different figure from the one the database holds.
    const room = buildRoomReservationCreatedEvent(roomCreatedInput).payload;
    assert.equal(room.nightlyRate, '4200.00');
    assert.equal(room.totalAmount, '12600.00');

    const journey = buildPackageReservationCreatedEvent(packageCreatedInput).payload;
    assert.equal(journey.adultUnitRate, '180.00');
    assert.equal(journey.childUnitRate, '90.00');
    assert.equal(journey.totalAmount, '540.00');
  });

  it('preserves an unpriced journey booking as unpriced', () => {
    // `requires_confirmation` with no total is the operative case for the
    // hotel: somebody has to quote it. Nothing may substitute a zero.
    const { payload } = buildPackageReservationCreatedEvent({
      ...packageCreatedInput,
      pricingStatus: 'requires_confirmation',
      childUnitRate: null,
      totalAmount: null,
    });

    assert.equal(payload.pricingStatus, 'requires_confirmation');
    assert.equal(payload.childUnitRate, null);
    assert.equal(payload.totalAmount, null);
  });

  it('keeps null child ages distinct from an empty list', () => {
    // Two different facts: "exact child pricing never needed ages" and "no
    // child has an age". Collapsing them would misreport a booking.
    assert.deepEqual(
      buildPackageReservationCreatedEvent({ ...packageCreatedInput, childAges: null }).payload.childAges,
      null,
    );
    assert.deepEqual(
      buildPackageReservationCreatedEvent({ ...packageCreatedInput, childAges: [] }).payload.childAges,
      [],
    );
    assert.deepEqual(
      buildPackageReservationCreatedEvent(packageCreatedInput).payload.childAges,
      [7, 11],
      'ages keep the order the guest gave them',
    );
  });

  it('preserves an absent special request as null', () => {
    assert.equal(
      buildRoomReservationCreatedEvent({ ...roomCreatedInput, specialRequests: null }).payload.specialRequests,
      null,
    );
    assert.equal(
      buildRoomReservationConfirmedEvent(roomConfirmedInput).payload.specialRequests,
      'Late arrival, around 23:00.',
      'a confirmation echoes back what the hotel recorded',
    );
  });
});

describe('notification payload exclusions', () => {
  it('leaks nothing from the surrounding scope', () => {
    // The inputs above all carry planted ids, slugs, a variant key and a
    // password hash. None of it may appear anywhere in a serialised event,
    // under any key — the builders name every field rather than spreading, and
    // this is what proves it.
    for (const { label, event } of ALL_EVENTS) {
      assert.ok(
        !JSON.stringify(event).includes(PLANTED),
        `${label} leaked a value from the surrounding scope`,
      );
    }
  });

  it('carries no internal identifier under any name', () => {
    for (const { label, event } of ALL_EVENTS) {
      for (const key of [...Object.keys(event), ...Object.keys(event.payload)]) {
        assert.doesNotMatch(
          key,
          /^id$|Id$/,
          `${label} must not expose an internal identifier (${key})`,
        );
      }
    }
  });

  it('carries no rendered message, no envelope and no provider field', () => {
    // A row says what a notification IS. What it looked like is rendered at
    // send time, the envelope is resolved at claim time, and the provider is
    // not this layer's concern at all.
    const forbidden = [
      'subject',
      'html',
      'text',
      'body',
      'from',
      'to',
      'cc',
      'bcc',
      'replyTo',
      'provider',
      'providerReference',
      'apiKey',
      'idempotencyKey',
      'resolvedFrom',
      'resolvedTo',
      'attempts',
      'nextAttemptAt',
      'lastAttemptAt',
      'lastAttemptAcceptance',
      'lastError',
      'acceptedAt',
      'failedAt',
      'status',
      'createdAt',
      'updatedAt',
    ];

    for (const { label, event } of ALL_EVENTS) {
      const keys = new Set([...Object.keys(event), ...Object.keys(event.payload)]);

      for (const field of forbidden) {
        assert.ok(!keys.has(field), `${label} must not carry ${field}`);
      }
    }
  });

  it('never names the room type or journey by its address', () => {
    // A slug and a variant key are how code finds a thing. A name, a title and
    // a label are what a person reads.
    for (const { label, event } of ALL_EVENTS) {
      const keys = new Set(Object.keys(event.payload));

      for (const field of ['roomTypeSlug', 'packageSlug', 'variantKey']) {
        assert.ok(!keys.has(field), `${label} must not carry ${field}`);
      }
    }
  });
});

describe('notification event purity', () => {
  it('builds the same event every time from the same input', () => {
    // The guarantee every retry rests on: the provider request is rebuilt from
    // the stored row under one idempotency key, so two builds that differed
    // would turn a legitimate retry into a rejected conflicting replay.
    const first = rebuildAll();
    const second = rebuildAll();

    for (let index = 0; index < first.length; index += 1) {
      assert.deepEqual(second[index]?.event, first[index]?.event, `${first[index]?.label} is not deterministic`);
      // Serialised too, so key order is stable and not just the contents.
      assert.equal(
        JSON.stringify(second[index]?.event),
        JSON.stringify(first[index]?.event),
        `${first[index]?.label} serialises differently between builds`,
      );
    }
  });

  it('returns a fresh object graph each time', () => {
    // No shared reference anywhere, so nothing a caller does to one event can
    // reach another — or reach the input it came from.
    const first = buildPackageReservationCreatedEvent(packageCreatedInput);
    const second = buildPackageReservationCreatedEvent(packageCreatedInput);

    assert.notEqual(first, second);
    assert.notEqual(first.payload, second.payload);
    assert.notEqual(first.payload.childAges, second.payload.childAges);
    assert.notEqual(
      first.payload.childAges,
      packageCreatedInput.childAges,
      'the ages array must be copied, not borrowed from the caller',
    );
  });

  it('does not touch the input it was given', () => {
    // These run inside the reservation transaction, on objects that flow is
    // still using. Building an event must be an observation, not a step.
    for (const { label, input } of ALL_EVENTS) {
      const before = JSON.stringify(input);

      buildRoomReservationCreatedEvent(roomCreatedInput);
      buildRoomReservationConfirmedEvent(roomConfirmedInput);
      buildPackageReservationCreatedEvent(packageCreatedInput);
      buildPackageReservationConfirmedEvent(packageConfirmedInput);

      assert.equal(JSON.stringify(input), before, `${label} input was mutated`);
    }
  });

  it('reads no clock, no configuration and no randomness', async () => {
    // Asserted against the source, because purity is an absence and absence
    // cannot be observed by calling a function. A clock or a config read here
    // would be the two failures this design exists to prevent: an email
    // concern able to refuse a booking, and two attempts that differ.
    const { readFileSync } = await import('node:fs');

    for (const file of [
      'src/modules/notifications/notifications.events.ts',
      'src/modules/notifications/notifications.types.ts',
    ]) {
      // Comments discuss all of these by name, so only code is scanned.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

      for (const forbidden of [
        'process.env',
        'new Date',
        'Date.now',
        'Math.random',
        'randomUUID',
        'toLocale',
        'Intl.',
        'dbPool',
        'require(',
        'import(',
      ]) {
        assert.ok(!code.includes(forbidden), `${file} must not use ${forbidden}`);
      }
    }
  });

  it('imports nothing but its own types', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.events.ts', 'utf8');
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

    assert.deepEqual(
      imports,
      ['./notifications.types'],
      'the event domain must depend on nothing — not the reservation modules, not the database, not a mailer',
    );
  });

  it('has no runtime dependency on the types module at all', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.events.ts', 'utf8');

    // `import type` only, so the compiled CommonJS emits no require and the
    // module is genuinely standalone at runtime.
    assert.match(code, /^import type \{/, 'the one import must be type-only');
  });
});
