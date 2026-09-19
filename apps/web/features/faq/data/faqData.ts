import type { FaqCategory } from "@/features/faq/types";

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION CONTENT — for client review of the finished layout.
//
// Every answer here is grounded in values already established elsewhere in
// the repo (`features/rooms/data/roomsData.ts`'s `demoStayPolicies`,
// `features/contact/data/contactData.ts`'s `contactInfo`, the booking flow's
// lack of an online payment step, and the Curated Journeys' per-journey
// `cancellationSummary`) rather than invented figures, so nothing here
// conflicts with those pages. Swapping this file for the hotel's confirmed
// answers is the only change needed before launch.
// ═══════════════════════════════════════════════════════════════════════════
export const faqCategories: FaqCategory[] = [
  {
    name: "Reservations",
    items: [
      {
        question: "How do I reserve a room?",
        answer:
          "Choose your dates and preferred room on the Rooms or Booking page. You'll receive a confirmation once your reservation is processed, and our team will follow up if anything needs your attention before arrival.",
      },
      {
        question: "Can I change the dates on my reservation?",
        answer:
          "Get in touch with your reservation details and preferred new dates, and we'll confirm availability for the updated stay.",
      },
      {
        question: "Is there a minimum length of stay?",
        answer:
          "Most rooms have no minimum stay. Some curated journeys include an overnight stay as part of their itinerary — this is noted on the journey's own page.",
      },
    ],
  },
  {
    name: "Rooms & Stay",
    items: [
      {
        question: "What's included with each room?",
        answer:
          "Every room includes air conditioning and a private bathroom. Individual rooms may add a terrace, turndown service, or other touches — each room's amenities are listed on its own page.",
      },
      {
        question: "What time can I check in and check out?",
        answer: "Check-in is from 3:00 PM and check-out is by 11:00 AM.",
      },
      {
        question: "Can I request an early check-in or late check-out?",
        answer:
          "Yes — note your expected arrival time when you book, or add it as a special request. We'll do our best to accommodate this, subject to availability.",
      },
      {
        question: "How many guests can a room hold?",
        answer:
          "Capacity varies by room — each room's page lists how many guests it sleeps, and the booking flow will flag a room if your party is larger than it can hold.",
      },
    ],
  },
  {
    name: "Payments",
    items: [
      {
        question: "How do I pay for my stay?",
        answer: "Payment is arranged directly with the hotel. No card details are collected when you reserve through this website.",
      },
      {
        question: "What currency are rates shown in?",
        answer: "Room and journey rates are shown in US dollars.",
      },
      {
        question: "Are taxes and fees included in the rate shown?",
        answer:
          "The booking summary breaks out an estimated taxes-and-fees line separately from the nightly rate, so you can see both before you confirm.",
      },
    ],
  },
  {
    name: "Arrival & Location",
    items: [
      {
        question: "Where is the hotel located?",
        answer:
          "Three Pyramids Boutique Hotel sits on the edge of the Giza Plateau, in Nazlet El-Semman, Giza, Egypt — around 15 minutes from Cairo International Airport.",
      },
      {
        question: "Can you arrange an airport transfer?",
        answer:
          "Yes — send an airport transfer inquiry from the Contact page with your arrival details, and our team will arrange it ahead of your stay.",
      },
    ],
  },
  {
    name: "Curated Journeys",
    items: [
      {
        question: "What are Curated Journeys?",
        answer:
          "Guided experiences around Giza — the Plateau at dawn, the Grand Egyptian Museum, the desert beyond the city, and evenings after dark — each pairing a private guide with a stay at the hotel.",
      },
      {
        question: "How do I book a curated journey?",
        answer:
          "Curated journeys are currently inquiry-based. Send your preferred dates and party size from a journey's page, and our team will follow up to confirm the details.",
      },
      {
        question: "What's the cancellation policy for a curated journey?",
        answer: "Each curated journey lists its own cancellation window on its detail page, since the notice period varies by journey.",
      },
    ],
  },
  {
    name: "Hotel Services",
    items: [
      {
        question: "Is the rooftop open to all guests?",
        answer: "Yes — the rooftop is open to guests staying at the hotel. Evening tables can be arranged at reception.",
      },
      {
        question: "Can I request a quiet floor or a special occasion?",
        answer:
          "Yes — add this as a special request when completing your guest details during booking, or mention it when you send an inquiry.",
      },
    ],
  },
];
