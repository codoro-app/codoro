import { z } from 'zod'
import type { SubscribeRequest } from '../shared/api-types'

/**
 * The only place `POST /api/subscribe`'s body shape is checked.
 * `satisfies z.ZodType<SubscribeRequest>` ties this schema to the wire
 * contract type in shared/api-types.ts, same discipline ReportBodySchema
 * (report.ts) already established -- if a field is added there and not
 * here (or vice versa), this line stops compiling.
 *
 * `hp` (honeypot) is checked for "empty" separately at the route handler,
 * not here -- Zod's job is shape, not the bot-detection decision itself.
 */
export const SubscribeBodySchema = z.object({
  email: z.email().max(254),
  hp: z.string().max(200).optional(),
}) satisfies z.ZodType<SubscribeRequest>
