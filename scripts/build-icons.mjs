import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const buildDir = join(root, 'build')
const iconsDir = join(buildDir, 'icons')

mkdirSync(iconsDir, { recursive: true })

const svgPath = join(buildDir, 'icon.svg')
const svgBuffer = readFileSync(svgPath)

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

async function main() {
  const masterPngPath = join(buildDir, 'icon.png')
  const masterPng = await sharp(svgBuffer, { density: 384 }).resize(1024, 1024).png().toBuffer()
  writeFileSync(masterPngPath, masterPng)
  console.log('wrote', masterPngPath)

  for (const size of sizes) {
    const buf = await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toBuffer()
    const outPath = join(iconsDir, `${size}x${size}.png`)
    writeFileSync(outPath, buf)
    console.log('wrote', outPath)
  }

  const ico = png2icons.createICO(masterPng, png2icons.BILINEAR, 0, false, true)
  if (!ico) throw new Error('ICO generation failed')
  writeFileSync(join(buildDir, 'icon.ico'), ico)
  console.log('wrote', join(buildDir, 'icon.ico'))

  const icns = png2icons.createICNS(masterPng, png2icons.BILINEAR, 0)
  if (!icns) throw new Error('ICNS generation failed')
  writeFileSync(join(buildDir, 'icon.icns'), icns)
  console.log('wrote', join(buildDir, 'icon.icns'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
