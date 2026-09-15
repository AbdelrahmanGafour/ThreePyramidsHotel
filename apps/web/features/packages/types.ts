// Shared types for the Curated Journeys (packages) feature — the integration
// boundary a backend/API team can target later. Components read only through
// these shapes and have no knowledge of which fields are demo content.

export type ItineraryDay = {
  day: number;
  title: string;
  narrative: string;
  moments: string[];
};

export type PricingOption = {
  label: string;
  unit: string;
  price: number;
};

export type AddOn = {
  label: string;
  description?: string;
  price?: number;
};

export type Package = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  duration: string;
  nights: number;
  route: string[];
  summary: string;
  image: string;
  imageAlt: string;
  position: string;
  gallery?: string[];
  highlights: string[];
  itinerary: ItineraryDay[];
  included: string[];
  excluded: string[];
  addOns?: AddOn[];
  pickup?: string;
  languages?: string[];
  groupType?: string;
  pricingOptions?: PricingOption[];
  priceFrom?: number;
  cancellationSummary?: string;
  /** Future-ready only — every current package is inquiry-only, no reservation flow exists yet. */
  bookingMode?: "inquire" | "reserve";
};

export type PackageInquiryDetails = {
  name: string;
  email: string;
  phone: string;
  preferredDates: string;
  partySize: string;
  message: string;
};

export const emptyPackageInquiryDetails: PackageInquiryDetails = {
  name: "",
  email: "",
  phone: "",
  preferredDates: "",
  partySize: "",
  message: "",
};
