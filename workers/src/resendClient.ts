import { Resend } from 'resend'

/**
 * The one place this Worker constructs a Resend client -- same "one network
 * boundary, mockable" reason stripeClient.ts/clerkAdmin.ts each have their
 * own: `test/subscribeRoutes.test.ts` `vi.mock`s this file instead of
 * hitting Resend's servers (F5: worker tests never touch the cloud).
 *
 * Not cached at module scope -- the API key comes from `c.env.RESEND_API_KEY`,
 * request-time-only, same reasoning `createStripeClient`/`createClerkClient`
 * already establish for their own secrets.
 */
export function createResendClient(apiKey: string): Resend {
  return new Resend(apiKey)
}

/**
 * Adds (or updates, if already present) one email to the given Resend
 * Segment. Checked directly against the installed `resend` SDK's own type
 * defs (`CreateContactOptions`): `audienceId` only exists on the SDK's
 * `LegacyCreateContactOptions` overload, marked `@deprecated` -- Resend
 * renamed "Audiences" to "Segments" after the original pre-v5 email-list
 * plan doc was written, and contacts are now a global entity (keyed by
 * email) attached to zero or more segments via the `segments` array, not a
 * single required `audienceId`. This uses the current, non-deprecated shape.
 *
 * Calling this again for an email already on the segment is idempotent, not
 * an error -- which is what lets `POST /api/subscribe`'s route handler
 * return the same generic success shape either way (no enumeration leak,
 * per that same plan's explicit requirement).
 *
 * Throws on any real failure (bad API key, network error, unknown segment
 * id) -- the route handler decides how to translate that into a response;
 * this function's only job is the network call itself.
 */
export async function addContactToSegment(
  client: Resend,
  segmentId: string,
  email: string,
): Promise<void> {
  const { error } = await client.contacts.create({ email, segments: [{ id: segmentId }] })
  if (error) {
    throw new Error(`Resend contacts.create failed: ${error.message}`)
  }
}
