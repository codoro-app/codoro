/**
 * One-off dev script: rasterizes public/favicon.svg into the PNG icon set
 * vite-plugin-pwa's manifest references (see vite.config.ts). Not imported
 * by app code — run manually via `pnpm generate:pwa-icons` whenever the
 * logomark or brand color changes. Mirrors the src/content/tools/*.ts
 * convention of build-time scripts living next to what they generate.
 *
 * "any" icons: logomark on a transparent square, small margin.
 * "maskable" icons: logomark on an opaque brand-purple square, shrunk to
 * fit inside the ~80% safe zone OS masks (circle, squircle, etc.) preserve
 * — see https://web.dev/articles/maskable-icon.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const BRAND_PURPLE = '#0e0f13'
const SOURCE_SVG = resolve(import.meta.dirname, '../../../public/favicon.svg')
const OUT_DIR = resolve(import.meta.dirname, '../../../public')

const ANY_SIZES = [192, 512]
const MASKABLE_SIZES = [192, 512]
const MASKABLE_SAFE_ZONE_RATIO = 0.6 // logomark occupies 60% of the canvas, comfortably inside the 80% safe zone

/**
 * resvg (sharp's SVG rasterizer) leaves a thin dark seam along the top/bottom
 * of this particular logomark — its clipping mask's bounding box exactly
 * matches the SVG viewBox, and resvg mis-rasterizes that shared edge. Crop it
 * off post-render rather than editing the source SVG's mask geometry.
 */
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

async function renderAny(svg: Buffer, size: number): Promise<void> {
  const margin = Math.round(size * 0.08)
  const inner = size - margin * 2
  const logo = await rasterizeLogo(svg, inner)

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logo, top: margin, left: margin }])
    .png()
    .toFile(resolve(OUT_DIR, `pwa-${String(size)}.png`))
}

async function renderMaskable(svg: Buffer, size: number): Promise<void> {
  const inner = Math.round(size * MASKABLE_SAFE_ZONE_RATIO)
  const offset = Math.round((size - inner) / 2)
  const logo = await rasterizeLogo(svg, inner)

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_PURPLE,
    },
  })
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toFile(resolve(OUT_DIR, `pwa-maskable-${String(size)}.png`))
}

async function main(): Promise<void> {
  const svg = readFileSync(SOURCE_SVG)

  await Promise.all([
    ...ANY_SIZES.map((size) => renderAny(svg, size)),
    ...MASKABLE_SIZES.map((size) => renderMaskable(svg, size)),
  ])

  console.log(
    `Generated ${String(ANY_SIZES.length + MASKABLE_SIZES.length)} PWA icons in ${OUT_DIR} from ${SOURCE_SVG}`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
