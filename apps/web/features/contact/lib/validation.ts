import type { ContactInquiryDetails } from "@/features/contact/types";

export type ContactInquiryErrors = Partial<Record<keyof ContactInquiryDetails, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

/** Client-side only — this form has no backend submission yet. */
export function validateContactInquiry(values: ContactInquiryDetails): ContactInquiryErrors {
  const errors: ContactInquiryErrors = {};

  if (!values.firstName.trim()) errors.firstName = "Enter your first name.";
  if (!values.lastName.trim()) errors.lastName = "Enter your last name.";

  if (!values.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (values.phone.trim()) {
    const digitCount = values.phone.replace(/\D/g, "").length;
    if (!PHONE_PATTERN.test(values.phone.trim()) || digitCount < 7) {
      errors.phone = "Enter a valid phone number, with country code if outside Egypt.";
    }
  }

  if (!values.inquiryType) errors.inquiryType = "Choose what this is about.";
  if (!values.message.trim()) errors.message = "Let us know what you'd like help with.";

  return errors;
}

export function hasContactInquiryErrors(errors: ContactInquiryErrors): boolean {
  return Object.keys(errors).length > 0;
}
