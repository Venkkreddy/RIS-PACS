const fs = require('fs')
const path = require('path')

const srcPng = "C:\\Users\\VENKAT REDDY\\.gemini\\antigravity-ide\\brain\\e079d5b1-f270-484a-b967-bf618998593b\\tdai_icon_1783487421674.png"
const destDir = path.join(__dirname, '..', 'assets')

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true })
}

if (!fs.existsSync(srcPng)) {
  console.error("Source PNG not found at: " + srcPng)
  process.exit(1)
}

const pngData = fs.readFileSync(srcPng)

// 1. Copy as tray-icon.png
fs.writeFileSync(path.join(destDir, 'tray-icon.png'), pngData)
console.log("Created tray-icon.png")

// 2. Create icon.ico (using PNG embedded inside ICO format)
// Header (6 bytes):
// - 2 bytes: Reserved (0)
// - 2 bytes: Type (1 for ICO)
// - 2 bytes: Number of images (1)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)

// Directory entry (16 bytes):
// - 1 byte: Width (0 means 256)
// - 1 byte: Height (0 means 256)
// - 1 byte: Palette size (0 for no palette)
// - 1 byte: Reserved (0)
// - 2 bytes: Color planes (1)
// - 2 bytes: Bits per pixel (32)
// - 4 bytes: Size of image data
// - 4 bytes: Offset of image data (22)
const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0) // 256 width
entry.writeUInt8(0, 1) // 256 height
entry.writeUInt8(0, 2) // no palette
entry.writeUInt8(0, 3) // reserved
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(pngData.length, 8) // size
entry.writeUInt32LE(22, 12) // offset

const icoData = Buffer.concat([header, entry, pngData])
fs.writeFileSync(path.join(destDir, 'icon.ico'), icoData)
console.log("Created icon.ico")
