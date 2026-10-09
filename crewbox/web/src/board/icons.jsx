// Line icons for the board HUD (24×24 grid, round caps), plus the workspace mark.
const I = ({ size = 20, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);

export const BellIcon = (p) => <I {...p}><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></I>;
export const RocketIcon = (p) => <I {...p}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></I>;
export const PlusIcon = (p) => <I {...p}><path d="M5 12h14" /><path d="M12 5v14" /></I>;
export const MinusIcon = (p) => <I {...p}><path d="M5 12h14" /></I>;
export const SearchIcon = (p) => <I {...p}><circle cx="11" cy="11" r="7.5" /><path d="m20.5 20.5-4.2-4.2" /></I>;
export const UpDownIcon = (p) => <I size={16} strokeWidth="1.9" {...p}><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></I>;
export const FitIcon = (p) => (
  <I {...p}>
    <circle cx="12" cy="12" r="2.2" />
    <path d="m3.5 9.5 2.5 2.5-2.5 2.5" /><path d="m20.5 9.5-2.5 2.5 2.5 2.5" />
    <path d="m9.5 3.5 2.5 2.5 2.5-2.5" /><path d="m9.5 20.5 2.5-2.5 2.5 2.5" />
  </I>
);

/** The workspace mark: a glossy droplet of the Crewbox colours. */
export function Logo() {
  return (
    <svg className="rb-logo" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <defs>
        <linearGradient id="rb-logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff5a8a" /><stop offset="0.5" stopColor="#a855f7" /><stop offset="1" stopColor="#4f46e5" /></linearGradient>
      </defs>
      <circle cx="14" cy="14" r="14" fill="#fff" />
      <path d="M14 5.5c3.2 3.6 6.5 7.4 6.5 10.8a6.5 6.5 0 0 1-13 0C7.5 12.9 10.8 9.1 14 5.5z" fill="url(#rb-logo-g)" />
      <path d="M11.4 15.8c.3-1.6 1.3-3.1 2.4-4.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.85" />
    </svg>
  );
}
