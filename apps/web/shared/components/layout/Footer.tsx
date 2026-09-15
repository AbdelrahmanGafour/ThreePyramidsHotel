import Link from "next/link";
import { BrandMark } from "@/shared/components/ui/BrandMark";
import { FooterSand } from "@/shared/components/layout/footer/FooterSand";

// Homepage sections use root-fragment URLs so they resolve from every marketing route.
const primaryLinks = [
  { label: "Stay", href: "/#stay" },
  { label: "Rooftop", href: "/#rooftop" },
  { label: "Experiences", href: "/#experiences" },
  { label: "Gallery", href: "/#gallery" },
];

const secondaryLinks = [
  { label: "Our Story", href: "/#our-story" },
  { label: "Location", href: "/#location" },
  { label: "Contact", href: "/#reserve" },
  { label: "Instagram", href: "#" },
  { label: "Facebook", href: "#" },
];

function FooterLink({
  href,
  index,
  label,
}: {
  href: string;
  index: number;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group grid min-h-8 grid-cols-[1.5rem_1fr] items-center gap-2 border-b border-ivory/10 py-1.5 text-[0.56rem] font-black uppercase tracking-[0.15em] text-ivory/58 transition-colors hover:text-brass sm:tracking-[0.17em]"
    >
      <span className="text-brass/62">{String(index).padStart(2, "0")}</span>
      <span className="flex items-center justify-between gap-3">
        {label}
        <span className="h-px w-7 origin-right scale-x-0 bg-brass transition-transform duration-500 group-hover:scale-x-100" />
      </span>
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-[linear-gradient(180deg,var(--espresso),var(--ink))] px-[var(--page-x)] py-[clamp(1.5rem,2.6vw,2.25rem)] text-ivory">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(176,138,81,0.58),transparent)]" />
      <FooterSand />
      <div className="relative mx-auto max-w-[1240px]">
        <div className="grid justify-items-center text-center">
          <BrandMark className="h-5 w-10 text-brass md:h-6 md:w-12" />
          <p className="display mt-2 whitespace-nowrap text-[clamp(1.9rem,6.4vw,5.75rem)] uppercase leading-[0.94] tracking-[0.03em] md:mt-3">
            Three Pyramids
          </p>
          <div className="mt-2 grid w-full items-center gap-3 md:mt-3 md:grid-cols-[1fr_auto_1fr] md:gap-5">
            <span className="hidden h-px max-w-[360px] justify-self-end bg-[linear-gradient(90deg,transparent,rgba(176,138,81,0.46))] md:block md:w-full" />
            <p className="text-[0.48rem] font-black uppercase tracking-[0.22em] text-brass md:text-[0.52rem] md:tracking-[0.28em]">
              Boutique Hotel / Giza
            </p>
            <span className="hidden h-px max-w-[360px] bg-[linear-gradient(90deg,rgba(176,138,81,0.46),transparent)] md:block md:w-full" />
          </div>
        </div>

        <p className="mx-auto mt-2 max-w-[480px] text-center text-[0.54rem] font-black uppercase tracking-[0.14em] text-ivory/40 md:mt-2.5 md:text-[0.58rem] md:tracking-[0.18em]">
          Ancient materials. Modern hospitality. Giza after sunset.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-x-8 lg:mt-7 lg:gap-x-14">
          <nav aria-label="Primary footer navigation" className="grid content-start gap-1">
            <p className="mb-1.5 text-[0.52rem] font-black uppercase tracking-[0.22em] text-brass">Hotel</p>
            {primaryLinks.map((link, index) => (
              <FooterLink href={link.href} index={index + 1} key={link.label} label={link.label} />
            ))}
          </nav>

          <nav aria-label="Secondary footer navigation" className="grid content-start gap-1">
            <p className="mb-1.5 text-[0.52rem] font-black uppercase tracking-[0.22em] text-brass">Index</p>
            {secondaryLinks.slice(0, 3).map((link, index) => (
              <FooterLink href={link.href} index={index + primaryLinks.length + 1} key={link.label} label={link.label} />
            ))}
          </nav>

          <nav aria-label="Social footer navigation" className="grid content-start gap-1">
            <p className="mb-1.5 text-[0.52rem] font-black uppercase tracking-[0.22em] text-brass">Social</p>
            {secondaryLinks.slice(3).map((link, index) => (
              <FooterLink href={link.href} index={index + 8} key={link.label} label={link.label} />
            ))}
          </nav>
        </div>

        <div className="mt-5 grid gap-3 border-t border-ivory/10 pt-3 text-[0.52rem] font-black uppercase tracking-[0.14em] text-ivory/38 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:text-[0.54rem] sm:tracking-[0.16em]">
          <p>(c) 2026 Three Pyramids Boutique Hotel</p>
          <p className="text-brass/64">Giza / Egypt</p>
          <div className="flex gap-6 sm:justify-end">
            <a href="#" className="transition-colors hover:text-brass">
              Privacy
            </a>
            <button type="button" className="transition-colors hover:text-brass">
              EN
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
