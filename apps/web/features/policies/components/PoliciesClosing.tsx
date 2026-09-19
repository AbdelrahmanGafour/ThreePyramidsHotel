import { CtaBand } from "@/shared/components/ui/CtaBand";

export function PoliciesClosing() {
  return (
    <CtaBand
      title="Questions about your stay?"
      text="Contact the hotel and we'll be glad to help, or start your reservation if you already know your dates."
      primary={{ href: "/contact", label: "Contact the hotel" }}
      secondary={{ href: "/booking", label: "Start your reservation" }}
    />
  );
}
