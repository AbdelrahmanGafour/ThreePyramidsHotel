/**
 * Lets the outbox carry one more kind of event: a contact-form inquiry.
 *
 * The smallest possible change — one CHECK constraint, widened by one value.
 * No new table, no new column, no new index. A contact inquiry is delivered
 * through the outbox and stored nowhere else, so there is nothing else to
 * create.
 *
 * ---------------------------------------------------------------------------
 * WHAT THAT MEANS, SAID PLAINLY
 *
 * For the four reservation events the outbox is a delivery queue in front of
 * durable data: the booking survives whatever happens to the email. A contact
 * inquiry has no such row, so for this one event type the outbox row IS the
 * message. If it is abandoned after exhausting its attempts, or removed by a
 * future retention sweep, the visitor's words are gone.
 *
 * That is a deliberate trade for this iteration, not an oversight. Anything
 * that later deletes from this table has to reckon with it.
 *
 * `booking_reference` carries the inquiry's generated reference. That column
 * is reused rather than renamed, and the reuse is not a claim that an inquiry
 * is a booking. It also provides no duplicate-submission protection: a
 * reference is generated per accepted submission, so a visitor who submits
 * twice produces two references and two emails.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * The four reservation events, exactly as the outbox already allows them.
 *
 * Restated here so the down path can put the constraint back precisely as it
 * was, without reading the earlier migration at runtime.
 */
const RESERVATION_EVENT_TYPES = [
  'room_reservation_created',
  'room_reservation_confirmed',
  'package_reservation_created',
  'package_reservation_confirmed',
];

const CONTACT_EVENT_TYPE = 'contact_inquiry_received';

const CONSTRAINT = 'notification_outbox_event_type_check';

/** `'a', 'b'` — a SQL literal list for an IN (...) predicate. */
const quoted = (values) => values.map((value) => `'${value}'`).join(', ');

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Dropped and re-added rather than altered: a CHECK constraint has no ALTER
  // that can change its expression. The name is kept, so nothing that refers
  // to the constraint by name has to change.
  pgm.dropConstraint('notification_outbox', CONSTRAINT);
  pgm.addConstraint('notification_outbox', CONSTRAINT, {
    check: `event_type IN (${quoted([...RESERVATION_EVENT_TYPES, CONTACT_EVENT_TYPE])})`,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // PostgreSQL validates a re-added CHECK against existing rows, so this
  // DELIBERATELY FAILS while any `contact_inquiry_received` row remains. That
  // is the correct outcome: narrowing the constraint with contact
  // notifications still queued would have to either destroy them or leave the
  // table holding a value its own constraint forbids. Whoever rolls back
  // settles or removes those rows first, as a decision rather than a side
  // effect.
  pgm.dropConstraint('notification_outbox', CONSTRAINT);
  pgm.addConstraint('notification_outbox', CONSTRAINT, {
    check: `event_type IN (${quoted(RESERVATION_EVENT_TYPES)})`,
  });
};
