# Prompt for Claude Code — v2 skin follow-ups (same session)

Continuation of the session that built the `ui-v2-arena` skin — that PR is committed. New branch off current `main`: `ui-v2-followups`. Five items from Thomas's review pass, ordered; same conventions as always (commit per item, no batching, no new dependencies, no AI attribution, `src/app/pwa/` hands-off rule stands).

---

## 1. Pattern-filter exit (UX bug — the most annoying one)

Clicking a mastery row (or browse) filters Practice to that pattern, and there's currently **no way back to practicing all patterns** short of re-navigating. Add a filter indicator to the Practice view whenever a pattern filter is active: a chip/banner showing the active pattern name with a clear affordance ("× All patterns" or equivalent, styled from existing chip tokens). Clearing returns to the all-patterns pool mid-session without losing session stats. Works on desktop and mobile. While filtered, clicking a different mastery row switches the filter rather than stacking.

## 2. Home screen behind the logo

Clicking the Codoro logo (desktop rail and mobile app bar) opens a **Home** view. Composition, not invention:

- **Strict constraint: build Home entirely from the existing v2 system** — current tokens, card surfaces, stat treatments, chip styles, mastery-row patterns. If Home seems to need a visual pattern that doesn't already exist somewhere in the app, stop and flag it in the summary instead of designing one; it'll go through a Claude Design round.
- Content: rating + streak (reuse the right-panel treatments), Daily status for today (done/not done, streak state), and three mode cards — Practice (primary CTA, resumes/starts practicing), Daily, Rush (disabled, "coming soon") — with one-line descriptors.
- **Boot behavior unchanged:** the app still opens directly into Practice. The fresh-user promise is "solving within ~10 seconds" — Home must not enter the cold-start path. Logo is the only way in for now; flag if you think Home deserves a nav entry and Thomas will decide.
- Mobile: same view, single column.

## 3. Continue-lag after exhausting a pattern (perf — diagnose before touching)

Repro: practice within a single pattern until the pool runs out, click continue → visible ~1s hitch. **Profile first, fix second** — use the Performance panel / `performance.mark` around the continue path and name the actual cause in your summary before changing code. Plausible suspects, in rough likelihood order: the puzzle-selection path re-widening the ±rating window in a loop when the filtered pool is exhausted; the spaced-repetition requeue scanning the full attempt history synchronously; an IndexedDB read (full attempt list?) awaited on the click path that could be cached or narrowed. Constraints: no changes to selection _semantics_ (window widening, no-repeat-within-20, requeue offsets are locked decisions) — this is a performance fix, not a behavior change. If the honest fix is caching/indexing, do that. Add a timing assertion or at minimum before/after numbers in the PR description.

## 4. Collapsible nav rail (desktop only)

Chess.com-style: a collapse toggle in the rail (bottom or top corner per what fits the v2 layout) that shrinks it to an icon-only rail; expanded state shows icon + label. Preference persists across reloads — `localStorage` is fine for a device-level UI preference (it's not user data; don't route it through the IndexedDB profile). Collapsed state keeps 44px targets and tooltips (`title` at minimum) on the icons. Mobile layout untouched.

## 5. Icons (prerequisite for 4, so build first if sequencing demands)

- One `src/app/Icons.tsx` of inline SVG components — **no icon package**. Copy paths from Lucide (MIT — include the license attribution in a comment at the top of the file).
- Needed now: Practice, Daily, Rush icons for the nav rail (visible in both expanded and collapsed states), the collapse/expand chevron, plus close/× for the filter chip in item 1 and anything Home needs from the existing set.
- All icons `stroke="currentColor"`/`fill="currentColor"` so they inherit token colors; sized via a `size` prop defaulting to the nav's needs. Pick icons that read at 20–24px in the Arena register — geometric, stroke-based, no filled toy shapes.

## Definition of done

- [ ] Filtered practice always shows the active-pattern chip; clearing it restores the all-patterns pool without a reload; component test covers filter → clear → serving from full pool
- [ ] Logo click opens Home on desktop and mobile; every element on Home traces to an existing v2 pattern; boot still lands on Practice (test the cold-start path)
- [ ] Continue after pool exhaustion: root cause named, measured before/after, no perceptible hitch; selection-semantics tests untouched and green
- [ ] Nav collapses/expands, preference survives reload, icon-only state keeps 44px targets
- [ ] `pnpm validate` green; zero new dependencies; no hex colors outside `index.css` (icons inherit currentColor)
- [ ] Screenshots: filter chip active, Home (1440 + 390), collapsed + expanded rail

## What you can verify yourself vs. what's on me

Own: everything above including the profiling numbers and cold-start test.

Mine: whether the lag is actually gone on my machine (I'll repro the same pattern-exhaustion path), Home's "does it feel designed" judgment, and the call on whether Home gets a nav entry.

## Orchestration

Commit order: 5 (icons) → 4 (collapse) → 1 (filter exit) → 3 (perf) → 2 (Home). Rationale: icons unblock collapse; filter-exit and perf are small and independent; Home last because it's the one most likely to get review feedback, and everything else shouldn't wait on it. Delegate icon path extraction and screenshots to a subagent; keep your strongest reasoning on the perf diagnosis — a wrong guess there ships a placebo.

When done: root cause + numbers for item 3, any Home patterns you couldn't compose from the existing system, and whether you'd recommend a Home nav entry.
