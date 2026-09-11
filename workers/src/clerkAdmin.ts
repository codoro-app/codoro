import { createClerkClient } from '@clerk/backend'
import { isClerkAPIResponseError } from '@clerk/backend/errors'

/**
 * T5: the one place this Worker calls Clerk's Admin API (a real network
 * call, unlike auth.ts's networkless `verifyToken()`) — kept in its own
 * module so `test/account.test.ts` can `vi.mock` exactly this file and
 * exercise `DELETE /api/account`'s own logic (auth, D1 delete, response
 * shape, idempotency) without ever reaching Clerk's servers (F5: worker
 * tests never touch the cloud).
 *
 * `createClerkClient` is called fresh per invocation rather than cached at
 * module scope — the secret key comes from `c.env.CLERK_SECRET_KEY`, which
 * differs per env (dev/production) and isn't available until request time.
 */
export interface DeleteClerkUserResult {
  /** True whether this call deleted the user or the user was already gone. */
  deleted: boolean
}

/**
 * Deletes the Clerk user via the Admin API. **Idempotent by design** (the
 * `DELETE /api/account` contract requires it): a second call against an
 * already-deleted user gets a 404 from Clerk, which this treats as success
 * rather than an error — the caller's desired end state (no such user) is
 * already true. Any other failure (network, 401 from a bad secret key,
 * 5xx) rethrows — those are real problems, not "already done".
 */
export async function deleteClerkUser(
  secretKey: string,
  userId: string,
): Promise<DeleteClerkUserResult> {
  const client = createClerkClient({ secretKey })
  try {
    await client.users.deleteUser(userId)
    return { deleted: true }
  } catch (error) {
    if (isClerkAPIResponseError(error) && error.status === 404) {
      return { deleted: true }
    }
    throw error
  }
}
