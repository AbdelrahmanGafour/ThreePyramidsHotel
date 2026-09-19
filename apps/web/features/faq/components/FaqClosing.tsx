import { CtaBand } from "@/shared/components/ui/CtaBand";

// A quiet handoff for whatever the FAQ didn't cover: ask the hotel, or reserve.
export function FaqClosing() {
  return (
    <CtaBand
      title="Didn't find your answer?"
      text="Send the hotel a message and we'll answer anything not covered above."
      primary={{ href: "/contact", label: "Contact the hotel" }}
      secondary={{ href: "/booking", label: "Start your reservation" }}
    />
  );
}
