import type { PackageInquiryDetails } from "@/features/packages/types";

export type PackageInquiryErrors = Partial<Record<keyof PackageInquiryDetails, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

/** Client-side only — this form has no backend submission yet. */
export function validatePackageInquiry(values: PackageInquiryDetails): PackageInquiryErrors {
  const errors: PackageInquiryErrors = {};

  if (!values.name.trim()) errors.name = "Enter your name.";

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

  return errors;
}

export function hasPackageInquiryErrors(errors: PackageInquiryErrors): boolean {
  return Object.keys(errors).length > 0;
}
