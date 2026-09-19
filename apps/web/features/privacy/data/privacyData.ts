import type { PrivacySection } from "@/features/privacy/types";

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION CONTENT — for client review of the finished page structure.
//
// This is intentionally general and conservative: it describes what the
// current frontend actually does (session storage for the booking flow, a
// Contact-page map embed, no analytics or advertising trackers found in this
// repo) rather than asserting compliance certifications, encryption
// guarantees, retention periods, or data-residency claims that are not
// established anywhere in this codebase. Replacing this file with the
// hotel's confirmed privacy policy is the only change needed before launch.
// ═══════════════════════════════════════════════════════════════════════════
export const privacySections: PrivacySection[] = [
  {
    id: "information-you-provide",
    title: "Information you provide",
    paragraphs: [
      "When you make a reservation, send an inquiry, or contact the hotel directly, you may be asked for information such as your name, contact details, stay preferences, party size, and the contents of your message.",
    ],
  },
  {
    id: "how-information-may-be-used",
    title: "How information may be used",
    paragraphs: [
      "Information you provide is used to respond to your inquiry, process a reservation, prepare for your stay, and follow up on anything that needs your attention before or during your visit.",
    ],
  },
  {
    id: "reservation-information",
    title: "Reservation information",
    paragraphs: [
      "A reservation may include your name, contact information, arrival details, room or journey selection, and any special requests you add. This is used to prepare for your arrival and to communicate with you about your stay.",
    ],
  },
  {
    id: "inquiry-information",
    title: "Inquiry information",
    paragraphs: [
      "An inquiry sent through the Contact page — including the type of inquiry and your message — is used to route your request to the right part of the team and to reply to you directly.",
    ],
  },
  {
    id: "cookies-site-usage",
    title: "Cookies & site usage",
    paragraphs: [
      "This website uses your browser's own session storage to remember your progress through the booking flow on your device — it is not shared, and it clears when your session ends. It does not currently include third-party analytics or advertising trackers.",
    ],
  },
  {
    id: "third-party-services",
    title: "Third-party services",
    paragraphs: [
      "The Contact page includes an embedded map to help you find the hotel; loading it may involve a request to the map provider. No other third-party service currently receives information through this website.",
    ],
  },
  {
    id: "your-choices",
    title: "Your choices",
    paragraphs: [
      "You choose what to share when sending an inquiry or making a reservation — only the fields marked as required are necessary to complete your request.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: ["For any question about this page or information you've already sent, reach the hotel through the Contact page."],
  },
];
