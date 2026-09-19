// Shared types for the Contact feature — components read only through these
// shapes and have no knowledge of which fields are placeholder content.

export type ContactHour = {
  label: string;
  value: string;
};

export type ContactInfo = {
  phone: string;
  email: string;
  addressLines: string[];
  hours: ContactHour[];
  /** Google Maps embeddable URL (the `output=embed` form — no API key required). */
  mapsEmbedUrl: string;
  /** A real, working "open in your maps app" link built from the same address. */
  mapsDirectionsUrl: string;
  /** One short orienting line paired with the map, e.g. distance from the airport. */
  shortDirectionsNote: string;
};

export const inquiryTypes = [
  "Room reservation",
  "Curated journey",
  "Airport transfer",
  "General inquiry",
] as const;

export type InquiryType = (typeof inquiryTypes)[number];

export type ContactInquiryDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  inquiryType: InquiryType | "";
  message: string;
};

export const emptyContactInquiryDetails: ContactInquiryDetails = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  inquiryType: "",
  message: "",
};
