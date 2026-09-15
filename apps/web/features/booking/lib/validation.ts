import type { GuestDetails } from "@/features/booking/types";

export type GuestDetailsErrors = Partial<Record<keyof GuestDetails, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts digits with optional leading +, spaces, dashes, and parentheses — 7-15 digits total.
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

/**
 * Client-side only, matching what a guest can self-correct before this ever
 * reaches a server. No backend/API validation is implied or replaced here.
 */
export function validateGuestDetails(values: GuestDetails): GuestDetailsErrors {
  const errors: GuestDetailsErrors = {};

  if (!values.firstName.trim()) errors.firstName = "Enter your first name.";
  if (!values.lastName.trim()) errors.lastName = "Enter your last name.";

  if (!values.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  const digitCount = values.phone.replace(/\D/g, "").length;
  if (!values.phone.trim()) {
    errors.phone = "Enter a phone number we can reach you on.";
  } else if (!PHONE_PATTERN.test(values.phone.trim()) || digitCount < 7) {
    errors.phone = "Enter a valid phone number, with country code if outside Egypt.";
  }

  if (!values.country.trim()) errors.country = "Select your country.";

  return errors;
}

export function hasGuestDetailsErrors(errors: GuestDetailsErrors): boolean {
  return Object.keys(errors).length > 0;
}
