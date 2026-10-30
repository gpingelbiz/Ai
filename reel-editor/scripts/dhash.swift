// 64-bit 9x8 difference hash for source photos that pngjs cannot decode (JPEG/HEIC).
// Usage: dhash <image>
import AppKit
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

guard CommandLine.arguments.count == 2 else { fail("usage: dhash <image>") }
guard let image = NSImage(contentsOfFile: CommandLine.arguments[1]) else { fail("image could not be read") }
var sourceRect = CGRect(origin: .zero, size: image.size)
guard let source = image.cgImage(forProposedRect: &sourceRect, context: nil, hints: nil) else { fail("image pixels could not be read") }

var pixels = [UInt8](repeating: 0, count: 9 * 8)
let made = pixels.withUnsafeMutableBytes { bytes -> Bool in
  guard let context = CGContext(
    data: bytes.baseAddress,
    width: 9,
    height: 8,
    bitsPerComponent: 8,
    bytesPerRow: 9,
    space: CGColorSpaceCreateDeviceGray(),
    bitmapInfo: CGImageAlphaInfo.none.rawValue
  ) else { return false }
  context.interpolationQuality = .high
  context.draw(source, in: CGRect(x: 0, y: 0, width: 9, height: 8))
  return true
}
if !made { fail("hash canvas failed") }

var hash: UInt64 = 0
for y in 0..<8 {
  for x in 0..<8 {
    hash <<= 1
    if pixels[y * 9 + x] > pixels[y * 9 + x + 1] { hash |= 1 }
  }
}
print(String(format: "%016llx", hash))
