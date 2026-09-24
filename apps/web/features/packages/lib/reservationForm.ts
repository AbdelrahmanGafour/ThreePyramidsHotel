import type { PublicPackageDetail, PublicPackageVariant } from "@/features/packages/api/contracts";
import type { PackageReservationRequest } from "@/features/packages/api/reservationClient";

export type PackageReservationDraft = {
  variantKey: string;
  tourDate: string;
  adults: string;
  children: string;
  childAges: string[];
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCountry: string;
  specialRequests: string;
};

export type PackageReservationFormErrors = Partial<Record<keyof PackageReservationDraft | "form", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function initialVariantKey(pkg: Pick<PublicPackageDetail, "variants">): string {
  if (pkg.variants.length === 1) return pkg.variants[0].key;
  return pkg.variants.find((variant) => variant.isDefault)?.key ?? "";
}

export function emptyPackageReservationDraft(pkg: Pick<PublicPackageDetail, "variants">): PackageReservationDraft {
  return {
    variantKey: initialVariantKey(pkg),
    tourDate: "",
    adults: "1",
    children: "0",
    childAges: [],
    guestFirstName: "",
    guestLastName: "",
    guestEmail: "",
    guestPhone: "",
    guestCountry: "",
    specialRequests: "",
  };
}

function integer(value: string, minimum: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= 2147483647 ? parsed : null;
}

function validCalendarDate(value: string): boolean {
  if (!DATE.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function variantNeedsChildAges(variant: PublicPackageVariant | undefined, children: number): boolean {
  return Boolean(
    variant &&
      children > 0 &&
      variant.childMinAge !== null &&
      variant.childMaxAge !== null &&
      variant.childDiscountPercent !== null,
  );
}

export function resizeChildAges(existing: string[], children: number): string[] {
  return Array.from({ length: Math.max(0, children) }, (_, index) => existing[index] ?? "");
}

export function validatePackageReservationDraft(
  pkg: PublicPackageDetail,
  draft: PackageReservationDraft,
): PackageReservationFormErrors {
  const errors: PackageReservationFormErrors = {};
  const variant = pkg.variants.find((item) => item.key === draft.variantKey);
  if (!variant) errors.variantKey = "Select a package option.";
  if (!validCalendarDate(draft.tourDate)) errors.tourDate = "Choose a valid tour date.";

  const adults = integer(draft.adults, 1);
  const children = integer(draft.children, 0);
  if (adults === null) errors.adults = "Enter at least one adult.";
  if (children === null) errors.children = "Enter a valid number of children.";

  if (children !== null && variantNeedsChildAges(variant, children)) {
    if (draft.childAges.length !== children || draft.childAges.some((age) => integer(age, 0) === null)) {
      errors.childAges = "Enter one valid age for each child.";
    }
  }

  if (!draft.guestFirstName.trim()) errors.guestFirstName = "Enter your first name.";
  if (!draft.guestLastName.trim()) errors.guestLastName = "Enter your last name.";
  if (!EMAIL.test(draft.guestEmail.trim())) errors.guestEmail = "Enter a valid email address.";
  if (!draft.guestPhone.trim()) errors.guestPhone = "Enter your phone number.";
  if (!draft.guestCountry.trim()) errors.guestCountry = "Enter your country.";
  if (draft.specialRequests.trim().length > 2000) errors.specialRequests = "Keep special requests to 2000 characters or fewer.";
  return errors;
}

export function buildPackageReservationRequest(
  pkg: PublicPackageDetail,
  draft: PackageReservationDraft,
): PackageReservationRequest {
  const errors = validatePackageReservationDraft(pkg, draft);
  if (Object.keys(errors).length) throw new Error("Invalid package reservation draft");
  const variant = pkg.variants.find((item) => item.key === draft.variantKey)!;
  const adults = Number(draft.adults);
  const children = Number(draft.children);
  const request: PackageReservationRequest = {
    packageSlug: pkg.slug,
    variantKey: variant.key,
    tourDate: draft.tourDate,
    adults,
    children,
    guestFirstName: draft.guestFirstName.trim(),
    guestLastName: draft.guestLastName.trim(),
    guestEmail: draft.guestEmail.trim(),
    guestPhone: draft.guestPhone.trim(),
    guestCountry: draft.guestCountry.trim(),
  };
  if (variantNeedsChildAges(variant, children)) request.childAges = draft.childAges.map(Number);
  if (draft.specialRequests.trim()) request.specialRequests = draft.specialRequests.trim();
  return request;
}
