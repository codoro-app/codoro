import { describe, expect, it, vi } from 'vitest'
import { addContactToSegment } from '../src/resendClient'
import type { Resend } from 'resend'

// Kept as the fake's own structural type for assertions (not cast to the
// real `Resend` class) -- same reasoning fakeStripe.ts's own
// `ReturnType<typeof createFakeStripe>` gets: casting straight to the real
// class type makes eslint's `unbound-method` rule see `.create` as a class
// method reference rather than a plain vi.fn(), even though it's a mock.
function createFakeResend(createResult: { data: unknown; error: unknown }) {
  return {
    contacts: {
      create: vi.fn().mockResolvedValue(createResult),
    },
  }
}

describe('addContactToSegment', () => {
  it('calls contacts.create with the email and segments array, not the deprecated audienceId shape', async () => {
    const fake = createFakeResend({ data: { id: 'contact_1', object: 'contact' }, error: null })
    await addContactToSegment(fake as unknown as Resend, 'seg_123', 'player@example.com')
    expect(fake.contacts.create).toHaveBeenCalledWith({
      email: 'player@example.com',
      segments: [{ id: 'seg_123' }],
    })
  })

  it('resolves without throwing on success', async () => {
    const fake = createFakeResend({ data: { id: 'contact_1', object: 'contact' }, error: null })
    await expect(
      addContactToSegment(fake as unknown as Resend, 'seg_123', 'player@example.com'),
    ).resolves.toBeUndefined()
  })

  it('throws when Resend returns an error, carrying its message', async () => {
    const fake = createFakeResend({ data: null, error: { message: 'invalid API key' } })
    await expect(
      addContactToSegment(fake as unknown as Resend, 'seg_123', 'player@example.com'),
    ).rejects.toThrow(/invalid API key/)
  })
})
