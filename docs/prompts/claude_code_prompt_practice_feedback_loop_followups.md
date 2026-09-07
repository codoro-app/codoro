# Prompt for Claude Code — fix two shipped-in-#107 regressions + one bug found in stress-testing

Paste everything below into Claude Code in the `codoro` repo.

---

## Context

PR #107 (practice feedback loop — combo/shield/impact engine, auto-advance, sound) merged to
`main` and is live on getcodoro.com. The core mechanic is confirmed working end-to-end (combo
surge at the right tier threshold, shield absorbing a miss, shield-depleted miss resetting combo,
rating updating correctly on both outcomes). This prompt is three follow-up fixes found after
shipping, ranked by severity — first two below came from an external cold-browser test, the third
from an internal stress-test session. Fix in order; #1 and #2 are both small, isolated, and should
ship together this pass. #3 is worth doing in the same pass since it's already scoped, but say so
explicitly in your summary if you think it needs more time than the first two.

Do not touch anything about the tier/combo-step/shield-cap constants in `feel.ts` — those are
confirmed working as designed. Do not add a markdown library or any new state-management
dependency (Context, Zustand, etc.) for anything in this prompt — the app has neither today, and
none of these fixes need one.

---

## 1. Puzzle explanations render raw markdown as literal characters (P0)

**This is the single highest-priority fix in this prompt.** The explanation paragraph that appears
after every answer — the one place that actually teaches the developer something — is rendered as
plain text via React (`{puzzle.explanation}`, no parsing), but the content itself is written in
markdown. Every backtick-wrapped identifier in the text (`` `break` ``, `` `break outer` ``,
variable names, function names) prints literally, backticks and all, instead of as inline code.

Verified at scale, not a one-off: **162 of the puzzle content JSON files** under
`src/content/puzzles/**/*.json` contain backticks in their `explanation` field. This is the
majority pattern, not an edge case — every one of those puzzles currently ships broken-looking
copy on its most important screen.

Two render sites, both need the fix, and they should share one function rather than duplicating
parsing logic:

- `src/app/practice/PuzzleCardShell.tsx:633` — desktop sidebar panel:
  `<p ...>{puzzle.explanation}</p>`
- `src/app/practice/PuzzleCardShell.tsx:735` — mobile feedback drawer, same field, different
  wrapper classes.

**Scope check before you build:** grep `src/content/puzzles/**/*.json` for other markdown syntax
(`**bold**`, `[link](`, headers, etc.) before assuming backticks are the only thing to handle — a
quick pass here found zero instances of anything beyond single-backtick inline code spans, but
verify that yourself rather than trusting this note, since new puzzles get added between when this
was written and when you run it.

If backticks really are the only markdown in play, don't pull in a markdown library for this —
write one small pure function (e.g. `renderInlineCode(text: string): ReactNode[]` in a new
`src/app/practice/inlineCode.tsx` or similar) that splits on backtick-delimited spans and maps them
to alternating plain text / `<code>` elements, memoized or just called inline since explanation
strings are short. Use it at both render sites above. If the grep turns up other markdown syntax
beyond backticks, stop and tell me what you found before deciding whether a real markdown
dependency is warranted — don't silently expand scope.

Add a test that a sample explanation string with backticks renders an actual `<code>` element
(RTL's `getByText`/container query), not the literal backtick characters, at both sites.

---

## 2. The page's only `<h1>` says "Home" (P0/P1 — SEO)

Confirmed root cause: `src/app/routes.ts` — `labelForPath('/')` hardcodes `'Home'`. That label
feeds straight into `src/app/AppShell.tsx:186`'s `<h1 className="sr-only">{labelForPath(location)}</h1>`,
which renders on every route except `/legal` and `/settings` (those two render their own real,
visible h1 — see `PAGES_WITH_OWN_H1` in `AppShell.tsx`). So on the root path — the page most likely
to get indexed for someone searching "daily coding puzzle" — the only h1 on the page is the literal
word "Home," invisible on screen (`sr-only`) but exactly what a search crawler and a screen reader
both read as the page's heading. Title tag and OG tags are already correct; this is genuinely the
one thing standing between the current markup and a page that's SEO/a11y-correct for its actual
content.

Two ways to fix it, in order of how much I'd want you to default to the safer one:

- **Static, safe default:** give `labelForPath('/')` (or a root-path special case in `AppShell.tsx`)
  a real descriptive string instead of `'Home'` — something like `"Codoro — daily coding puzzles"`.
  Zero risk to the existing route-focus/scroll behavior `AppShell.tsx` already manages on every
  navigation.
- **Stretch, more SEO value, more risk:** since `/` currently renders the curated first-run puzzle
  sequence (see `src/app/firstRun/`), a dynamic h1 tied to the current puzzle's prompt/question text
  would be stronger for search intent than a static tagline. This interacts with
  `useRouteFocusAndScroll` (`AppShell.tsx`) and whatever announces puzzle changes to screen-reader
  users mid-sequence — read that hook before attempting this option, and only do it if the static
  fix is trivially confirmed working first. If the interaction looks nontrivial, ship the static
  fix and leave a note rather than guessing at the a11y behavior.

Either way: confirm with a quick `curl` or view-source check (not just React DevTools) that the
final string is actually present in server-rendered/initial HTML, not only after hydration — the
whole point of this fix is what a crawler sees.

---

## 3. In-session combo/shields/solved-count reset on any incidental navigation (P1)

Found stress-testing #107 directly, not from the external report. `src/app/practice/usePracticeSession.ts:195`
— `solvedThisSession`, the live combo count, and banked shields are all plain `useState`, scoped to
the hook's mount. Rating itself persists correctly (IndexedDB, `codoro` profile store). But since
none of the other three persist anywhere, clicking to Settings mid-streak, hitting Daily, or using
the browser back button and returning to `/practice` silently zeroes an active combo and any banked
shields — no warning, no confirmation, just gone. Reproducible: build a 3+ combo, bank a shield,
navigate away, navigate back, confirm both read 0.

This isn't just a UX papercut — it's data-poisoning for the telemetry #107 itself added. A real
5-combo streak interrupted by an incidental nav is indistinguishable in PostHog from a session that
never engaged at all, which undercuts the whole "is tier-scaled pacing measurably better" question
this feature exists to answer.

Fix: back `solvedThisSession`, combo, and shields with `sessionStorage` instead of bare `useState`
(read initial value from `sessionStorage` on mount, write on every change) — this app has no
`sessionStorage` usage and no context/state-library pattern anywhere today, so this is the smallest
change consistent with what's already here, and `sessionStorage`'s own lifetime (survives
navigation within a tab, clears on tab close) matches what these three values are already
documented as meaning ("session-only," per `feel.ts`'s and `StatusBar.tsx`'s own doc comments) —
you're fixing the mismatch between that stated intent and the mount-scoped `useState` that doesn't
actually deliver it, not changing the intent. If you find a cleaner way to do this that doesn't
touch `sessionStorage` (e.g., lifting the three values into `AppShell`, which is already documented
as "the one thing that stays mounted across every client-side navigation" and passing them down),
that's fine too — pick whichever touches less of the existing hook's internals.

Add a test: mount the hook, drive combo to 3+ and bank a shield, unmount/remount (simulating a route
change), assert combo and shields survive. Confirm `solvedThisSession` does too.

---

## Explicitly out of scope for this pass

- The blank ~1-3s gap between puzzles (manual "Next puzzle" and auto-advance both show it) — real,
  but lower priority than the three above and probably wants its own investigation into whether it's
  a data-fetch wait or a transition/animation gap. Don't fix opportunistically as part of this pass;
  flag if the fix for #3 happens to touch the same code path.
- Puzzle repeats appearing too soon for brand-new profiles (same puzzle twice within ~7 attempts) —
  possibly the requeue/weakest-pattern weighting over-indexing on a cold profile. Needs its own
  look at `requeueState` logic, not a quick fix — do not touch in this pass.
- Cross-device rating sync doesn't exist yet by design — rating lives in local IndexedDB keyed to an
  anonymous per-browser ID, no accounts/backend. That's the known state until v5 ships, not a bug —
  don't "fix" it here.

## Done when

`pnpm validate` passes. Explanation text renders inline code correctly for a sample of puzzles that
use backticks (spot-check a few of the 162, not just one). View-source on `/` shows a real,
descriptive h1 string, not "Home". A combo/shield built in Practice survives a navigate-away/back
round trip. Existing `PuzzleCardShell.test.tsx` and `usePracticeSession.test.ts` cases still pass
unchanged.
