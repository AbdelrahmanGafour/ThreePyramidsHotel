type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width="58"
      height="28"
      viewBox="0 0 58 28"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="29" cy="8" r="3" fill="currentColor" opacity="0.82" />
      <path
        d="M3 25 14 5 25 25M17 25 29 2 41 25M33 25 44 7 55 25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="miter"
      />
      <path d="M7 25H51" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.58" />
    </svg>
  );
}
