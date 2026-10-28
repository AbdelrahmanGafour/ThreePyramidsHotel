import type {
  ContactInquiryReceivedInput,
  NotificationEventOf,
  PackageReservationConfirmedInput,
  PackageReservationCreatedInput,
  RoomReservationConfirmedInput,
  RoomReservationCreatedInput,
} from './notifications.types';

// The four builders, and the whole of what this layer decides.
//
// Each one turns the facts a flow already holds into the row that flow is about
// to insert. They are the only place the event/template/recipient triple is
// assembled, so no caller has to know that a room confirmation is a guest
// message rendered by `room_confirmed_guest.v1` — it asks for the event and
// gets one that cannot be inconsistent.
//
// ---------------------------------------------------------------------------
// WHY THESE ARE PURE, AND WHAT THAT BUYS
//
// No `process.env`, no `new Date()`, no `Math.random()`, no database, no
// locale, no timezone, no I/O of any kind. Same input, same event, on any
// machine at any time. That is not tidiness, it is three load-bearing
// guarantees:
//
//   * A builder runs inside the reservation's transaction. Anything that could
//     throw on a missing setting or block on a network would mean an email
//     concern refusing a booking. Reading nothing cannot fail.
//
//   * The provider request is rebuilt from the stored row on every retry under
//     one idempotency key. If a builder read a clock or a config value, two
//     attempts could differ and the retry would be refused as a conflicting
//     replay — turning one logical event into a permanent failure.
//
//   * Times are the database's business. `created_at` and `next_attempt_at`
//     default to the current time in the schema;
//     a timestamp taken here would be a second, disagreeing opinion, and a
//     formatted one would freeze today's locale into a row read months later.
//
// ---------------------------------------------------------------------------
// EVERY PAYLOAD IS BUILT FIELD BY FIELD
//
// Never spread. An input is a live object from a flow that has more in scope
// than a message needs — ids, slugs, internal rows — and a spread would carry
// whatever it happens to hold into a `jsonb` column, silently, the day someone
// widens a query. Naming each field means the payload can only contain what is
// named, and a new input field reaches an email only when someone decides it
// should.
//
// For the same reason nothing is mutated and no reference is shared: the one
// array, `childAges`, is copied, so a caller reusing its array cannot rewrite a
// payload that has already been built.

/**
 * A new room booking, for the hotel.
 *
 * `recipientEmail` is null: the hotel's own address is deployment
 * configuration, and the dispatcher resolves it. The guest's address travels in
 * the payload instead, because the hotel has to be able to reply.
 */
export function buildRoomReservationCreatedEvent(
  input: RoomReservationCreatedInput,
): NotificationEventOf<'room_reservation_created'> {
  return {
    eventType: 'room_reservation_created',
    bookingReference: input.bookingReference,
    recipientKind: 'hotel',
    recipientEmail: null,
    templateKey: 'room_created_hotel.v1',
    payload: {
      bookingReference: input.bookingReference,
      guestFirstName: input.guestFirstName,
      guestLastName: input.guestLastName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      guestCountry: input.guestCountry,
      roomTypeName: input.roomTypeName,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      adults: input.adults,
      children: input.children,
      nightlyRate: input.nightlyRate,
      totalAmount: input.totalAmount,
      currency: 'EGP',
      specialRequests: input.specialRequests,
    },
  };
}

/**
 * A confirmed room booking, for the guest.
 *
 * The guest's email is snapshotted into `recipientEmail` — the address as it
 * stood when the hotel confirmed. Deliberately a copy: the message is about
 * this booking, so a later change to the account or the reservation must not
 * redirect a notification that was already owed to somebody.
 *
 * It does not also appear in the payload. A confirmation does not read a person
 * their own address back, and one address in one place cannot disagree with
 * itself.
 */
export function buildRoomReservationConfirmedEvent(
  input: RoomReservationConfirmedInput,
): NotificationEventOf<'room_reservation_confirmed'> {
  return {
    eventType: 'room_reservation_confirmed',
    bookingReference: input.bookingReference,
    recipientKind: 'guest',
    recipientEmail: input.guestEmail,
    templateKey: 'room_confirmed_guest.v1',
    payload: {
      bookingReference: input.bookingReference,
      guestFirstName: input.guestFirstName,
      guestLastName: input.guestLastName,
      roomTypeName: input.roomTypeName,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      adults: input.adults,
      children: input.children,
      nightlyRate: input.nightlyRate,
      totalAmount: input.totalAmount,
      currency: 'EGP',
      specialRequests: input.specialRequests,
    },
  };
}

/**
 * A new journey booking, for the hotel.
 *
 * Carries `pricingStatus` because it is the operative fact: a booking that
 * `requires_confirmation` has no total yet and somebody has to quote it.
 */
export function buildPackageReservationCreatedEvent(
  input: PackageReservationCreatedInput,
): NotificationEventOf<'package_reservation_created'> {
  return {
    eventType: 'package_reservation_created',
    bookingReference: input.bookingReference,
    recipientKind: 'hotel',
    recipientEmail: null,
    templateKey: 'package_created_hotel.v1',
    payload: {
      bookingReference: input.bookingReference,
      guestFirstName: input.guestFirstName,
      guestLastName: input.guestLastName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      guestCountry: input.guestCountry,
      packageCode: input.packageCode,
      packageTitle: input.packageTitle,
      variantLabel: input.variantLabel,
      tourDate: input.tourDate,
      adults: input.adults,
      children: input.children,
      // Copied, not shared, and null is preserved as null: "no ages were
      // needed" and "no children have ages" are different facts, and `[]`
      // would quietly claim the second.
      childAges: input.childAges === null ? null : [...input.childAges],
      pricingStatus: input.pricingStatus,
      adultUnitRate: input.adultUnitRate,
      childUnitRate: input.childUnitRate,
      totalAmount: input.totalAmount,
      currency: 'USD',
      specialRequests: input.specialRequests,
    },
  };
}

/**
 * A confirmed journey booking, for the guest.
 *
 * Snapshots the guest's address into `recipientEmail` for the same reason as
 * the room confirmation, and leaves it out of the payload for the same reason
 * too. No package code either: the title is what identifies a journey to the
 * person who booked it.
 */
export function buildPackageReservationConfirmedEvent(
  input: PackageReservationConfirmedInput,
): NotificationEventOf<'package_reservation_confirmed'> {
  return {
    eventType: 'package_reservation_confirmed',
    bookingReference: input.bookingReference,
    recipientKind: 'guest',
    recipientEmail: input.guestEmail,
    templateKey: 'package_confirmed_guest.v1',
    payload: {
      bookingReference: input.bookingReference,
      guestFirstName: input.guestFirstName,
      guestLastName: input.guestLastName,
      packageTitle: input.packageTitle,
      variantLabel: input.variantLabel,
      tourDate: input.tourDate,
      adults: input.adults,
      children: input.children,
      pricingStatus: input.pricingStatus,
      adultUnitRate: input.adultUnitRate,
      childUnitRate: input.childUnitRate,
      totalAmount: input.totalAmount,
      currency: 'USD',
      specialRequests: input.specialRequests,
    },
  };
}

/**
 * A contact-form inquiry, for the hotel.
 *
 * The only event here that is not about a reservation, and the only one whose
 * payload is the sole copy of what it describes — nothing else stores the
 * visitor's message. It follows the same rules as the rest regardless: pure,
 * field by field, never spread.
 *
 * `recipientEmail` is null because this is a hotel event: the address is
 * deployment configuration the dispatcher resolves. The VISITOR's address
 * lives in the payload, as content, because replying to it is the entire
 * purpose of the message — and because there is no autoresponder, nothing ever
 * sends anything back to it automatically.
 *
 * The honeypot has no route into this function: it is not on the input type,
 * so it cannot reach a payload even by accident.
 */
export function buildContactInquiryReceivedNotification(
  input: ContactInquiryReceivedInput,
): NotificationEventOf<'contact_inquiry_received'> {
  return {
    eventType: 'contact_inquiry_received',
    // The inquiry's generated reference, carried in the column named for
    // bookings. Reuse, not a claim that an inquiry is a booking.
    bookingReference: input.reference,
    recipientKind: 'hotel',
    recipientEmail: null,
    templateKey: 'contact_received_hotel.v1',
    payload: {
      reference: input.reference,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      inquiryType: input.inquiryType,
      message: input.message,
    },
  };
}
