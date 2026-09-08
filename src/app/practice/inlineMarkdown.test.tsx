import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { renderInlineMarkdown } from './inlineMarkdown'

describe('renderInlineMarkdown', () => {
  it('renders plain text with no markdown unchanged', () => {
    const { container } = render(<p>{renderInlineMarkdown('no special characters here')}</p>)
    expect(container.querySelector('code')).toBeNull()
    expect(container.querySelector('em')).toBeNull()
    expect(container.textContent).toBe('no special characters here')
  })

  it('renders a single backtick span as a <code> element', () => {
    const { container } = render(<p>{renderInlineMarkdown('use `break outer` to exit')}</p>)
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe('break outer')
    expect(container.textContent).toBe('use break outer to exit')
  })

  it('renders multiple backtick spans as separate <code> elements', () => {
    const { container } = render(
      <p>{renderInlineMarkdown('`pending` is read before `fetcher` resolves')}</p>,
    )
    const codes = container.querySelectorAll('code')
    expect(codes).toHaveLength(2)
    expect(codes[0]?.textContent).toBe('pending')
    expect(codes[1]?.textContent).toBe('fetcher')
  })

  it('renders a single-asterisk span as an <em> element', () => {
    const { container } = render(
      <p>{renderInlineMarkdown('it only writes to pending *after* the await resolves')}</p>,
    )
    const em = container.querySelector('em')
    expect(em).not.toBeNull()
    expect(em?.textContent).toBe('after')
  })

  it('renders backtick and italic spans together in one string', () => {
    const { container } = render(
      <p>
        {renderInlineMarkdown(
          'store the in-flight *task/coroutine* in `pending`, not the resolved value',
        )}
      </p>,
    )
    expect(container.querySelector('code')?.textContent).toBe('pending')
    expect(container.querySelector('em')?.textContent).toBe('task/coroutine')
  })

  it('does not treat a spaced asterisk (multiplication) as italic', () => {
    const { container } = render(<p>{renderInlineMarkdown('the result is 2 * 0')}</p>)
    expect(container.querySelector('em')).toBeNull()
    expect(container.textContent).toBe('the result is 2 * 0')
  })

  it('leaves an unmatched single backtick as a literal character', () => {
    const { container } = render(<p>{renderInlineMarkdown('a stray ` backtick')}</p>)
    expect(container.querySelector('code')).toBeNull()
    expect(container.textContent).toBe('a stray ` backtick')
  })
})
