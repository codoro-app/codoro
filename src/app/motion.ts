/**
 * Motion foundation (redesign, docs/redesign/ui-redesign-audit-2026-09-17.md
 * "Animation & motion principles"): one shared class fragment per named
 * motion pattern, instead of every button/card re-typing its own
 * transition/duration/easing values. Both patterns are pure CSS
 * (transition/animation, no JS-driven timing), so the existing
 * `[data-reduced-motion='true']` kill-switch (src/index.css) collapses them
 * automatically — nothing here needs its own reduced-motion branch.
 *
 * `PRESS_CLASS` replaces the `transition-[transform,opacity]
 * duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90` string
 * that was hand-typed identically across a dozen+ buttons — `duration-press`
 * and `ease-out` are Tailwind utilities generated from this app's own
 * `--motion-press`/`--ease-out` tokens (src/index.css's `@theme inline`
 * block), not Tailwind's stock values. 150ms (was a hardcoded 50ms) is a
 * deliberate change: 50ms is too short to read as feedback rather than a
 * glitch — see the audit's own ~120-180ms guidance.
 *
 * The entrance pattern (`.motion-enter`, src/app/tokens.css) stays a bare
 * CSS classname rather than a second exported string here, matching
 * `.feedback-panel`'s own established convention in that file — a named
 * `@keyframes` has no Tailwind arbitrary-value equivalent worth reaching
 * for. Import '../tokens.css' (or '../../tokens.css') alongside it wherever
 * it's used, the same way every current tokens.css consumer already does.
 */
export const PRESS_CLASS =
  'transition-[transform,opacity] duration-press ease-out active:scale-[0.98] active:opacity-90'
