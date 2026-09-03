/**
 * The Codoro duck mascot — rubber-duck debugging, illustrated. Two
 * exports: `DuckMark` (head only, legible down to favicon scale) for
 * brand-mark contexts, and `DuckMascot` (full body, three poses) for
 * actual expressive moments. Deliberately does NOT extend Icons.tsx's
 * `currentColor` stroke-icon convention (see that file's doc comment
 * for why that convention exists) — this is a multi-color filled
 * character mark, not a single-color stroke glyph.
 *
 * Palette: body var(--mascot-yellow), beak/feet var(--warn), eye
 * var(--surface-0), eye highlight var(--accent) — the one deliberate tie
 * back to brand lime, kept small. Chosen over the app's lime accent for
 * the body specifically to avoid reading as a green bird mascot next to
 * Duolingo's owl.
 */
export interface DuckMarkProps {
  size?: number
}

export function DuckMark({ size = 28 }: DuckMarkProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 140 140">
      <polygon
        points="112,92 87,117 53,117 28,92 28,58 53,33 87,33 112,58"
        fill="var(--mascot-yellow)"
      />
      <polygon points="100,60 138,72 100,86" fill="var(--warn)" />
      <circle cx="78" cy="58" r="8" fill="var(--surface-0)" />
      <circle cx="81" cy="55" r="3" fill="var(--accent)" />
    </svg>
  )
}

export type DuckPose = 'idle' | 'happy' | 'debugging'

export interface DuckMascotProps {
  pose?: DuckPose
  size?: number
}

export function DuckMascot({ pose = 'idle', size = 96 }: DuckMascotProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 200 200">
      <ellipse cx="100" cy="196" rx="50" ry="7" fill="#000000" opacity="0.25" />
      <polygon
        points="160,150 125,185 75,185 40,150 40,100 75,65 125,65 160,100"
        fill="var(--mascot-yellow)"
      />
      <polygon points="65,183 80,183 72,198" fill="var(--warn)" />
      <polygon points="105,183 120,183 112,198" fill="var(--warn)" />
      <polygon
        points="72,105 98,100 92,148 76,142"
        fill="none"
        stroke="var(--surface-0)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon
        points="135,83 115,103 85,103 65,83 65,53 85,33 115,33 135,53"
        fill="var(--mascot-yellow)"
      />
      <polygon points="128,76 170,86 128,100" fill="var(--warn)" />
      {pose === 'idle' && (
        <>
          <circle cx="103" cy="70" r="7" fill="var(--surface-0)" />
          <circle cx="106" cy="67" r="2.5" fill="var(--accent)" />
        </>
      )}
      {pose === 'happy' && (
        <>
          <path
            d="M91,68 Q103,56 115,68"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect
            x="30"
            y="26"
            width="9"
            height="9"
            fill="var(--accent)"
            transform="rotate(45 34.5 30.5)"
          />
          <rect
            x="150"
            y="18"
            width="7"
            height="7"
            fill="var(--accent)"
            transform="rotate(45 153.5 21.5)"
          />
          <rect
            x="152"
            y="42"
            width="6"
            height="6"
            fill="var(--accent)"
            transform="rotate(45 155 45)"
          />
        </>
      )}
      {pose === 'debugging' && (
        <>
          <path
            d="M91,57 L112,61"
            stroke="var(--surface-0)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="103" cy="70" r="7" fill="var(--surface-0)" />
          <circle cx="106" cy="67" r="2.5" fill="var(--accent)" />
          <circle cx="162" cy="45" r="17" fill="none" stroke="var(--text-1)" strokeWidth="5" />
          <line
            x1="174"
            y1="57"
            x2="188"
            y2="71"
            stroke="var(--text-1)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <ellipse cx="162" cy="45" rx="7" ry="5" fill="var(--danger)" />
          <line x1="155" y1="42" x2="149" y2="38" stroke="var(--danger)" strokeWidth="2" />
          <line x1="155" y1="48" x2="149" y2="52" stroke="var(--danger)" strokeWidth="2" />
          <line x1="169" y1="42" x2="175" y2="38" stroke="var(--danger)" strokeWidth="2" />
          <line x1="169" y1="48" x2="175" y2="52" stroke="var(--danger)" strokeWidth="2" />
          <line x1="160" y1="40" x2="157" y2="34" stroke="var(--danger)" strokeWidth="1.5" />
          <line x1="164" y1="40" x2="167" y2="34" stroke="var(--danger)" strokeWidth="1.5" />
        </>
      )}
    </svg>
  )
}
