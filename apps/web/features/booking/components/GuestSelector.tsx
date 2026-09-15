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

const rows: { key: keyof GuestCounts; label: string; hint?: string }[] = [
  { key: "adults", label: "Adults", hint: "Ages 13 and up" },
  { key: "children", label: "Children", hint: "Ages 0–12" },
];

// Every count is visible and adjustable by default — no disclosure to find
// or miss. Fine hairline rules and plain typography, matching the booking
// form's own language, not a boxed counter widget.
export function GuestSelector({ value, onChange }: GuestSelectorProps) {
  const step = (key: keyof GuestCounts, delta: number) => {
    const { min, max } = LIMITS[key];
    const next = Math.min(max, Math.max(min, value[key] + delta));
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="border-t border-ink/12">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className={`flex items-center justify-between gap-4 py-3.5 ${index > 0 ? "border-t border-ink/10" : ""}`}
        >
          <div>
            <p className="text-[0.88rem] text-ink">{row.label}</p>
            {row.hint ? <p className="mt-0.5 text-[0.72rem] text-ink/48">{row.hint}</p> : null}
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label={`Decrease ${row.label.toLowerCase()}`}
              onClick={() => step(row.key, -1)}
              disabled={value[row.key] <= LIMITS[row.key].min}
              className="grid h-11 w-11 shrink-0 place-items-center border border-ink/25 text-ink transition-colors hover:border-brass hover:text-brass disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-ink/25 disabled:hover:text-ink"
            >
              <span aria-hidden="true">&minus;</span>
            </button>
            <span className="w-5 text-center text-[0.95rem] tabular-nums text-ink">{value[row.key]}</span>
            <button
              type="button"
              aria-label={`Increase ${row.label.toLowerCase()}`}
              onClick={() => step(row.key, 1)}
              disabled={value[row.key] >= LIMITS[row.key].max}
              className="grid h-11 w-11 shrink-0 place-items-center border border-ink/25 text-ink transition-colors hover:border-brass hover:text-brass disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-ink/25 disabled:hover:text-ink"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
