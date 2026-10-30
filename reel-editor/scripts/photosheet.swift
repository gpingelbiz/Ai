// Photos for posts (the Content Studio): upright JPEG copies and numbered contact sheets, with Apple ImageIO, so HEIC
// and rotated phone photos come out the way they look in Photos.
// Usage:
//   photosheet export <image> <out.jpg> [max px, default 2160]       an upright JPEG, never larger than the source
//   photosheet sheet <out.jpg> <image> [<image> ...]                  a contact sheet, each tile numbered from 1
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

func upright(_ file: String, max px: Int) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil) else { return nil }
  let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: px]
  return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
}

func writeJPEG(_ img: CGImage, _ out: String, quality: Double = 0.9) {
  guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { fail("cannot write \(out)") }
  CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  if !CGImageDestinationFinalize(dest) { fail("cannot write \(out)") }
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("usage: photosheet export <image> <out.jpg> [max] | sheet <out.jpg> <image>...") }

switch cmd {
case "export":
  if args.count < 3 { fail("usage: photosheet export <image> <out.jpg> [max px]") }
  let maxPx = args.count > 3 ? Int(args[3]) ?? 2160 : 2160
  guard let img = upright(args[1], max: maxPx) else { fail("cannot read \(args[1])") }
  writeJPEG(img, args[2])
  print("{\"width\":\(img.width),\"height\":\(img.height)}")
case "sheet":
  if args.count < 3 { fail("usage: photosheet sheet <out.jpg> <image> [...]") }
  let files = Array(args.dropFirst(2))
  let tile = 300, label = 34, cols = min(6, files.count)
  let rows = (files.count + cols - 1) / cols
  let W = cols * tile, H = rows * (tile + label)
  guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no context") }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
  let ns = NSGraphicsContext(cgContext: ctx, flipped: false)
  NSGraphicsContext.current = ns
  for (i, f) in files.enumerated() {
    let col = i % cols, row = i / cols
    let x = col * tile, top = H - row * (tile + label)
    let text = NSAttributedString(string: "\(i + 1)", attributes: [.font: NSFont.boldSystemFont(ofSize: 24), .foregroundColor: NSColor.red])
    text.draw(at: NSPoint(x: x + 8, y: top - label + 4))
    guard let img = upright(f, max: tile - 10) else { continue }
    let s = min(Double(tile - 10) / Double(img.width), Double(tile - 10) / Double(img.height))
    let w = Double(img.width) * s, h = Double(img.height) * s
    ctx.draw(img, in: CGRect(x: Double(x) + (Double(tile) - w) / 2, y: Double(top - label) - Double(tile) + (Double(tile) - h) / 2, width: w, height: h))
  }
  guard let out = ctx.makeImage() else { fail("no image") }
  writeJPEG(out, args[1], quality: 0.85)
  print(args[1])
default:
  fail("unknown command \(cmd)")
}
