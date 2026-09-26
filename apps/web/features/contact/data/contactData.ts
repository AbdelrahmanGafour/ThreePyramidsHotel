import type { ContactInfo } from "@/features/contact/types";

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION CONTENT — for client review of the finished layout.
//
// No contact details for Three Pyramids Boutique Hotel have been confirmed
// yet. The values below are used so the Contact page can be reviewed as a
// finished experience rather than a form with blanks in it; every component
// reads through `contactInfo` rather than hardcoding a number or address
// inline, so swapping this file for the hotel's confirmed details is the
// only change needed before launch.
// ═══════════════════════════════════════════════════════════════════════════
const address = "Pyramids Plateau Road, Nazlet El-Semman, Giza, Egypt";
const encodedAddress = encodeURIComponent(address);

export const contactInfo: ContactInfo = {
  phone: "+20 2 3771 0000",
  email: "reservations@threepyramidshotel.com",
  addressLines: ["Pyramids Plateau Road", "Nazlet El-Semman, Giza", "Egypt"],
  hours: [
    { label: "Reception hours", value: "Open 24 hours" },
    { label: "Inquiry hours", value: "8:00 – 20:00, daily" },
  ],
  mapsEmbedUrl: `https://www.google.com/maps?q=${encodedAddress}&output=embed`,
  mapsDirectionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`,
  shortDirectionsNote: "On the edge of the Giza Plateau, around 15 minutes from Cairo International Airport.",
};

// ═══════════════════════════════════════════════════════════════════════════
// SOCIAL MESSAGING DESTINATIONS — for the public floating contact launcher.
//
// No WhatsApp number or Messenger link for Three Pyramids Boutique Hotel has
// been confirmed yet. `href` stays `null` until a real one is provided —
// never a fabricated phone number or social URL — and the launcher renders
// that option as a disabled, clearly-labelled "coming soon" control instead
// of a working link. This is the one centralized place either destination
// belongs; swapping the two `href` values is the only change needed once
// they're confirmed.
// ═══════════════════════════════════════════════════════════════════════════
export type SocialLink = {
  label: string;
  /** A real `https://wa.me/...` or `https://m.me/...` link, or `null` while unconfirmed. */
  href: string | null;
};

export const socialLinks: { whatsapp: SocialLink; messenger: SocialLink } = {
  whatsapp: { label: "WhatsApp", href: null },
  messenger: { label: "Messenger", href: null },
};
