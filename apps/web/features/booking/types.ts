// Shared types for the frontend booking flow. This is the integration
// boundary a backend/API team can target: swap the DEMO data/lib functions
// elsewhere in `features/booking/` for real calls without changing these
// shapes, and the UI components keep working unchanged.

export type GuestDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  arrivalTime: string;
  specialRequests: string;
};

export const emptyGuestDetails: GuestDetails = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  country: "",
  arrivalTime: "",
  specialRequests: "",
};

export type BookingConfirmation = {
  reference: string;
  confirmedAt: string;
};

/**
 * V1 reservation: exactly one room of one room type per booking. There is no
 * room count — a larger party books separate reservations.
 */
export type BookingState = {
  /** ISO "YYYY-MM-DD" or null while unset. */
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  selectedRoomSlug: string | null;
  guest: GuestDetails;
  termsAccepted: boolean;
  confirmation: BookingConfirmation | null;
};

/** V1 reservations are priced in EGP only. */
export type BookingCurrency = "EGP";

/** V1 price for one room: `total = nightlyRate × nights`. No taxes, fees, or multi-room pricing. */
export type PriceBreakdown = {
  currency: BookingCurrency;
  nightlyRate: number;
  nights: number;
  total: number;
};
