// npm install --no-save sharp, or set NODE_PATH to a directory containing sharp.
// Rebuild every desktop asset from the editable vector mark.
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const sharp = require('sharp')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(path.join(root, 'assets/images/adomnia-mark.svg'), 'utf8')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const mark = source.replace(/<defs>[\s\S]*?<\/defs>/, '').replaceAll('url(#metal)', '#f3f7ff')
const black = mark.replaceAll('#f3f7ff', '#101522')
const tile = `<rect x="12" y="12" width="488" height="488" rx="110" fill="#0b1020" stroke="url(#metal)" stroke-width="4"/>`
const neon = source.replace('</defs>', '</defs>' + tile)
// Default launcher/executable icon: the white mark on the dark tile, as shown in the app.
const dark = mark.replace(/(<svg[^>]*>)/, '$1<rect x="12" y="12" width="488" height="488" rx="110" fill="#0b1020" stroke="#2a3550" stroke-width="4"/>')
const light = black.replace(/(<svg[^>]*>)/, '$1<rect x="12" y="12" width="488" height="488" rx="110" fill="#f3f7ff"/>')
async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer()
}
async function save(file, data) {
  const destination = path.join(root, file)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, data)
}
// ICO directory contains actual PNG frames, including a distinct 16px raster.
async function ico(svg, file) {
  const frames = await Promise.all(sizes.filter(s => s <= 256).map(s => png(svg, s)))
  const header = Buffer.alloc(6 + 16 * frames.length)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach((frame, i) => {
    const entry = 6 + 16 * i, size = sizes[i]
    header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry]
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  })
  await save(file, Buffer.concat([header, ...frames]))
}
for (const [name, svg] of [['icon', dark], ['icon-neon', neon], ['icon-white', mark], ['icon-black', black]]) {
  const image = await png(svg, 1024)
  await save(`assets/images/${name}.png`, image)
  await save(`frontend/public/${name}.png`, image)
  await ico(svg, `assets/icons/${name}.ico`)
}
await ico(dark, 'build/windows/icon.ico')
for (const [name, svg] of [['dark', dark], ['light', light]]) {
  await ico(svg, `internal/nativeicon/artwork/${name}.ico`)
  await save(`internal/nativeicon/artwork/${name}.png`, await png(svg, 256))
}
await save('build/appicon.png', await png(dark, 1024))
await save('winres/icon.png', await png(dark, 256))
await save('frontend/public/logo.png', await png(mark, 1024))
for (const size of sizes) await save(`assets/icons/linux/adOmnia_${size}x${size}.png`, await png(dark, size))
await save('assets/icons/linux/adomnia-symbolic.svg', black.replaceAll('#101522', '#2e3436'))
console.log('Generated dark-tile, neon, white and black PNG/ICO assets and Linux symbolic icon.')
