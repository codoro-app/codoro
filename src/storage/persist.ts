/**
 * Best-effort wrapper around the Storage API's persist() capability probe.
 *
 * Never throws: an unsupported browser, a missing navigator.storage, or a
 * rejected promise all collapse to `null` so callers can treat this purely as
 * "did we get an answer" (true/false) vs "we don't know" (null). Does not
 * persist anything to the profile itself — see saveProfile's storagePersisted
 * field for that, wired up by a later phase.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    const storage = (navigator as { storage?: StorageManager }).storage
    if (!storage || typeof storage.persist !== 'function') {
      return null
    }
    return await storage.persist()
  } catch {
    return null
  }
}
