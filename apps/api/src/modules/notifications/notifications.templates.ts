import type {
  ContactInquiryReceivedPayload,
  NotificationTemplateKey,
  PackageReservationConfirmedPayload,
  PackageReservationCreatedPayload,
  RoomReservationConfirmedPayload,
  RoomReservationCreatedPayload,
} from './notifications.types';

// Turning a stored notification into the words somebody reads.
//
// Pure, like the builders next door: no database, no `process.env`, no clock,
// no randomness, no network, no locale or timezone API. The same row renders
// byte for byte identically on any machine at any time — which is not a
// stylistic preference but the thing that makes retries safe. Every attempt
// rebuilds the provider request from the stored row under one idempotency
// key, and a renderer that consulted a clock or a locale would make two
// attempts differ and turn a legitimate retry into a rejected replay.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A DOCUMENT IN THE MIDDLE
//
// Each template builds an `EmailDocument` — a title, an introduction and a few
// labelled blocks — and two renderers turn that into HTML and into text. The
// templates never write markup.
//
// That is a security decision before it is a tidiness one. Four hand-written
// HTML strings would mean four places to remember to escape, and the first one
// anybody forgets is the one a guest controls. Here the templates deal only in
// plain strings, `toHtml` escapes every one of them on the way out, and
// `toText` writes no markup at all. Forgetting is not available.
//
// Nothing here resolves an address, names a provider, or knows what sending
// is. It is given a template key and a payload and it returns three strings.

/** What a template produces. Three strings, and nothing provider-shaped. */
export type RenderedNotificationEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

/**
 * A template key nothing here can render.
 *
 * Its own type so a caller can tell "this row names a template that does not
 * exist" from a genuine fault. Reaching it means a stored row carries a key
 * this deployment does not know — a version that was removed, or data from
 * somewhere it should not be — and the honest answer is to refuse rather than
 * to send a half-built message.
 */
export class UnsupportedNotificationTemplateError extends Error {
  constructor(readonly templateKey: string) {
    super(`Unsupported notification template: ${templateKey}`);
    this.name = 'UnsupportedNotificationTemplateError';
  }
}

// ---------------------------------------------------------------------------
// The document model
//
// Every string in here is RAW. Escaping belongs to the HTML renderer and
// nowhere else, so a template cannot double-escape or forget.
// ---------------------------------------------------------------------------

type DetailRow = { readonly label: string; readonly value: string };

type Block =
  /** Labelled facts, rendered as a table in HTML and `Label: value` in text. */
  | { readonly kind: 'details'; readonly heading: string; readonly rows: readonly DetailRow[] }
  /** Free text somebody typed. Always the most dangerous thing on the page. */
  | { readonly kind: 'note'; readonly heading: string; readonly body: string };

type EmailDocument = {
  readonly subject: string;
  readonly title: string;
  readonly intro: string;
  readonly blocks: readonly Block[];
};

// ---------------------------------------------------------------------------
// Formatting helpers. All total, all deterministic, none locale-aware.
// ---------------------------------------------------------------------------

/**
 * Collapses anything that could break out of a header into a single line.
 *
 * A subject is a mail header, not HTML, so escaping it would show a guest
 * `&amp;` where they should see `&`. What it must not contain is a line
 * break: a CR or LF in a header is how header injection works. Today every
 * subject is built from a booking reference that cannot contain one, and this
 * is here so that stays true if a subject ever carries a name.
 */
function headerSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim();
}

/**
 * The five characters that let a string stop being data inside HTML.
 *
 * `&` first, or the escapes below would be escaped again. Both quote styles
 * are covered because a value must stay inert even if it is ever placed in an
 * attribute.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `1 night` / `3 nights`. Plain English, no `Intl`. */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** `2 adults, 1 child`, with children omitted when there are none. */
function party(adults: number, children: number): string {
  const guests = [plural(adults, 'adult', 'adults')];

  if (children > 0) {
    guests.push(plural(children, 'child', 'children'));
  }

  return guests.join(', ');
}

/**
 * Money, exactly as stored.
 *
 * The amount is a string from a `numeric` column and is never parsed, never
 * rounded and never reformatted — a total put through a float could show
 * somebody a different figure from the one the hotel recorded.
 */
function money(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

/** A missing amount, said plainly rather than invented as 0. */
const NOT_APPLICABLE = 'Not applicable';
/** A detail the visitor chose not to give, which is different from one that does not apply. */
const NOT_PROVIDED = 'Not provided';
const AWAITING_CONFIRMATION = 'To be confirmed';

const PRICING_STATUS_LABEL = {
  quoted: 'Quoted',
  requires_confirmation: 'Awaiting confirmation',
} as const;

/** True for a value worth giving a section to. */
function hasText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/** The special-requests block, or nothing at all. */
function noteBlocks(specialRequests: string | null): Block[] {
  return hasText(specialRequests)
    ? [{ kind: 'note', heading: 'Special requests', body: specialRequests.trim() }]
    : [];
}

// ---------------------------------------------------------------------------
// The four templates
//
// Field names come from the payload contracts and nothing is invented. A hotel
// template carries the guest's contact details because acting on the message
// means replying to them; a guest template carries none, because the address
// is the envelope and the guest already has their own phone number.
// ---------------------------------------------------------------------------

function roomCreatedHotel(payload: RoomReservationCreatedPayload): EmailDocument {
  return {
    subject: `New room reservation: ${payload.bookingReference}`,
    title: 'New room reservation',
    intro: `${payload.guestFirstName} ${payload.guestLastName} has booked the ${payload.roomTypeName}.`,
    blocks: [
      {
        kind: 'details',
        heading: 'Booking',
        rows: [
          { label: 'Reference', value: payload.bookingReference },
          { label: 'Room type', value: payload.roomTypeName },
          { label: 'Check-in', value: payload.checkIn },
          { label: 'Check-out', value: payload.checkOut },
          { label: 'Nights', value: plural(payload.nights, 'night', 'nights') },
          { label: 'Guests', value: party(payload.adults, payload.children) },
        ],
      },
      {
        kind: 'details',
        heading: 'Guest',
        rows: [
          { label: 'Name', value: `${payload.guestFirstName} ${payload.guestLastName}` },
          { label: 'Email', value: payload.guestEmail },
          { label: 'Phone', value: payload.guestPhone },
          { label: 'Country', value: payload.guestCountry },
        ],
      },
      {
        kind: 'details',
        heading: 'Pricing',
        rows: [
          { label: 'Nightly rate', value: money(payload.nightlyRate, payload.currency) },
          { label: 'Total', value: money(payload.totalAmount, payload.currency) },
        ],
      },
      ...noteBlocks(payload.specialRequests),
    ],
  };
}

function roomConfirmedGuest(payload: RoomReservationConfirmedPayload): EmailDocument {
  return {
    subject: `Your reservation is confirmed: ${payload.bookingReference}`,
    title: 'Your reservation is confirmed',
    intro:
      `Dear ${payload.guestFirstName} ${payload.guestLastName}, we are delighted to confirm ` +
      `your stay at Three Pyramids Boutique Hotel.`,
    blocks: [
      {
        kind: 'details',
        heading: 'Your stay',
        rows: [
          { label: 'Reference', value: payload.bookingReference },
          { label: 'Room type', value: payload.roomTypeName },
          { label: 'Check-in', value: payload.checkIn },
          { label: 'Check-out', value: payload.checkOut },
          { label: 'Nights', value: plural(payload.nights, 'night', 'nights') },
          { label: 'Guests', value: party(payload.adults, payload.children) },
        ],
      },
      {
        kind: 'details',
        heading: 'Pricing',
        rows: [
          { label: 'Nightly rate', value: money(payload.nightlyRate, payload.currency) },
          { label: 'Total', value: money(payload.totalAmount, payload.currency) },
        ],
      },
      ...noteBlocks(payload.specialRequests),
    ],
  };
}

function packageCreatedHotel(payload: PackageReservationCreatedPayload): EmailDocument {
  const rows: DetailRow[] = [
    { label: 'Reference', value: payload.bookingReference },
    { label: 'Journey', value: `${payload.packageCode} — ${payload.packageTitle}` },
    { label: 'Option', value: payload.variantLabel },
    { label: 'Tour date', value: payload.tourDate },
    { label: 'Guests', value: party(payload.adults, payload.children) },
  ];

  // Order is the order the guest gave them, and an empty list is not a fact
  // worth a row.
  if (payload.childAges !== null && payload.childAges.length > 0) {
    rows.push({ label: 'Child ages', value: payload.childAges.join(', ') });
  }

  return {
    subject: `New Journey reservation: ${payload.bookingReference}`,
    title: 'New Journey reservation',
    intro: `${payload.guestFirstName} ${payload.guestLastName} has booked ${payload.packageTitle}.`,
    blocks: [
      { kind: 'details', heading: 'Booking', rows },
      {
        kind: 'details',
        heading: 'Guest',
        rows: [
          { label: 'Name', value: `${payload.guestFirstName} ${payload.guestLastName}` },
          { label: 'Email', value: payload.guestEmail },
          { label: 'Phone', value: payload.guestPhone },
          { label: 'Country', value: payload.guestCountry },
        ],
      },
      {
        kind: 'details',
        heading: 'Pricing',
        rows: [
          { label: 'Status', value: PRICING_STATUS_LABEL[payload.pricingStatus] },
          { label: 'Adult rate', value: money(payload.adultUnitRate, payload.currency) },
          {
            label: 'Child rate',
            value:
              payload.childUnitRate === null
                ? NOT_APPLICABLE
                : money(payload.childUnitRate, payload.currency),
          },
          {
            label: 'Total',
            value:
              payload.totalAmount === null
                ? AWAITING_CONFIRMATION
                : money(payload.totalAmount, payload.currency),
          },
        ],
      },
      ...noteBlocks(payload.specialRequests),
    ],
  };
}

function packageConfirmedGuest(payload: PackageReservationConfirmedPayload): EmailDocument {
  return {
    subject: `Your Journey is confirmed: ${payload.bookingReference}`,
    title: 'Your Journey is confirmed',
    intro:
      `Dear ${payload.guestFirstName} ${payload.guestLastName}, we are delighted to confirm ` +
      `your booking for ${payload.packageTitle}.`,
    blocks: [
      {
        kind: 'details',
        heading: 'Your Journey',
        rows: [
          { label: 'Reference', value: payload.bookingReference },
          { label: 'Journey', value: payload.packageTitle },
          { label: 'Option', value: payload.variantLabel },
          { label: 'Tour date', value: payload.tourDate },
          { label: 'Guests', value: party(payload.adults, payload.children) },
        ],
      },
      {
        kind: 'details',
        heading: 'Pricing',
        rows: [
          { label: 'Status', value: PRICING_STATUS_LABEL[payload.pricingStatus] },
          { label: 'Adult rate', value: money(payload.adultUnitRate, payload.currency) },
          {
            label: 'Child rate',
            value:
              payload.childUnitRate === null
                ? NOT_APPLICABLE
                : money(payload.childUnitRate, payload.currency),
          },
          {
            label: 'Total',
            value:
              payload.totalAmount === null
                ? AWAITING_CONFIRMATION
                : money(payload.totalAmount, payload.currency),
          },
        ],
      },
      ...noteBlocks(payload.specialRequests),
    ],
  };
}

/**
 * A contact-form inquiry, for the hotel.
 *
 * The one template whose content came from an anonymous stranger rather than
 * from a booking this system created. Every field below is attacker-influenced
 * — the name, the address, and above all the free-text message — and every one
 * of them goes through the same document model as everything else, so `toHtml`
 * escapes them on the way out and `toText` writes no markup at all.
 *
 * The message is a `note` block precisely so its line breaks survive: notes
 * are the only thing that becomes `<br />`, and only after escaping.
 */
function contactReceivedHotel(payload: ContactInquiryReceivedPayload): EmailDocument {
  return {
    subject: `New contact inquiry: ${payload.reference}`,
    title: 'New contact inquiry',
    intro:
      `${payload.firstName} ${payload.lastName} sent an inquiry about ` +
      `${payload.inquiryType.toLowerCase()} through the website.`,
    blocks: [
      {
        kind: 'details',
        heading: 'Inquiry',
        rows: [
          { label: 'Reference', value: payload.reference },
          { label: 'About', value: payload.inquiryType },
        ],
      },
      {
        kind: 'details',
        heading: 'Who to reply to',
        rows: [
          { label: 'Name', value: `${payload.firstName} ${payload.lastName}` },
          { label: 'Email', value: payload.email },
          // Said explicitly rather than omitted: whoever reads this is deciding
          // how to reply, and "no phone" is part of that answer.
          { label: 'Phone', value: payload.phone === null ? NOT_PROVIDED : payload.phone },
        ],
      },
      {
        kind: 'note',
        heading: 'Their message',
        body: payload.message,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The two renderers
// ---------------------------------------------------------------------------

const HTML_STYLE = {
  body: 'margin:0;padding:24px;background:#f6f4ef;font-family:Georgia,serif;color:#2b2b2b;',
  card: 'max-width:600px;margin:0 auto;padding:32px;background:#ffffff;',
  title: 'margin:0 0 16px;font-size:22px;font-weight:normal;',
  intro: 'margin:0 0 24px;font-size:15px;line-height:1.6;',
  heading: 'margin:24px 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;',
  table: 'width:100%;border-collapse:collapse;font-size:15px;',
  label: 'padding:6px 12px 6px 0;text-align:left;font-weight:normal;color:#6b6b6b;width:40%;',
  value: 'padding:6px 0;text-align:left;',
  note: 'margin:0;padding:12px 16px;background:#f6f4ef;font-size:15px;line-height:1.6;',
} as const;

/**
 * The document as HTML, with every payload-derived string escaped.
 *
 * Inline styles only. There is no `<style>` block and no `<script>`, so there
 * is no context in this document where a stray `<` could become anything but
 * the four characters `&lt;`.
 *
 * Line breaks inside a note become `<br />` AFTER escaping, which is the one
 * place markup is derived from content — and it is derived from the newline,
 * never from the text around it.
 */
function toHtml(document: EmailDocument): string {
  const blocks = document.blocks.map((block) => {
    if (block.kind === 'note') {
      const body = escapeHtml(block.body).replace(/\r?\n/g, '<br />');

      return (
        `<h2 style="${HTML_STYLE.heading}">${escapeHtml(block.heading)}</h2>` +
        `<p style="${HTML_STYLE.note}">${body}</p>`
      );
    }

    const rows = block.rows
      .map(
        (row) =>
          `<tr><th style="${HTML_STYLE.label}">${escapeHtml(row.label)}</th>` +
          `<td style="${HTML_STYLE.value}">${escapeHtml(row.value)}</td></tr>`,
      )
      .join('');

    return (
      `<h2 style="${HTML_STYLE.heading}">${escapeHtml(block.heading)}</h2>` +
      `<table style="${HTML_STYLE.table}"><tbody>${rows}</tbody></table>`
    );
  });

  return (
    '<!DOCTYPE html>' +
    '<html lang="en"><head><meta charset="utf-8" />' +
    `<title>${escapeHtml(document.subject)}</title></head>` +
    `<body style="${HTML_STYLE.body}"><div style="${HTML_STYLE.card}">` +
    `<h1 style="${HTML_STYLE.title}">${escapeHtml(document.title)}</h1>` +
    `<p style="${HTML_STYLE.intro}">${escapeHtml(document.intro)}</p>` +
    blocks.join('') +
    '</div></body></html>'
  );
}

/**
 * The document as plain text.
 *
 * Nothing is escaped, because there is nothing to escape into: this renderer
 * writes no markup, so a `<` in the output can only be a `<` somebody typed.
 * Escaping here would show a guest `&amp;` in their own special request.
 */
function toText(document: EmailDocument): string {
  const parts = [document.title, '', document.intro];

  for (const block of document.blocks) {
    parts.push('', block.heading.toUpperCase());

    if (block.kind === 'note') {
      parts.push(block.body);
      continue;
    }

    for (const row of block.rows) {
      parts.push(`${row.label}: ${row.value}`);
    }
  }

  return `${parts.join('\n')}\n`;
}

/**
 * Every template this deployment can render, paired with its payload type.
 *
 * The mapped type is what makes each entry type-safe: a builder listed here
 * must accept exactly the payload its key names, so a template cannot quietly
 * be given the wrong contract.
 */
type TemplateBuilders = {
  readonly [TKey in NotificationTemplateKey]: (payload: NotificationTemplatePayload[TKey]) => EmailDocument;
};

/** The payload each template key is rendered from. */
export type NotificationTemplatePayload = {
  'room_created_hotel.v1': RoomReservationCreatedPayload;
  'room_confirmed_guest.v1': RoomReservationConfirmedPayload;
  'package_created_hotel.v1': PackageReservationCreatedPayload;
  'package_confirmed_guest.v1': PackageReservationConfirmedPayload;
  'contact_received_hotel.v1': ContactInquiryReceivedPayload;
};

const TEMPLATES: TemplateBuilders = {
  'room_created_hotel.v1': roomCreatedHotel,
  'room_confirmed_guest.v1': roomConfirmedGuest,
  'package_created_hotel.v1': packageCreatedHotel,
  'package_confirmed_guest.v1': packageConfirmedGuest,
  'contact_received_hotel.v1': contactReceivedHotel,
};

/**
 * Renders one stored notification into a subject, an HTML body and a text body.
 *
 * Pure and total: the same template key and payload produce byte-identical
 * output every time, and an unknown key raises rather than returning something
 * partly built.
 *
 * @throws {UnsupportedNotificationTemplateError} for a key this build cannot
 * render. The type makes that unreachable from typed code, but a template key
 * read back out of a `text` column is only a string, and that is exactly the
 * caller this guard exists for.
 */
export function renderNotificationEmail<TKey extends NotificationTemplateKey>(
  templateKey: TKey,
  payload: NotificationTemplatePayload[TKey],
): RenderedNotificationEmail {
  // `hasOwnProperty` and not a truthiness check on the lookup: a key like
  // `toString` or `__proto__` would otherwise find something on the prototype
  // chain and fail open with an inherited function.
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, templateKey)) {
    throw new UnsupportedNotificationTemplateError(String(templateKey));
  }

  // The one cast in this file. TypeScript cannot see that `TEMPLATES[TKey]`
  // accepts `NotificationTemplatePayload[TKey]` when both sides are generic,
  // though the mapped type above has already checked exactly that for every
  // entry. Narrowed to this line rather than loosened across the API.
  const build = TEMPLATES[templateKey] as (input: NotificationTemplatePayload[TKey]) => EmailDocument;
  const document = build(payload);

  return {
    subject: headerSafe(document.subject),
    html: toHtml(document),
    text: toText(document),
  };
}
