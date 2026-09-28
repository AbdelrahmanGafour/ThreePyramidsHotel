// What a reservation notification IS, with no idea of how one is sent.
//
// This module is the provider-neutral middle of the notification design. It
// names the four events, the two recipient roles, the four versioned templates
// and the frozen facts each message is built from — and nothing else. There is
// no mailer here, no HTTP, no SQL, no configuration and no clock.
//
// ---------------------------------------------------------------------------
// WHY THE PAYLOADS ARE SHAPED THIS WAY
//
// Every field below was checked against the data the four flows actually hold
// at the moment the event is created. Nothing is invented: the room events can
// see a parsed reservation input, its room type and the snapshotted price; the
// package events can see the reservation input, the package, the variant and
// the priced result. Anything those flows cannot produce is absent here, so a
// template can never ask for something that does not exist.
//
// Three rules decide what is in and what is out:
//
//   1. Human-facing only. A room type's NAME is here; its slug and its
//      database id are not. A package's TITLE and booked variant LABEL are
//      here; their keys and ids are not. An email is read by a person.
//
//   2. Snapshots, never live lookups. Money is the figure the guest was
//      quoted, carried as the exact decimal string PostgreSQL stored, never a
//      number — the repository-wide rule, and reading these back as floats
//      would lose precision before anyone saw them.
//
//   3. The guest's contact details are CONTENT on a hotel event and ADDRESS on
//      a guest event. A hotel notification carries the guest's email and phone
//      because the hotel has to be able to reply to a booking; a guest
//      confirmation does not repeat the address it is being sent to. Which is
//      why `recipientEmail` is null on hotel events and set on guest ones, and
//      why `guestEmail` appears in two payloads and not the other two.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY ABSENT
//
// No rendered subject, HTML or text: the message is rendered at send time from
// a template key and a payload, so this layer stores what a notification is
// and never what it looked like. No provider field, no credential, no message
// id. No internal database id of any kind. No retry, attempt or dispatcher
// state. And no `resolvedFrom`/`resolvedTo` — the delivery envelope is the
// dispatcher's to resolve on its first claim, because reading mail
// configuration here would let an unset email setting refuse a booking.

/** The four events this system notifies about, and the whole of them. */
export type NotificationEventType =
  | 'room_reservation_created'
  | 'room_reservation_confirmed'
  | 'package_reservation_created'
  | 'package_reservation_confirmed'
  // The one event that is not about a reservation. For the four above, the
  // outbox is a queue in front of durable data; for this one the row IS the
  // message, because a contact inquiry is stored nowhere else.
  | 'contact_inquiry_received';

/** Who a message is for, as a role. The address is a separate question. */
export type NotificationRecipientKind = 'hotel' | 'guest';

/**
 * The renderer to use, versioned.
 *
 * A key is a contract: a renderer for one must keep working for as long as any
 * stored row carries it. Changing the wording of a template is free; changing
 * which fields it requires means a NEW key, because a queued row still holds
 * the old payload.
 *
 * The version also protects the provider idempotency key, which is derived
 * from the event and booking reference alone. If a template changed shape
 * under a queued row, a retry would send a different message under the same
 * key and be refused — so the version bump is what keeps one logical event to
 * one message.
 */
export type NotificationTemplateKey =
  | 'room_created_hotel.v1'
  | 'room_confirmed_guest.v1'
  | 'package_created_hotel.v1'
  | 'package_confirmed_guest.v1'
  | 'contact_received_hotel.v1';

// ---------------------------------------------------------------------------
// Payloads
//
// `readonly` throughout, including the one array: a payload is written once
// and is the only description of the message a retry will rebuild from.
// ---------------------------------------------------------------------------

/**
 * A new room booking, as the hotel needs to read it.
 *
 * Carries the guest's contact details because acting on this notification
 * means being able to reach them.
 */
export type RoomReservationCreatedPayload = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  readonly guestEmail: string;
  readonly guestPhone: string;
  readonly guestCountry: string;
  readonly roomTypeName: string;
  /** "YYYY-MM-DD". */
  readonly checkIn: string;
  /** "YYYY-MM-DD". Half-open: the guest leaves on this day. */
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  /** Exact decimal string, as stored. The rate accepted at booking time. */
  readonly nightlyRate: string;
  /** Exact decimal string, as stored. */
  readonly totalAmount: string;
  readonly currency: 'EGP';
  readonly specialRequests: string | null;
};

/**
 * A room booking the hotel has accepted, as the guest needs to read it.
 *
 * No email, phone or country: the guest is the recipient, so the address lives
 * in `recipientEmail`, and a confirmation does not read a person their own
 * contact details back.
 */
export type RoomReservationConfirmedPayload = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  readonly roomTypeName: string;
  /** "YYYY-MM-DD". */
  readonly checkIn: string;
  /** "YYYY-MM-DD". Half-open: the guest leaves on this day. */
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  /** Exact decimal string, as stored. */
  readonly nightlyRate: string;
  /** Exact decimal string, as stored. */
  readonly totalAmount: string;
  readonly currency: 'EGP';
  /** Echoed back so the guest can see what the hotel recorded. */
  readonly specialRequests: string | null;
};

/**
 * Whether a journey booking carries a real quote yet.
 *
 * On the hotel's notification this is the most operationally important field
 * in the payload: `requires_confirmation` means somebody has to price the
 * booking and contact the guest.
 */
export type NotificationPricingStatus = 'quoted' | 'requires_confirmation';

/** A new journey booking, as the hotel needs to read it. */
export type PackageReservationCreatedPayload = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  readonly guestEmail: string;
  readonly guestPhone: string;
  readonly guestCountry: string;
  /** The booked snapshot, so a later catalogue edit cannot rewrite history. */
  readonly packageCode: string;
  readonly packageTitle: string;
  readonly variantLabel: string;
  /** A calendar day, exactly as given — never an instant. */
  readonly tourDate: string;
  readonly adults: number;
  readonly children: number;
  /**
   * One age per child, in the order the guest gave them, or null when exact
   * child pricing never needed ages. Null and `[]` are different answers and
   * both are preserved.
   */
  readonly childAges: readonly number[] | null;
  readonly pricingStatus: NotificationPricingStatus;
  /** Exact decimal string, as stored. */
  readonly adultUnitRate: string;
  /** Null when no children were booked. */
  readonly childUnitRate: string | null;
  /** Null when the total awaits confirmation. */
  readonly totalAmount: string | null;
  readonly currency: 'USD';
  readonly specialRequests: string | null;
};

/**
 * A journey booking the hotel has accepted, as the guest needs to read it.
 *
 * No contact details, for the same reason as the room confirmation. No package
 * code either: the title is what identifies the journey to the person who
 * booked it.
 */
export type PackageReservationConfirmedPayload = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  readonly packageTitle: string;
  readonly variantLabel: string;
  /** A calendar day, exactly as given — never an instant. */
  readonly tourDate: string;
  readonly adults: number;
  readonly children: number;
  readonly pricingStatus: NotificationPricingStatus;
  /** Exact decimal string, as stored. */
  readonly adultUnitRate: string;
  /** Null when no children were booked. */
  readonly childUnitRate: string | null;
  /** Null when the total awaits confirmation. */
  readonly totalAmount: string | null;
  readonly currency: 'USD';
  /** Echoed back so the guest can see what the hotel recorded. */
  readonly specialRequests: string | null;
};

/**
 * A contact-form inquiry, as the hotel needs to read it.
 *
 * Carries the visitor's contact details because the entire point of the
 * message is that somebody should reply to them — there is no autoresponder
 * and the visitor gets nothing back automatically.
 *
 * `reference` is the inquiry's generated identity, echoed here so the hotel
 * can quote it. No database id, and emphatically no honeypot: the trap is a
 * request field that never becomes a fact about the inquiry.
 */
export type ContactInquiryReceivedPayload = {
  readonly reference: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  /** Null when the visitor did not leave one — the form does not require it. */
  readonly phone: string | null;
  readonly inquiryType: string;
  /** Free text, exactly as typed, newlines and all. */
  readonly message: string;
};

/** Any of the payloads. */
export type NotificationPayload =
  | RoomReservationCreatedPayload
  | RoomReservationConfirmedPayload
  | PackageReservationCreatedPayload
  | PackageReservationConfirmedPayload
  | ContactInquiryReceivedPayload;

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

/**
 * One notification that must be sent, ready to be written.
 *
 * The four arms are written out rather than derived, because the type IS the
 * contract: each one ties an event to exactly one template, one recipient role
 * and one payload shape, so a builder cannot return a guest template with a
 * hotel recipient, and a caller cannot assemble a mismatched triple by hand.
 *
 * Its six fields are exactly the six columns `notification_outbox` takes at
 * INSERT. Nothing here describes dispatch: no attempt count, no schedule, no
 * envelope, no provider reference. Those columns exist, and none of them is
 * this layer's to fill.
 */
export type NotificationEvent =
  | {
      readonly eventType: 'room_reservation_created';
      readonly bookingReference: string;
      readonly recipientKind: 'hotel';
      readonly recipientEmail: null;
      readonly templateKey: 'room_created_hotel.v1';
      readonly payload: RoomReservationCreatedPayload;
    }
  | {
      readonly eventType: 'room_reservation_confirmed';
      readonly bookingReference: string;
      readonly recipientKind: 'guest';
      readonly recipientEmail: string;
      readonly templateKey: 'room_confirmed_guest.v1';
      readonly payload: RoomReservationConfirmedPayload;
    }
  | {
      readonly eventType: 'package_reservation_created';
      readonly bookingReference: string;
      readonly recipientKind: 'hotel';
      readonly recipientEmail: null;
      readonly templateKey: 'package_created_hotel.v1';
      readonly payload: PackageReservationCreatedPayload;
    }
  | {
      readonly eventType: 'package_reservation_confirmed';
      readonly bookingReference: string;
      readonly recipientKind: 'guest';
      readonly recipientEmail: string;
      readonly templateKey: 'package_confirmed_guest.v1';
      readonly payload: PackageReservationConfirmedPayload;
    }
  | {
      readonly eventType: 'contact_inquiry_received';
      /** The inquiry's generated reference, in the column named for bookings. */
      readonly bookingReference: string;
      readonly recipientKind: 'hotel';
      readonly recipientEmail: null;
      readonly templateKey: 'contact_received_hotel.v1';
      readonly payload: ContactInquiryReceivedPayload;
    };

/**
 * The one arm of `NotificationEvent` belonging to a given event type.
 *
 * Lets a builder promise its exact arm rather than the union, so its template
 * key, recipient kind and payload type are all checked at the point of
 * construction instead of being narrowed by whoever reads the result.
 */
export type NotificationEventOf<TEventType extends NotificationEventType> = Extract<
  NotificationEvent,
  { eventType: TEventType }
>;

// ---------------------------------------------------------------------------
// Builder inputs
//
// Local shapes rather than the reservation and package modules' own types.
// This module depends on nothing, which is the right direction for something
// four flows will call: a change to `ReservationInput` cannot silently change
// what a notification contains, and the mapping from each flow's in-scope
// values to these fields is written where that flow can see both.
//
// Every field below is one the corresponding flow demonstrably holds at the
// point the event is created.
// ---------------------------------------------------------------------------

/** What room creation has in scope: the parsed input, its room type, the price. */
export type RoomReservationCreatedInput = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  readonly guestEmail: string;
  readonly guestPhone: string;
  readonly guestCountry: string;
  readonly roomTypeName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  readonly nightlyRate: string;
  readonly totalAmount: string;
  readonly specialRequests: string | null;
};

/** What the room status change has under its row lock, plus the room type name. */
export type RoomReservationConfirmedInput = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  /** The recipient. It becomes `recipientEmail`, not a payload field. */
  readonly guestEmail: string;
  readonly roomTypeName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  readonly nightlyRate: string;
  readonly totalAmount: string;
  readonly specialRequests: string | null;
};

/** What package creation has in scope: the input, the package, the variant, the price. */
export type PackageReservationCreatedInput = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  readonly guestEmail: string;
  readonly guestPhone: string;
  readonly guestCountry: string;
  readonly packageCode: string;
  readonly packageTitle: string;
  readonly variantLabel: string;
  readonly tourDate: string;
  readonly adults: number;
  readonly children: number;
  readonly childAges: readonly number[] | null;
  readonly pricingStatus: NotificationPricingStatus;
  readonly adultUnitRate: string;
  readonly childUnitRate: string | null;
  readonly totalAmount: string | null;
  readonly specialRequests: string | null;
};

/**
 * What the contact flow holds: a generated reference plus the validated body.
 *
 * Deliberately not `ContactInquiryInput` from the contact module. Keeping this
 * module dependent on nothing is what lets five different flows call it, and a
 * change to the contact request contract should not silently change what an
 * email contains.
 */
export type ContactInquiryReceivedInput = {
  readonly reference: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly inquiryType: string;
  readonly message: string;
};

/** What the package status change returns from its own conditional UPDATE. */
export type PackageReservationConfirmedInput = {
  readonly bookingReference: string;
  readonly guestFirstName: string;
  readonly guestLastName: string;
  /** The recipient. It becomes `recipientEmail`, not a payload field. */
  readonly guestEmail: string;
  readonly packageTitle: string;
  readonly variantLabel: string;
  readonly tourDate: string;
  readonly adults: number;
  readonly children: number;
  readonly pricingStatus: NotificationPricingStatus;
  readonly adultUnitRate: string;
  readonly childUnitRate: string | null;
  readonly totalAmount: string | null;
  readonly specialRequests: string | null;
};
