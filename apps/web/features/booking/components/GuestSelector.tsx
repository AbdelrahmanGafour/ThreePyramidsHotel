"use client";

// The party for a single-room reservation — V1 has no room count.
type GuestCounts = {
  adults: number;
  children: number;
};

type GuestSelectorProps = {
  value: GuestCounts;
  onChange: (next: GuestCounts) => void;
};

const LIMITS = {
  adults: { min: 1, max: 8 },
  children: { min: 0, max: 6 },
} as const;

const rows: { key: keyof GuestCounts; label: string; hint: string }[] = [
  { key: "adults", label: "Adults", hint: "Ages 13 and over" },
  { key: "children", label: "Children", hint: "Ages 0 to 12" },
];

const stepButtonClass =
  "inner-focus grid h-12 w-12 shrink-0 place-items-center border border-ink/60 bg-ivory text-[1.5rem] leading-none text-ink transition-colors hover:border-ink hover:bg-ink hover:text-ivory disabled:cursor-not-allowed disabled:border-ink/20 disabled:bg-transparent disabled:text-ink/35 disabled:hover:bg-transparent disabled:hover:text-ink/35";

// Every count is visible and adjustable by default — no disclosure to find
// or miss. Sits on the same warm field surface and border as the date inputs
// so it reads as part of the form, with large minus / plus buttons and the
// number between them announced as it changes.
export function GuestSelector({ value, onChange }: GuestSelectorProps) {
  const step = (key: keyof GuestCounts, delta: number) => {
    const { min, max } = LIMITS[key];
    const next = Math.min(max, Math.max(min, value[key] + delta));
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="border border-[var(--field-border)] bg-[var(--field-surface)]">
      {rows.map((row, index) => (
        <div
          key={row.key}
          role="group"
          aria-label={row.label}
          className={`flex items-center justify-between gap-4 px-4 py-3 ${index > 0 ? "border-t border-ink/15" : ""}`}
        >
          <div>
            <p className="text-[1rem] font-semibold text-ink">{row.label}</p>
            <p className="text-[0.875rem] text-ink/68">{row.hint}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={`Remove one ${row.label.toLowerCase().replace(/s$/, "")}`}
              onClick={() => step(row.key, -1)}
              disabled={value[row.key] <= LIMITS[row.key].min}
              className={stepButtonClass}
            >
              <span aria-hidden="true">&minus;</span>
            </button>
            <output aria-live="polite" className="w-8 text-center text-[1.25rem] font-bold tabular-nums text-ink">
              {value[row.key]}
            </output>
            <button
              type="button"
              aria-label={`Add one ${row.label.toLowerCase().replace(/s$/, "")}`}
              onClick={() => step(row.key, 1)}
              disabled={value[row.key] >= LIMITS[row.key].max}
              className={stepButtonClass}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
