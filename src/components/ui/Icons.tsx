import type { SVGProps } from 'react';

/**
 * Original inline icon set. Everything is a stroked 24×24 path so icons inherit
 * `currentColor` and stay crisp at any size — no icon font, no third-party assets.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const ChevronLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="m15 5-7 7 7 7" />
  </Icon>
);

export const ChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const ChevronDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 9 7 7 7-7" />
  </Icon>
);

export const SkipStart = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 5 8 12l10 7z" />
    <path d="M6 5v14" />
  </Icon>
);

export const SkipEnd = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 5l10 7-10 7z" />
    <path d="M18 5v14" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 4.5 19 12 7 19.5z" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 5v14M16 5v14" />
  </Icon>
);

export const FlipIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 8h13a3 3 0 0 1 3 3v1" />
    <path d="m7 5-3 3 3 3" />
    <path d="M20 16H7a3 3 0 0 1-3-3v-1" />
    <path d="m17 19 3-3-3-3" />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 7.1l1.9 1.1M17.9 15.8l1.9 1.1M4.2 16.9l1.9-1.1M17.9 8.2l1.9-1.1" />
  </Icon>
);

export const ChartIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 19h16" />
    <path d="M6 15l4-5 3 3 5-7" />
  </Icon>
);

export const CpuIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M8 2v3M16 2v3M8 19v3M16 19v3M2 8h3M2 16h3M19 8h3M19 16h3" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 9v5M12 17.5v.01" />
  </Icon>
);

export const InboxIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5.5 5h13l2.5 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 5v6h-6" />
  </Icon>
);

export const ExternalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);

export const CrownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 18h16" />
    <path d="M4 8.5 7.5 12 12 5.5 16.5 12 20 8.5 18.5 16h-13z" />
  </Icon>
);

export const ListIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 6h11" />
    <path d="M9 12h11" />
    <path d="M9 18h11" />
    <path d="M4.5 6h.01" />
    <path d="M4.5 12h.01" />
    <path d="M4.5 18h.01" />
  </Icon>
);

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.5l3.5 2" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const StopIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);

/** Wordmark glyph: a stylised knight built from straight strokes. */
export const LogoMark = ({ size = 26, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
    <rect width="32" height="32" fill="url(#gambit-logo)" />
    <path
      d="M11 24h11c0-4.2-1-6.9-3.2-8.9l1.6-3.4-3-1.1-1.3 2.2-2.4-2.4L11 13.4c-1.2 1.3-1.4 2.6-.6 3.9l2.6-1.6.9 1.4-3.3 2c-.4 1.6-.2 3.2.4 4.9z"
      fill="#ffffff"
      fillOpacity="0.95"
    />
    <defs>
      {/* The console's primary gradient, so the mark and its buttons agree. */}
      <linearGradient id="gambit-logo" x1="0" y1="0" x2="32" y2="32">
        <stop stopColor="#1a5dba" />
        <stop offset="1" stopColor="#0f2d57" />
      </linearGradient>
    </defs>
  </svg>
);

/* --- Shell chrome: the navbar's hamburger and its right-hand icon buttons. --- */

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </Icon>
);

export const ExpandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 4h5v5" />
    <path d="M20 4l-6 6" />
    <path d="M9 20H4v-5" />
    <path d="M4 20l6-6" />
  </Icon>
);

export const CompressIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 9h-5V4" />
    <path d="M15 9l6-6" />
    <path d="M4 15h5v5" />
    <path d="M9 15l-6 6" />
  </Icon>
);
