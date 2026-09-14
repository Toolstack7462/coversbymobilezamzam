/** A missing-photo indicator, never an illustration of a saleable product. */
export function PhotoPlaceholder({ label }: { label: string }) {
  return (
    <div className="product-card__media-empty">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path
          d="M16 12l3-5h10l3 5h8v28H8V12h8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="25" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M33 18h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
