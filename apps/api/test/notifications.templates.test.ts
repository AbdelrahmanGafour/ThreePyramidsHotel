import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  renderNotificationEmail,
  UnsupportedNotificationTemplateError,
  type NotificationTemplatePayload,
} from '../src/modules/notifications/notifications.templates';
import type { NotificationTemplateKey } from '../src/modules/notifications/notifications.types';

// The renderer, which is pure and therefore needs nothing: no database, no
// server, no clock control.
//
// Two things are really under test. The first is that each template says the
// right thing — the right subject, the business facts a reader needs, and
// nothing that belongs to the other audience. The second, and the one that
// would hurt most if it were wrong, is that a guest cannot put markup into an
// email the hotel opens. Every string in a payload is attacker-influenced:
// names, special requests, even a package title an administrator typed.

const ROOM_REFERENCE = 'TPH-A2B3C4D5E6F7';
const PACKAGE_REFERENCE = 'TPP-J8K9L2M3N4P5';
const GUEST_EMAIL = 'amina@example.test';

const roomCreated: NotificationTemplatePayload['room_created_hotel.v1'] = {
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
  currency: 'EGP',
  specialRequests: 'Late arrival, around 23:00.',
};

const roomConfirmed: NotificationTemplatePayload['room_confirmed_guest.v1'] = {
  bookingReference: ROOM_REFERENCE,
  guestFirstName: 'Amina',
  guestLastName: 'Khalil',
  roomTypeName: 'Nile View Suite',
  checkIn: '2026-04-10',
  checkOut: '2026-04-13',
  nights: 3,
  adults: 2,
  children: 1,
  nightlyRate: '4200.00',
  totalAmount: '12600.00',
  currency: 'EGP',
  specialRequests: 'Late arrival, around 23:00.',
};

const packageCreated: NotificationTemplatePayload['package_created_hotel.v1'] = {
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
  currency: 'USD',
  specialRequests: null,
};

const packageConfirmed: NotificationTemplatePayload['package_confirmed_guest.v1'] = {
  bookingReference: PACKAGE_REFERENCE,
  guestFirstName: 'Tomas',
  guestLastName: 'Novak',
  packageTitle: 'Giza Plateau at Dawn',
  variantLabel: 'Private tour',
  tourDate: '2026-05-02',
  adults: 2,
  children: 2,
  pricingStatus: 'quoted',
  adultUnitRate: '180.00',
  childUnitRate: '90.00',
  totalAmount: '540.00',
  currency: 'USD',
  specialRequests: null,
};

/** Every template with a payload, for the checks that apply to all four. */
const ALL = [
  { key: 'room_created_hotel.v1', payload: roomCreated },
  { key: 'room_confirmed_guest.v1', payload: roomConfirmed },
  { key: 'package_created_hotel.v1', payload: packageCreated },
  { key: 'package_confirmed_guest.v1', payload: packageConfirmed },
] as const;

const renderAll = () =>
  ALL.map(({ key, payload }) => ({
    key,
    // Each pair is correlated by construction above; the call site cannot see
    // that, which is the one place this suite needs a cast.
    email: renderNotificationEmail(key, payload as never),
  }));

describe('every template renders', () => {
  it('produces a subject, an HTML body and a text body for all four keys', () => {
    for (const { key, email } of renderAll()) {
      assert.equal(typeof email.subject, 'string', key);
      assert.ok(email.subject.length > 0, `${key} has a subject`);
      assert.match(email.html, /^<!DOCTYPE html>/, `${key} renders a document`);
      assert.ok(email.text.length > 0, `${key} has a text body`);
    }
  });

  it('gives each template its own concise subject', () => {
    const subjects = Object.fromEntries(renderAll().map(({ key, email }) => [key, email.subject]));

    assert.deepEqual(subjects, {
      'room_created_hotel.v1': `New room reservation: ${ROOM_REFERENCE}`,
      'room_confirmed_guest.v1': `Your reservation is confirmed: ${ROOM_REFERENCE}`,
      'package_created_hotel.v1': `New Journey reservation: ${PACKAGE_REFERENCE}`,
      'package_confirmed_guest.v1': `Your Journey is confirmed: ${PACKAGE_REFERENCE}`,
    });
  });

  it('never puts a line break in a subject', () => {
    // A subject is a mail header. A CR or LF in one is header injection.
    for (const { key, email } of renderAll()) {
      assert.doesNotMatch(email.subject, /[\r\n]/, `${key} subject is a single line`);
    }
  });

  it('is deterministic, byte for byte', () => {
    // The guarantee every retry rests on: the provider request is rebuilt from
    // the stored row under one idempotency key, so two renders that differed
    // would turn a legitimate retry into a rejected replay.
    const first = renderAll();
    const second = renderAll();

    for (let index = 0; index < first.length; index += 1) {
      assert.deepEqual(second[index]?.email, first[index]?.email, `${first[index]?.key} is not deterministic`);
    }
  });

  it('fails closed on a template it does not know', () => {
    assert.throws(
      () => renderNotificationEmail('room_created_hotel.v2' as NotificationTemplateKey, roomCreated as never),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedNotificationTemplateError);
        assert.equal(error.templateKey, 'room_created_hotel.v2');
        return true;
      },
    );
  });

  it('fails closed on a key that would find something on the prototype', () => {
    // A bare lookup would return `Object.prototype.toString` here and render
    // whatever that produced. The guard is `hasOwnProperty`, not truthiness.
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.throws(
        () => renderNotificationEmail(key as NotificationTemplateKey, roomCreated as never),
        UnsupportedNotificationTemplateError,
        `${key} must not resolve to a template`,
      );
    }
  });
});

describe('the business facts each template carries', () => {
  it('tells the hotel everything it needs about a new room booking', () => {
    const { html, text } = renderNotificationEmail('room_created_hotel.v1', roomCreated);

    for (const fact of [
      ROOM_REFERENCE,
      'Nile View Suite',
      '2026-04-10',
      '2026-04-13',
      '3 nights',
      '2 adults, 1 child',
      '4200.00 EGP',
      '12600.00 EGP',
      'Late arrival, around 23:00.',
      GUEST_EMAIL,
      '+20 100 000 0000',
    ]) {
      assert.ok(text.includes(fact), `text is missing ${fact}`);
      assert.ok(html.includes(fact), `html is missing ${fact}`);
    }
    assert.match(text, /New room reservation/);
  });

  it('tells the guest their stay is confirmed, without their own contact details', () => {
    const { html, text } = renderNotificationEmail('room_confirmed_guest.v1', roomConfirmed);

    assert.match(text, /Your reservation is confirmed/);
    for (const fact of [ROOM_REFERENCE, 'Nile View Suite', '3 nights', '12600.00 EGP']) {
      assert.ok(text.includes(fact), `text is missing ${fact}`);
    }
    // Hotel-only fields. The payload has none of them; this proves the
    // template invented none either.
    for (const hotelOnly of [GUEST_EMAIL, '+20 100 000 0000', 'Email', 'Phone', 'Country']) {
      assert.ok(!text.includes(hotelOnly), `text must not carry ${hotelOnly}`);
      assert.ok(!html.includes(hotelOnly), `html must not carry ${hotelOnly}`);
    }
  });

  it('tells the hotel everything it needs about a new Journey booking', () => {
    const { text } = renderNotificationEmail('package_created_hotel.v1', packageCreated);

    for (const fact of [
      PACKAGE_REFERENCE,
      'TPJ-001',
      'Giza Plateau at Dawn',
      'Private tour',
      '2026-05-02',
      '2 adults, 2 children',
      '7, 11',
      'Quoted',
      '180.00 USD',
      '90.00 USD',
      '540.00 USD',
    ]) {
      assert.ok(text.includes(fact), `text is missing ${fact}`);
    }
    assert.match(text, /New Journey reservation/);
  });

  it('tells the guest their Journey is confirmed, without the code or contact details', () => {
    const { html, text } = renderNotificationEmail('package_confirmed_guest.v1', packageConfirmed);

    assert.match(text, /Your Journey is confirmed/);
    for (const fact of [PACKAGE_REFERENCE, 'Giza Plateau at Dawn', 'Private tour', '540.00 USD']) {
      assert.ok(text.includes(fact), `text is missing ${fact}`);
    }
    for (const withheld of ['TPJ-001', GUEST_EMAIL, '+420 600 000 000', 'Email', 'Phone']) {
      assert.ok(!text.includes(withheld), `text must not carry ${withheld}`);
      assert.ok(!html.includes(withheld), `html must not carry ${withheld}`);
    }
  });

  it('leaks no internal identifier, slug or variant key in any template', () => {
    // None is in any payload contract, so none can be rendered. Asserted
    // anyway, because this is the sort of thing a later "helpful" addition
    // would slip in.
    for (const { key, email } of renderAll()) {
      const rendered = `${email.subject}\n${email.html}\n${email.text}`;

      for (const value of ['packageSlug', 'roomTypeSlug', 'variantKey', 'variant_id', 'package_id']) {
        assert.ok(!rendered.includes(value), `${key} must not carry ${value}`);
      }
    }
  });
});

describe('payload values survive exactly as stored', () => {
  it('never reformats a decimal', () => {
    const { text } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      nightlyRate: '1234.50',
      totalAmount: '3703.50',
    });

    assert.ok(text.includes('1234.50 EGP'), 'the stored decimal, unchanged');
    assert.ok(text.includes('3703.50 EGP'));
    // Not parsed and re-printed: a float round-trip would produce these.
    assert.ok(!text.includes('1234.5 '), 'no trailing zero was dropped');
    assert.ok(!text.includes('3,703.50'), 'no locale grouping was added');
  });

  it('never reformats a date', () => {
    const { text } = renderNotificationEmail('package_created_hotel.v1', {
      ...packageCreated,
      tourDate: '2026-12-31',
    });

    assert.ok(text.includes('2026-12-31'), 'the calendar day, exactly as given');
  });

  it('keeps child ages in the order the guest gave them', () => {
    const { text } = renderNotificationEmail('package_created_hotel.v1', {
      ...packageCreated,
      childAges: [11, 3, 7],
    });

    assert.ok(text.includes('11, 3, 7'), 'not sorted, not reordered');
  });
});

describe('optional and missing values', () => {
  it('omits the special-requests section when there is none', () => {
    const { html, text } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      specialRequests: null,
    });

    assert.ok(!text.includes('SPECIAL REQUESTS'), 'no empty heading in text');
    assert.ok(!html.includes('Special requests'), 'no empty section in html');
  });

  it('omits it for whitespace too, rather than printing a blank box', () => {
    const { html } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      specialRequests: '   \n  ',
    });

    assert.ok(!html.includes('Special requests'));
  });

  it('omits child ages when there are none, and when the list is empty', () => {
    for (const childAges of [null, []]) {
      const { text } = renderNotificationEmail('package_created_hotel.v1', {
        ...packageCreated,
        childAges,
      });

      assert.ok(!text.includes('Child ages'), `no row for ${JSON.stringify(childAges)}`);
    }
  });

  it('says what a missing amount means instead of inventing one', () => {
    // `requires_confirmation` with no total is the operative case for the
    // hotel. A zero here would state a price nobody quoted.
    const { text } = renderNotificationEmail('package_created_hotel.v1', {
      ...packageCreated,
      pricingStatus: 'requires_confirmation',
      childUnitRate: null,
      totalAmount: null,
    });

    assert.ok(text.includes('Status: Awaiting confirmation'));
    assert.ok(text.includes('Child rate: Not applicable'));
    assert.ok(text.includes('Total: To be confirmed'));
    // Scoped to the two rows that have no amount: a bare `0.00` search would
    // match the adult rate of 180.00, which is a real quoted figure.
    assert.ok(!text.includes('Child rate: 0'), 'no child rate was invented');
    assert.ok(!text.includes('Total: 0'), 'no total was invented');
    assert.ok(!text.includes('null'), 'no raw null reached the reader');
    assert.ok(!text.includes('undefined'));
  });
});

describe('nothing a guest types can become markup', () => {
  const hostile =
    '<script>alert("xss")</script> & <img src=x onerror="steal()"> \'quoted\' "double"';

  it('escapes the five dangerous characters in HTML', () => {
    const { html } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      specialRequests: hostile,
    });

    assert.ok(!html.includes('<script>'), 'no script tag survived');
    assert.ok(!html.includes('<img'), 'no img tag survived');
    assert.ok(!html.includes('onerror="'), 'no event handler survived');
    assert.ok(html.includes('&lt;script&gt;'), 'it is there, as text');
    assert.ok(html.includes('&amp;'));
    assert.ok(html.includes('&#39;quoted&#39;'));
    assert.ok(html.includes('&quot;double&quot;'));
  });

  it('escapes a hostile name, room type and package title too', () => {
    // Special requests are the obvious vector; every other string is one as
    // well, and a name reaches the subject line's neighbourhood.
    const { html } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      guestFirstName: '<b>Amina',
      guestLastName: 'Khalil</b>',
      roomTypeName: '<i>Suite</i>',
    });

    assert.ok(!html.includes('<b>'), 'no injected bold');
    assert.ok(!html.includes('<i>'), 'no injected italic');
    assert.ok(html.includes('&lt;b&gt;Amina'));
    assert.ok(html.includes('&lt;i&gt;Suite&lt;/i&gt;'));
  });

  it('does not double-escape an ampersand', () => {
    const { html } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      roomTypeName: 'Bed & Breakfast',
    });

    assert.ok(html.includes('Bed &amp; Breakfast'));
    assert.ok(!html.includes('&amp;amp;'), 'escaped once, not twice');
  });

  it('turns newlines in a note into markup without trusting the text around them', () => {
    const { html } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      specialRequests: 'First line\n<script>bad()</script>\nThird line',
    });

    assert.ok(html.includes('<br />'), 'the newline became a break');
    assert.ok(!html.includes('<script>'), 'the content did not');
    assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  });

  it('writes no markup of its own into the text body', () => {
    // With a benign payload the text output has no angle brackets at all,
    // which is what proves the renderer contributes none.
    for (const { key, email } of renderAll()) {
      assert.doesNotMatch(email.text, /<[a-zA-Z/!]/, `${key} text contains renderer markup`);
      assert.ok(!email.text.includes('&amp;'), `${key} text must not be HTML-escaped`);
      assert.ok(!email.text.includes('style='), `${key} text carries no styling`);
    }
  });

  it('passes hostile text through the plain-text body verbatim', () => {
    // Text is not HTML, so escaping it would show the guest `&amp;` in their
    // own words. The characters stay as typed; there is no context for them
    // to escape from.
    const { text } = renderNotificationEmail('room_created_hotel.v1', {
      ...roomCreated,
      specialRequests: hostile,
    });

    assert.ok(text.includes(hostile), 'the request is readable exactly as written');
    assert.ok(!text.includes('&lt;'), 'and was not escaped into the text body');
  });

  it('never interpolates raw JSON', () => {
    for (const { key, email } of renderAll()) {
      assert.ok(!email.html.includes('{"'), `${key} html contains serialised JSON`);
      assert.ok(!email.text.includes('{"'), `${key} text contains serialised JSON`);
    }
  });
});

describe('purity', () => {
  it('does not mutate the payload it was given', () => {
    const before = JSON.stringify(packageCreated);

    renderNotificationEmail('package_created_hotel.v1', packageCreated);

    assert.equal(JSON.stringify(packageCreated), before);
  });

  it('reads no clock, environment, locale or randomness', async () => {
    // Asserted against the source: purity is an absence, and an absence
    // cannot be observed by calling a function.
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.templates.ts', 'utf8')
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
      'fetch(',
      'require(',
    ]) {
      assert.ok(!code.includes(forbidden), `the renderer must not use ${forbidden}`);
    }
  });
});
