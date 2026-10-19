import type { ReactNode, SVGProps } from "react";

// Rounded line icons for the own player (24px grid, 1.75 stroke), from the user's own player
// design (2026-10-18 video controls). Filled shapes set `fill="currentColor" stroke="none"`.
const paths = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  forward: <path d="m9.5 6 6 6-6 6" />,
  back: <path d="m14.5 6-6 6 6 6" />,
  cc: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M16.5 10.2a2.2 2.2 0 1 0 0 3.6" />
    </>
  ),
  gear: (
    <>
      <path d="M10.31 5.21 L10.58 2.51 L13.42 2.51 L13.69 5.21 L15.61 6.00 L17.71 4.28 L19.72 6.29 L18.00 8.39 L18.79 10.31 L21.49 10.58 L21.49 13.42 L18.79 13.69 L18.00 15.61 L19.72 17.71 L17.71 19.72 L15.61 18.00 L13.69 18.79 L13.42 21.49 L10.58 21.49 L10.31 18.79 L8.39 18.00 L6.29 19.72 L4.28 17.71 L6.00 15.61 L5.21 13.69 L2.51 13.42 L2.51 10.58 L5.21 10.31 L6.00 8.39 L4.28 6.29 L6.29 4.28 L8.39 6.00z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  wave: <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />,
  /** Skip opening/ending: two forward chevrons. */
  skip: <path d="m5.5 6 6 6-6 6M12.5 6l6 6-6 6" />,
  autoplay: (
    <>
      <path d="M5 6.8v10.4a.8.8 0 0 0 1.25.66l6.4-5.2a.8.8 0 0 0 0-1.32l-6.4-5.2A.8.8 0 0 0 5 6.8z" />
      <path d="M16 6v12M20 6v12" />
    </>
  ),
  speed: (
    <>
      <path d="M4.5 16a8 8 0 1 1 15 0" />
      <path d="m12 16 3.5-5" />
    </>
  ),
  audio: (
    <>
      <path d="M4 14v-3a8 8 0 0 1 16 0v3" />
      <rect x="3.5" y="13" width="4" height="6.5" rx="1.5" />
      <rect x="16.5" y="13" width="4" height="6.5" rx="1.5" />
    </>
  ),
  fullscreen: (
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  ),
  exitFullscreen: (
    <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
  ),
  volume: (
    <>
      <path d="M4.5 9.5v5H8l4.5 4V5.5L8 9.5z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />
    </>
  ),
  mute: (
    <>
      <path d="M4.5 9.5v5H8l4.5 4V5.5L8 9.5z" />
      <path d="m16 9.5 5 5m0-5-5 5" />
    </>
  ),
  play: (
    <path
      d="M8.5 6.2v11.6a1 1 0 0 0 1.5.86l9.4-5.8a1 1 0 0 0 0-1.72L10 5.34a1 1 0 0 0-1.5.86z"
      fill="currentColor"
      stroke="none"
    />
  ),
  pause: (
    <>
      <rect x="7" y="5.5" width="3.5" height="13" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5.5" width="3.5" height="13" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  next: (
    <>
      <path
        d="M6 6.8v10.4a.8.8 0 0 0 1.25.66l7.4-5.2a.8.8 0 0 0 0-1.32l-7.4-5.2A.8.8 0 0 0 6 6.8z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M18 6v12" />
    </>
  ),
  prev: (
    <>
      <path
        d="M18 6.8v10.4a.8.8 0 0 1-1.25.66l-7.4-5.2a.8.8 0 0 1 0-1.32l7.4-5.2A.8.8 0 0 1 18 6.8z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M6 6v12" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type PlayerIconName = keyof typeof paths;

export function PlayerIcon({
  name,
  ...props
}: { name: PlayerIconName } & SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
