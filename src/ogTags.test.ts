import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(repoRoot, 'index.html'), 'utf-8')

describe('index.html OG/Twitter meta tags', () => {
  it('has a well-formed Open Graph tag set for link unfurling', () => {
    expect(html).toMatch(/<meta property="og:type" content="website" \/>/)
    expect(html).toMatch(/<meta property="og:url" content="https:\/\/getcodoro\.com\/" \/>/)
    expect(html).toMatch(/<meta property="og:title" content="[^"]+" \/>/)
    expect(html).toMatch(/<meta[^>]*property="og:description"/)
    expect(html).toMatch(
      /<meta property="og:image" content="https:\/\/getcodoro\.com\/og-image\.png" \/>/,
    )
    expect(html).toMatch(/<meta property="og:image:width" content="1200" \/>/)
    expect(html).toMatch(/<meta property="og:image:height" content="630" \/>/)
  })

  it('has a matching Twitter card tag set', () => {
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image" \/>/)
    expect(html).toMatch(/<meta name="twitter:title" content="[^"]+" \/>/)
    expect(html).toMatch(/<meta[^>]*name="twitter:description"/)
    expect(html).toMatch(
      /<meta name="twitter:image" content="https:\/\/getcodoro\.com\/og-image\.png" \/>/,
    )
  })

  it('does not touch the PWA/update-prompt-related tags (out of scope for this phase)', () => {
    expect(html).toMatch(
      /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/,
    )
    expect(html).toMatch(/viewport-fit=cover/)
  })
})

describe('index.html canonical link and structured data', () => {
  it('has a canonical link to the site root — useRouteMeta.ts overwrites it per route on the client', () => {
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/getcodoro\.com\/" \/>/)
  })

  it('has one application/ld+json block containing valid, schema.org SoftwareApplication JSON', () => {
    const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    expect(matches).toHaveLength(1)
    const jsonLdSource = matches[0]?.[1]
    expect(jsonLdSource, 'application/ld+json block should not be empty').toBeTruthy()

    const jsonLd: unknown = JSON.parse(jsonLdSource ?? '')
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Codoro',
      url: 'https://getcodoro.com/',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    })
  })
})
