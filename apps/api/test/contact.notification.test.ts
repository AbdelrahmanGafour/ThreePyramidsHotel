import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildContactInquiryReceivedNotification } from '../src/modules/notifications/notifications.events';
import {
  renderNotificationEmail,
  UnsupportedNotificationTemplateError,
} from '../src/modules/notifications/notifications.templates';
import type { NotificationTemplateKey } from '../src/modules/notifications/notifications.types';

// The contact inquiry's event and its template.
//
// This is the only notification whose content came from an anonymous stranger
// rather than from a booking this system created, and the only one whose
// outbox row is the sole copy of what it describes. Both facts shape what is
// tested: the escaping cases carry more weight here than anywhere else, and
// the payload has to be complete because nothing else stores it.

const REFERENCE = 'TPC-A2B3C4D5E6F7';

const INPUT: {
  reference: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  inquiryType: string;
  message: string;
} = {
  reference: REFERENCE,
  firstName: 'Amina',
  lastName: 'Khalil',
  email: 'amina@example.test',
  phone: '+20 100 000 0000',
  inquiryType: 'Room reservation',
  message: 'Do you have a room with a view of the plateau in April?',
};

const render = (input = INPUT) =>
  renderNotificationEmail(
    'contact_received_hotel.v1',
    buildContactInquiryReceivedNotification(input).payload,
  );

describe('the contact inquiry event', () => {
  it('carries the contact identity, addressed to the hotel', () => {
    const event = buildContactInquiryReceivedNotification(INPUT);

    assert.equal(event.eventType, 'contact_inquiry_received');
    assert.equal(event.recipientKind, 'hotel');
    assert.equal(event.recipientEmail, null, 'the hotel address is the dispatcher to resolve');
    assert.equal(event.templateKey, 'contact_received_hotel.v1');
  });

  it('uses the inquiry reference as the booking reference', () => {
    // Reuse of an existing column, not a claim that an inquiry is a booking.
    const event = buildContactInquiryReceivedNotification(INPUT);

    assert.equal(event.bookingReference, REFERENCE);
    assert.equal(event.payload.reference, REFERENCE);
  });

  it('carries exactly the seven fields the email needs', () => {
    const event = buildContactInquiryReceivedNotification(INPUT);

    assert.deepEqual(Object.keys(event.payload).sort(), [
      'email',
      'firstName',
      'inquiryType',
      'lastName',
      'message',
      'phone',
      'reference',
    ]);
  });

  it('gives the event exactly the six columns the outbox takes at insert', () => {
    const event = buildContactInquiryReceivedNotification(INPUT);

    assert.deepEqual(Object.keys(event).sort(), [
      'bookingReference',
      'eventType',
      'payload',
      'recipientEmail',
      'recipientKind',
      'templateKey',
    ]);
  });

  it('keeps the visitor address as content, because somebody must reply to it', () => {
    // The opposite of a guest confirmation: there is no autoresponder, so this
    // address is never used as a destination, only read by the hotel.
    const event = buildContactInquiryReceivedNotification(INPUT);

    assert.equal(event.payload.email, 'amina@example.test');
    assert.equal(event.recipientEmail, null);
  });

  it('preserves a null phone as null', () => {
    assert.equal(buildContactInquiryReceivedNotification({ ...INPUT, phone: null }).payload.phone, null);
  });

  it('is deterministic, byte for byte', () => {
    const first = buildContactInquiryReceivedNotification(INPUT);
    const second = buildContactInquiryReceivedNotification(INPUT);

    assert.deepEqual(second, first);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
    assert.notEqual(second, first, 'a fresh object each time');
    assert.notEqual(second.payload, first.payload);
  });

  it('does not mutate the input it was given', () => {
    const before = JSON.stringify(INPUT);

    buildContactInquiryReceivedNotification(INPUT);

    assert.equal(JSON.stringify(INPUT), before);
  });

  it('carries no honeypot and no internal identifier', () => {
    // The honeypot is not on the input type, so it cannot reach a payload even
    // by accident. Asserted anyway, along with anything id-shaped.
    const widened = { ...INPUT, website: 'http://spam.example', id: 99, createdAt: 'now' };
    const event = buildContactInquiryReceivedNotification(widened);
    const serialised = JSON.stringify(event);

    assert.equal(serialised.includes('website'), false);
    assert.equal(serialised.includes('spam.example'), false);
    assert.equal(serialised.includes('createdAt'), false);
    for (const key of Object.keys(event.payload)) {
      assert.doesNotMatch(key, /^id$|Id$/, `${key} looks like an identifier`);
    }
  });
});

describe('the contact inquiry template', () => {
  it('renders a subject, html and text', () => {
    const email = render();

    assert.equal(email.subject, `New contact inquiry: ${REFERENCE}`);
    assert.match(email.html, /^<!DOCTYPE html>/);
    assert.ok(email.text.length > 0);
  });

  it('tells the hotel who wrote, about what, and what they said', () => {
    const { html, text } = render();

    for (const fact of [
      REFERENCE,
      'Amina',
      'Khalil',
      'amina@example.test',
      '+20 100 000 0000',
      'Room reservation',
      'Do you have a room with a view of the plateau in April?',
    ]) {
      assert.ok(text.includes(fact), `text is missing ${fact}`);
      assert.ok(html.includes(fact), `html is missing ${fact}`);
    }
    assert.match(text, /New contact inquiry/);
  });

  it('says so plainly when no phone was given', () => {
    const { html, text } = render({ ...INPUT, phone: null });

    assert.ok(text.includes('Phone: Not provided'), 'the reader is deciding how to reply');
    assert.ok(html.includes('Not provided'));
    assert.equal(text.includes('null'), false, 'no raw null reached the reader');
    assert.equal(text.includes('undefined'), false);
  });

  it('keeps the message readable across line breaks', () => {
    const message = 'First question.\n\nSecond question.\nThird question.';
    const { html, text } = render({ ...INPUT, message });

    // Text keeps the newlines exactly as typed.
    assert.ok(text.includes(message), 'the text part preserves the message verbatim');
    // HTML turns them into breaks, so the paragraph does not collapse.
    assert.ok(html.includes('<br />'), 'the html part preserves them as breaks');
    assert.ok(html.includes('First question.'));
    assert.ok(html.includes('Third question.'));
  });

  it('escapes every visitor-supplied field in the html', () => {
    // The highest-value test in this file: all of this came from a stranger.
    const hostile = '<script>alert("x")</script> & \'q\' "d"';
    const { html } = render({
      ...INPUT,
      firstName: `<b>${hostile}`,
      lastName: '</b>',
      email: '<i>a@b.test</i>',
      phone: '<em>+20</em>',
      inquiryType: '<u>Room reservation</u>',
      message: hostile,
    });

    for (const tag of ['<script>', '<b>', '</b>', '<i>', '<em>', '<u>']) {
      assert.equal(html.includes(tag), false, `${tag} must not survive`);
    }
    assert.ok(html.includes('&lt;script&gt;'), 'it is there, as text');
    assert.ok(html.includes('&amp;'));
    assert.ok(html.includes('&#39;q&#39;'));
    assert.ok(html.includes('&quot;d&quot;'));
  });

  it('escapes a hostile reference too', () => {
    // It reaches the subject as well as the body, so both are checked.
    const { html, subject } = render({ ...INPUT, reference: '<b>TPC-X</b>' });

    assert.equal(html.includes('<b>TPC-X</b>'), false);
    assert.ok(html.includes('&lt;b&gt;TPC-X&lt;/b&gt;'));
    // A subject is a mail header, not HTML, so it is not escaped — but it must
    // stay a single line.
    assert.doesNotMatch(subject, /[\r\n]/);
  });

  it('writes no markup of its own into the text body', () => {
    const { text } = render();

    assert.doesNotMatch(text, /<[a-zA-Z/!]/, 'the text part carries no renderer markup');
    assert.equal(text.includes('&amp;'), false, 'and is not HTML-escaped');
  });

  it('passes a hostile message through the text body verbatim', () => {
    // Text is not HTML; escaping it would show the reader `&amp;` in the
    // visitor's own words.
    const message = '<script>alert(1)</script> & co.';
    const { text } = render({ ...INPUT, message });

    assert.ok(text.includes(message));
    assert.equal(text.includes('&lt;'), false);
  });

  it('renders deterministically', () => {
    assert.deepEqual(render(), render());
  });

  it('leaks no honeypot, id or internal field', () => {
    const email = render();
    const rendered = `${email.subject}\n${email.html}\n${email.text}`;

    // Checked by VALUE, not by the word: the template's own prose says a
    // visitor wrote "through the website", which is not a leak of the field
    // named `website`.
    const withHoneypot = renderNotificationEmail(
      'contact_received_hotel.v1',
      buildContactInquiryReceivedNotification({
        ...INPUT,
        website: 'http://spam.example',
        id: 99,
      } as typeof INPUT).payload,
    );
    const everything = `${withHoneypot.subject}
${withHoneypot.html}
${withHoneypot.text}`;

    assert.equal(everything.includes('spam.example'), false, 'the honeypot value must not render');
    for (const forbidden of ['honeypot', 'createdAt', 'inquiryId']) {
      assert.equal(rendered.includes(forbidden), false, `must not carry ${forbidden}`);
    }
  });

  it('still fails closed on a template it does not know', () => {
    assert.throws(
      () =>
        renderNotificationEmail(
          'contact_received_hotel.v2' as NotificationTemplateKey,
          buildContactInquiryReceivedNotification(INPUT).payload as never,
        ),
      UnsupportedNotificationTemplateError,
    );
  });
});
