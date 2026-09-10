import { z } from 'zod'
import { REPORT_REASONS } from '../shared/api-types'
import type { ReportRequest } from '../shared/api-types'

/**
 * T4a: the only place `POST /api/report`'s body shape is checked.
 * `satisfies z.ZodType<ReportRequest>` ties this schema to the wire
 * contract type in shared/api-types.ts -- if a field is added there and
 * not here (or vice versa), this line stops compiling instead of the two
 * silently drifting apart.
 *
 * `reason` uses `REPORT_REASONS` (shared/api-types.ts), the same array the
 * `reports` table's `CHECK` constraint enumerates by hand (migration
 * 0001) -- both are enforced (Zod here, SQLite there), neither is the
 * only guard, per the plan's explicit "validated ... by Zod **and** by
 * the table's CHECK constraint" instruction. `puzzleId` is checked for
 * shape only here; membership in the real content index is a separate
 * check against `puzzleIds.generated.ts` (src/index.ts), not something
 * Zod can express. `appVersion` is opaque -- never interpreted, only
 * stored -- so it gets a length bound and nothing else.
 */
export const ReportBodySchema = z.object({
  puzzleId: z.string().min(1).max(200),
  reason: z.enum(REPORT_REASONS),
  appVersion: z.string().min(1).max(50),
}) satisfies z.ZodType<ReportRequest>
