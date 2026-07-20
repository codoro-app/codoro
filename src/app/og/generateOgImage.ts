/**
 * One-off dev script: rasterizes public/favicon.svg's logomark onto a
 * 1200x630 brand-purple canvas for index.html's og:image/twitter:image. Not
 * imported by app code — run manually via `pnpm generate:og-image` whenever
 * the logomark or brand color changes. Mirrors generatePwaIcons.ts's
 * structure and its rasterizeLogo seam-crop workaround exactly (same
 * resvg/sharp SVG-rasterization quirk applies here).
 *
 * Deliberately no baked-in text: og:title/og:description already carry the
 * copy, and every unfurl client renders those as real text over the image —
 * baking text into the raster via sharp/resvg would depend on fonts being
 * installed in whatever environment runs this script, which isn't
 * guaranteed. The image's job is just the brand mark on brand color, at the
 * ~1200x630 landscape shape Discord/iMessage/Slack expect.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const BRAND_PURPLE = '#863bff'
const SOURCE_SVG = resolve(import.meta.dirname, '../../../public/favicon.svg')
const OUT_FILE = resolve(import.meta.dirname, '../../../public/og-image.png')

const WIDTH = 1200
const HEIGHT = 630
const LOGO_SIZE = 260

async function rasterizeLogo(svg: Buffer, size: number): Promise<Buffer> {
  const raw = await sharp(svg).resize(size, size, { fit: 'contain' }).png().toBuffer()
  const seamMargin = Math.max(2, Math.round(size * 0.03))
  const cropped = await sharp(raw)
    .extract({ left: 0, top: seamMargin, width: size, height: size - seamMargin * 2 })
    .toBuffer()
  return sharp(cropped)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

async function main(): Promise<void> {
  const svg = readFileSync(SOURCE_SVG)
  const logo = await rasterizeLogo(svg, LOGO_SIZE)
  const left = Math.round((WIDTH - LOGO_SIZE) / 2)
  const top = Math.round((HEIGHT - LOGO_SIZE) / 2)

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: BRAND_PURPLE,
    },
  })
    .composite([{ input: logo, top, left }])
    .png()
    .toFile(OUT_FILE)

  console.log(`Generated ${OUT_FILE} (${String(WIDTH)}x${String(HEIGHT)}) from ${SOURCE_SVG}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
