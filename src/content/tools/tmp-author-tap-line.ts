import { createIdCounters, writePuzzle } from './puzzleAuthoringShared'
import { PuzzleSchema } from '../schema'
import type { PatternSlug } from '../patterns'

const counters = createIdCounters()

function author(pattern: PatternSlug, puzzle: Record<string, unknown>) {
  const id = counters.peek(pattern)
  const full = { id, pattern, ...puzzle }
  const result = PuzzleSchema.safeParse(full)
  if (!result.success) {
    console.error(`SKIP ${id}:`, result.error.issues)
    return
  }
  writePuzzle(result.data)
  counters.commit(pattern, id)
  console.log(`WROTE ${id}`)
}

// Batch 4: input-validation (JS), control-flow (Java), resource-management (Java)

author('input-validation', {
  interaction: 'tap-line',
  difficulty_rating: 2100,
  prompt:
    'This validator rejects perfectly valid emails, but only every other one. Tap the line responsible.',
  explanation:
    "`EMAIL_PATTERN` carries the `g` flag and is declared once at module scope, so the exact same `RegExp` object — including its `lastIndex` property — is reused across every call to `isValidEmail`. A successful `.test()` call with the `g` flag advances `lastIndex` to the end of the match; since the pattern is anchored with `^...$`, it matches the whole string, so `lastIndex` gets set to the input's length. The *next* call to `.test()` starts searching from that leftover `lastIndex` on a brand-new string — and because `^` can only match at absolute position 0, no match is found from any nonzero starting offset, so that call fails and (per spec) resets `lastIndex` back to 0. The result: valid, identically-shaped emails alternate true/false/true/false through a batch, entirely because of leftover state from the previous call, not anything wrong with the emails themselves. A single, one-off call to `isValidEmail` always looks correct — the bug only appears once the same pattern object is reused across a sequence of calls, exactly what `validateSignupBatch` does.",
  language: 'javascript',
  snippet: [
    'const EMAIL_PATTERN = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/g',
    '',
    'function isValidEmail(email) {',
    '  return EMAIL_PATTERN.test(email)',
    '}',
    '',
    'function validateSignupBatch(emails) {',
    '  const results = []',
    '  for (const email of emails) {',
    '    results.push({ email, valid: isValidEmail(email) })',
    '  }',
    '  return results',
    '}',
    '',
    'function rejectedEmails(emails) {',
    '  return validateSignupBatch(emails)',
    '    .filter((result) => !result.valid)',
    '    .map((result) => result.email)',
    '}',
  ].join('\n'),
  correct_line: 0,
})

author('control-flow', {
  interaction: 'tap-line',
  difficulty_rating: 1700,
  prompt:
    'The audit log is missing an entry for every inactive applicant who was screened. Tap the line responsible.',
  explanation:
    '`&&` short-circuits: as soon as `applicant.isActive()` evaluates to `false`, Java never evaluates the rest of the expression, so `logScreening(applicant)` — the call that actually records the audit entry — never runs for that applicant. The audit log ends up only ever containing entries for *active* applicants, even though `screenApplicants` calls `isEligible` (and, by extension, is supposed to consider logging) for every applicant in the list, active or not. The age check, `applicant.getAge() >= 18`, behaves correctly in the sense that it still runs whenever an applicant is active regardless of age — which is exactly why this is easy to miss in testing: as long as your test data happens to be mostly active applicants, the audit log looks complete. The fix is evaluating `logScreening(applicant)` unconditionally, before it can be short-circuited away, e.g. as its own statement ahead of the eligibility check.',
  language: 'java',
  snippet: [
    'import java.util.*;',
    '',
    'public class ApplicantScreener {',
    '    private final List<String> auditLog = new ArrayList<>();',
    '',
    '    public boolean isEligible(Applicant applicant) {',
    '        return applicant.isActive()',
    '            && logScreening(applicant)',
    '            && applicant.getAge() >= 18;',
    '    }',
    '',
    '    private boolean logScreening(Applicant applicant) {',
    '        auditLog.add("screened " + applicant.getId());',
    '        return true;',
    '    }',
    '',
    '    public List<Applicant> screenApplicants(List<Applicant> applicants) {',
    '        List<Applicant> eligible = new ArrayList<>();',
    '        for (Applicant applicant : applicants) {',
    '            if (isEligible(applicant)) {',
    '                eligible.add(applicant);',
    '            }',
    '        }',
    '        return eligible;',
    '    }',
    '',
    '    public List<String> getAuditLog() {',
    '        return auditLog;',
    '    }',
    '}',
  ].join('\n'),
  correct_line: 7,
})

author('resource-management', {
  interaction: 'tap-line',
  difficulty_rating: 1700,
  prompt:
    'Exporting headers from a batch of report files quietly leaks a file handle for every blank file in the batch. Tap the line responsible.',
  explanation:
    "`readHeader` opens `reader` and only calls `reader.close()` on the path that returns a non-blank header. When `firstLine` is `null` (empty file) or blank, the method returns early on that branch without ever reaching `reader.close()` — the `BufferedReader`, and the `FileReader` it wraps, stay open for the lifetime of the JVM. A single call is harmless enough to go unnoticed, but `readHeaders` calls `readHeader` once per path in a whole batch: every blank file in that batch leaks one more open file descriptor, and a large enough batch (or a batch run repeatedly) eventually exhausts the process's file descriptor limit and starts throwing unrelated-looking `IOException`s far from this method. Wrapping the reader in try-with-resources (`try (BufferedReader reader = ...) { ... }`) would close it on every exit path, including this early return, instead of relying on a single `close()` call that only one branch reaches.",
  language: 'java',
  snippet: [
    'import java.io.*;',
    'import java.util.*;',
    '',
    'public class ReportExporter {',
    '    public String readHeader(String path) throws IOException {',
    '        BufferedReader reader = new BufferedReader(new FileReader(path));',
    '        String firstLine = reader.readLine();',
    '        if (firstLine == null || firstLine.isBlank()) {',
    '            return null;',
    '        }',
    '        String header = firstLine.trim();',
    '        reader.close();',
    '        return header;',
    '    }',
    '',
    '    public Map<String, String> readHeaders(List<String> paths)',
    '            throws IOException {',
    '        Map<String, String> headers = new LinkedHashMap<>();',
    '        for (String path : paths) {',
    '            String header = readHeader(path);',
    '            if (header != null) {',
    '                headers.put(path, header);',
    '            }',
    '        }',
    '        return headers;',
    '    }',
    '}',
  ].join('\n'),
  correct_line: 8,
})
