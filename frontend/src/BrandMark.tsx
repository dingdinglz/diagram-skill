/** A compact F drawn as a routed path; deliberately distinct from graph-node icons. */
export function BrandMark() {
  return <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="9" fill="#4263df" />
    <path d="M10 25V12a5 5 0 0 1 5-5h8M10 17h10" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="23" cy="7" r="2" fill="#fff" />
    <circle cx="20" cy="17" r="2" fill="#fff" />
  </svg>;
}
