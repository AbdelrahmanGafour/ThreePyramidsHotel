import { CtaBand } from "@/shared/components/ui/CtaBand";

// A plain handoff to the real booking flow for guests who already know their dates.
export function ContactClosing() {
  return (
    <CtaBand
      title="Already know your dates?"
      text="Skip the inquiry and start your reservation directly. You can review everything before you confirm."
      primary={{ href: "/booking", label: "Start your reservation" }}
    />
  );
}
