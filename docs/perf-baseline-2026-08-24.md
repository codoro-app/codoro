# Practice-page perf baseline — 2026-08-24

## Contaminated baseline (superseded)

Two Lighthouse runs against production `https://getcodoro.com/practice`,
captured in a Chrome profile with ~12 extensions loaded (MetaMask, Adobe
Acrobat, AdBlock, an LMS-detector, others). **Not a clean measurement** —
kept here only as the historical starting point this pass worked from.

|         | Perf | A11y | Best Practices | SEO  |
| ------- | ---- | ---- | -------------- | ---- |
| Mobile  | 0.46 | 0.96 | 0.73           | 1.00 |
| Desktop | 0.85 | 0.95 | 0.73           | 1.00 |

Confirmed extension noise in these reports (re-verified against the raw
JSON during planning, not just the summary numbers above):

- `unused-javascript`: "Est. savings of 4,741 KiB" mobile / "4,718 KiB"
  desktop — all but two entries are `chrome-extension://` or
  extension-injected `blob:` URLs. The two first-party entries
  (`module-*.js`/posthog, `index-*.js`/main bundle) total ~53 KiB of the
  4,741 KiB figure — genuinely small next to the extension noise, but not
  literally zero as an earlier draft of this finding claimed.
- `errors-in-console` (mobile): 3 network 404s (`/api/v1/courses`,
  `/d2l/api/...`, `/login/token.php`) are an LMS-detector extension probing
  the origin; the `browser_polyfill_default(...).runtime.getManifest is not
a function` exception is from an extension's injected `blob:` script.
  None are Codoro's code.
- `deprecations`: the Shared Storage API warning traces to MetaMask's
  content script (`chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/...`).
- mobile `mainthread-work-breakdown` total 7,492 ms; of the top 5 long
  tasks after the first (first-party, 1,171 ms), 4 are extension scripts.

## Clean baseline (`pnpm perf:lighthouse --prod`, run 2026-08-24)

3-run median per form factor, clean-profile (extension-free) baseline before any fix in this plan lands.

| Metric      | Mobile  | Desktop |
| ----------- | ------- | ------- |
| Performance | 75      | 99      |
| FCP         | 2225 ms | 557 ms  |
| LCP         | 3816 ms | 983 ms  |
| TBT         | 64 ms   | 0 ms    |
| CLS         | 0.227   | 0.000   |

## Post-fix (after Tasks 2–7 land)

<Fill in during Task 8.>

| Metric      | Mobile | Desktop |
| ----------- | ------ | ------- |
| Performance |        |         |
| FCP         |        |         |
| LCP         |        |         |
| TBT         |        |         |
| CLS         |        |         |
