/**
 * Generates the stable anonymous ID (Phase 7 Item 6). Not just
 * `crypto.randomUUID()` inlined at each call site: `randomUUID` is
 * secure-context-only (and missing on older Safari) — `undefined` on, for
 * example, `http://192.168.x.x`, which is exactly how an installed PWA
 * gets smoke-tested on a real phone via `vite preview --host`. A pre-merge
 * review caught that calling it directly in `migrateV5ToV6`/
 * `createDefaultProfile` would throw there, land in `loadProfile`'s
 * corrupt-data recovery path, and throw *again* while trying to build the
 * replacement default — bricking profile load on any non-https origin.
 * `crypto.getRandomValues` has no such restriction, so it's the fallback
 * rather than a crash.
 */
export function generateAnonId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // RFC 4122 v4: version nibble = 4, variant bits = 10.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
