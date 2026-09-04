/**
 * The Codoro duck mascot — rubber-duck debugging, illustrated. Two
 * exports: `DuckMark` (head only, legible down to favicon scale) for
 * brand-mark contexts, and `DuckMascot` (full body, five poses) for
 * actual expressive moments. Deliberately does NOT extend Icons.tsx's
 * `currentColor` stroke-icon convention (see that file's doc comment
 * for why that convention exists) — this is a multi-color filled
 * character mark, not a single-color stroke glyph.
 *
 * v2 redesign (2026-09): replaced the original hexagonal/low-poly
 * construction with a rounded rubber-duck silhouette (cubic-bezier body
 * + circular head) — reads more clearly as an actual duck at every size
 * this renders at, 16px favicon through 96px celebratory moments. Two
 * things this pass fixed, worth knowing if you touch this again:
 * (1) the beak was originally longer and thinner (read as a bird beak,
 * not a rubber-duck bill) — shortened and widened; (2) the original
 * "sad" pose used a single diagonally-sloped brow with its inner corner
 * LOWER than its outer corner — that's the anatomy for an angry/
 * furrowed brow, not a sad one, which is exactly why it read as angry
 * instead of sad. Sad's brow now curves the other way (inner corner
 * raised, outer corner drooped — true "worried" anatomy), paired with a
 * downcast eye and a frown. If you ever add another pose with a brow,
 * get the raised/drooped corners right on purpose, not by eyeballing a
 * diagonal line.
 *
 * Palette: body var(--mascot-yellow), wing var(--mascot-wing), beak/feet
 * var(--warn), eye var(--surface-0), eye highlight var(--accent) — the
 * one deliberate tie back to brand lime, kept small. Chosen over the
 * app's lime accent for the body specifically to avoid reading as a
 * green bird mascot next to Duolingo's owl.
 */
export interface DuckMarkProps {
  size?: number
}

export function DuckMark({ size = 28 }: DuckMarkProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 140 140">
      <circle cx="62" cy="70" r="46" fill="var(--mascot-yellow)" />
      <path
        d="M100,58 C118,50 138,54 140,64 C136,74 116,78 100,74 C98,68 99,63 100,58 Z"
        fill="var(--warn)"
      />
      <circle cx="64" cy="63" r="9" fill="var(--surface-0)" />
      <circle cx="67" cy="60" r="3.2" fill="var(--accent)" />
    </svg>
  )
}

export type DuckPose = 'idle' | 'happy' | 'debugging' | 'sad' | 'celebrating'

export interface DuckMascotProps {
  pose?: DuckPose
  size?: number
}

export function DuckMascot({ pose = 'idle', size = 96 }: DuckMascotProps) {
  const beakOpen = pose === 'celebrating'

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 200 200">
      <ellipse cx="100" cy="190" rx="46" ry="6" fill="#000000" opacity="0.22" />
      <path d="M76,176 Q73,190 80,192 Q87,190 84,176 Z" fill="var(--warn)" />
      <path d="M124,176 Q127,190 120,192 Q113,190 116,176 Z" fill="var(--warn)" />
      <path
        d="M62,166 C62,180 71,190 84,190 L116,190 C129,190 138,180 138,166 L138,114 C138,90 121,70 100,70 C79,70 62,90 62,114 Z"
        fill="var(--mascot-yellow)"
      />
      <path
        d="M128,120 C144,118 153,132 149,150 C145,164 130,167 121,158 C130,149 132,133 128,120 Z"
        fill="var(--mascot-wing)"
      />
      <circle cx="99" cy="54" r="36" fill="var(--mascot-yellow)" />

      {beakOpen ? (
        <>
          <path
            d="M127,42 C142,34 160,37 166,46 C164,50 156,53 148,54 L150,61 C142,60 133,57 127,52 Z"
            fill="var(--warn)"
          />
          <path
            d="M129,51 C138,55 147,57 153,57"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="1.6"
            opacity="0.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M127,46 C140,40 155,42 161,50 C158,58 144,62 127,60 C126,55 126,51 127,46 Z"
            fill="var(--warn)"
          />
          <path
            d="M129,53 Q143,52 156,52"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="1.6"
            opacity="0.5"
            strokeLinecap="round"
          />
        </>
      )}

      {pose === 'idle' && (
        <>
          <circle cx="101" cy="48" r="7" fill="var(--surface-0)" />
          <circle cx="103.5" cy="45.5" r="2.5" fill="var(--accent)" />
        </>
      )}

      {(pose === 'happy' || pose === 'celebrating') && (
        <>
          <path
            d={pose === 'celebrating' ? 'M89,40 Q100,28 111,40' : 'M90,44 Q100,34 110,44'}
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect
            x="26"
            y="26"
            width="8"
            height="8"
            fill="var(--accent)"
            transform="rotate(45 30 30)"
          />
          <rect
            x="150"
            y="16"
            width="6"
            height="6"
            fill="var(--accent)"
            transform="rotate(45 153 19)"
          />
          {pose === 'happy' ? (
            <rect
              x="152"
              y="42"
              width="5"
              height="5"
              fill="var(--accent)"
              transform="rotate(45 154.5 44.5)"
            />
          ) : (
            <>
              <rect
                x="172"
                y="70"
                width="6"
                height="6"
                fill="var(--warn)"
                transform="rotate(45 175 73)"
              />
              <rect
                x="24"
                y="80"
                width="6"
                height="6"
                fill="var(--accent)"
                transform="rotate(45 27 83)"
              />
              <rect
                x="160"
                y="90"
                width="5"
                height="5"
                fill="var(--accent)"
                transform="rotate(20 162.5 92.5)"
              />
              <rect
                x="150"
                y="10"
                width="7"
                height="7"
                fill="var(--danger)"
                transform="rotate(45 153.5 13.5)"
              />
            </>
          )}
        </>
      )}

      {pose === 'sad' && (
        <>
          {/* Worried anatomy, on purpose: the inner corner (x=111 end,
              nearer center) is RAISED and the outer corner (x=89 end) is
              DROOPED. Do not "simplify" this into a straight diagonal —
              that's the angry-brow bug this redesign fixed. */}
          <path
            d="M89,41 Q100,36 111,42"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="101" cy="52" r="7" fill="var(--surface-0)" />
          <circle cx="98.5" cy="54.5" r="2.5" fill="var(--accent)" />
          <path
            d="M91,72 Q101,64 111,72"
            fill="none"
            stroke="var(--surface-0)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}

      {pose === 'debugging' && (
        <>
          <path
            d="M91,46 L110,50"
            stroke="var(--surface-0)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="101" cy="58" r="7" fill="var(--surface-0)" />
          <circle cx="104" cy="55" r="2.5" fill="var(--accent)" />
          <circle cx="160" cy="35" r="16" fill="none" stroke="var(--text-1)" strokeWidth="5" />
          <line
            x1="171"
            y1="46"
            x2="184"
            y2="59"
            stroke="var(--text-1)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <ellipse cx="160" cy="35" rx="6" ry="4" fill="var(--danger)" />
        </>
      )}
    </svg>
  )
}
