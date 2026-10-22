// Pick the best cover frame of a talking-head clip and cut the person out of it with Apple Vision.
// Usage: person <video> <t1> [t2 ...] --out <person.png> [--frame <frame.png>]
// Scores each frame (expression x3: mouth not mid-word; light x2; sharpness x2; angle x1), prints JSON with the
// scores and the winner, and writes the winner as a PNG with the background made transparent (feathered mask).
import AVFoundation
import AppKit
import CoreImage
import Foundation
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
var outPath = ""
var framePath = ""
if let i = args.firstIndex(of: "--out") { outPath = args[i + 1]; args.removeSubrange(i...(i + 1)) }
if let i = args.firstIndex(of: "--frame") { framePath = args[i + 1]; args.removeSubrange(i...(i + 1)) }
if args.count < 2 || outPath.isEmpty { fail("usage: person <video> <t1> [t2 ...] --out <person.png> [--frame <frame.png>]") }

let asset = AVURLAsset(url: URL(fileURLWithPath: args[0]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)

struct Scored { let t: Double; let score: Double; let parts: [String: Double]; let face: CGRect?; let image: CGImage }
var scored: [Scored] = []
let ctx = CIContext()

func luminance(_ img: CGImage, in rect: CGRect) -> Double {
  guard let crop = img.cropping(to: rect) else { return 0.5 }
  let ci = CIImage(cgImage: crop)
  let f = CIFilter(name: "CIAreaAverage")!
  f.setValue(ci, forKey: kCIInputImageKey)
  f.setValue(CIVector(cgRect: ci.extent), forKey: kCIInputExtentKey)
  var px = [UInt8](repeating: 0, count: 4)
  ctx.render(f.outputImage!, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
  return (0.299 * Double(px[0]) + 0.587 * Double(px[1]) + 0.114 * Double(px[2])) / 255.0
}

func sharpness(_ img: CGImage, in rect: CGRect) -> Double {
  // Mean gradient magnitude on a small grey copy of the face: higher is sharper.
  guard let crop = img.cropping(to: rect) else { return 0 }
  let w = 96, h = 96
  var buf = [UInt8](repeating: 0, count: w * h)
  guard let c = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 0 }
  c.interpolationQuality = .high
  c.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
  var sum = 0.0
  for y in 1..<(h - 1) { for x in 1..<(w - 1) {
    let gx = Double(buf[y * w + x + 1]) - Double(buf[y * w + x - 1])
    let gy = Double(buf[(y + 1) * w + x]) - Double(buf[(y - 1) * w + x])
    sum += abs(gx) + abs(gy)
  } }
  return sum / Double((w - 2) * (h - 2)) / 255.0
}

for ts in args.dropFirst() {
  guard let t = Double(ts) else { continue }
  guard let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
  let W = Double(cg.width), H = Double(cg.height)
  let req = VNDetectFaceLandmarksRequest()
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  try? handler.perform([req])
  let faces = (req.results ?? []).sorted { $0.boundingBox.width * $0.boundingBox.height > $1.boundingBox.width * $1.boundingBox.height }
  var parts: [String: Double] = ["expression": 0, "light": 0, "sharp": 0, "angle": 0, "size": 0]
  var faceRect: CGRect? = nil
  if let f = faces.first {
    // Vision boxes are normalized with origin bottom-left.
    let bb = f.boundingBox
    let rect = CGRect(x: bb.minX * W, y: (1 - bb.maxY) * H, width: bb.width * W, height: bb.height * H)
    faceRect = rect
    // Expression: a wide-open, mid-word mouth scores low; closed or smiling scores high.
    var mouthOpen = 0.0
    if let lm = f.landmarks, let outer = lm.outerLips, let inner = lm.innerLips {
      let oy = outer.normalizedPoints.map { Double($0.y) }
      let iy = inner.normalizedPoints.map { Double($0.y) }
      let oh = (oy.max() ?? 0) - (oy.min() ?? 0)
      let ih = (iy.max() ?? 0) - (iy.min() ?? 0)
      mouthOpen = oh > 0 ? ih / oh : 0
    }
    parts["expression"] = max(0, 1 - mouthOpen * 2.2)
    let lum = luminance(cg, in: rect)
    parts["light"] = max(0, 1 - abs(lum - 0.52) * 2.5)
    parts["sharp"] = min(1, sharpness(cg, in: rect) * 6)
    let yaw = abs(Double(truncating: f.yaw ?? 0))
    parts["angle"] = max(0, 1 - yaw / 0.6)
    parts["size"] = min(1, bb.width / 0.3)
  }
  let score = 3 * parts["expression"]! + 2 * parts["light"]! + 2 * parts["sharp"]! + 1 * parts["angle"]! + 1 * parts["size"]!
  scored.append(Scored(t: t, score: score, parts: parts, face: faceRect, image: cg))
}
guard let best = scored.max(by: { $0.score < $1.score }) else { fail("no frames could be read") }

// Cut the person out: Vision person mask, blurred a little so the edge feathers, applied as alpha.
let seg = VNGeneratePersonSegmentationRequest()
seg.qualityLevel = .accurate
seg.outputPixelFormat = kCVPixelFormatType_OneComponent8
try? VNImageRequestHandler(cgImage: best.image, options: [:]).perform([seg])
guard let maskBuf = seg.results?.first?.pixelBuffer else { fail("no person found in the best frame") }
let base = CIImage(cgImage: best.image)
var mask = CIImage(cvPixelBuffer: maskBuf)
let sx = base.extent.width / mask.extent.width, sy = base.extent.height / mask.extent.height
mask = mask.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
mask = mask.applyingGaussianBlur(sigma: 1.5).cropped(to: base.extent)
let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(base, forKey: kCIInputImageKey)
blend.setValue(CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 0)).cropped(to: base.extent), forKey: kCIInputBackgroundImageKey)
blend.setValue(mask, forKey: kCIInputMaskImageKey)
guard let outImg = blend.outputImage, let outCG = ctx.createCGImage(outImg, from: base.extent) else { fail("could not cut the person out") }
let rep = NSBitmapImageRep(cgImage: outCG)
guard let png = rep.representation(using: .png, properties: [:]) else { fail("png failed") }
try? png.write(to: URL(fileURLWithPath: outPath))
if !framePath.isEmpty, let fp = NSBitmapImageRep(cgImage: best.image).representation(using: .png, properties: [:]) { try? fp.write(to: URL(fileURLWithPath: framePath)) }

// Person bounds from the mask, for the composer (fractions of the frame, origin top-left).
CVPixelBufferLockBaseAddress(maskBuf, .readOnly)
let mw = CVPixelBufferGetWidth(maskBuf), mh = CVPixelBufferGetHeight(maskBuf), bpr = CVPixelBufferGetBytesPerRow(maskBuf)
let mp = CVPixelBufferGetBaseAddress(maskBuf)!.assumingMemoryBound(to: UInt8.self)
var minX = mw, maxX = 0, minY = mh, maxY = 0
for y in 0..<mh { for x in 0..<mw { if mp[y * bpr + x] > 128 { if x < minX { minX = x }; if x > maxX { maxX = x }; if y < minY { minY = y }; if y > maxY { maxY = y } } } }
let W = Double(best.image.width), H = Double(best.image.height)
func box(_ r: CGRect?) -> [String: Double] { guard let r = r else { return [:] }; return ["x": r.minX / W, "y": r.minY / H, "w": r.width / W, "h": r.height / H] }
let result: [String: Any] = [
  "width": best.image.width, "height": best.image.height,
  "best": ["t": best.t, "score": best.score, "parts": best.parts, "face": box(best.face),
           "person": ["x": Double(minX) / Double(mw), "y": Double(minY) / Double(mh), "w": Double(maxX - minX + 1) / Double(mw), "h": Double(maxY - minY + 1) / Double(mh)]],
  "frames": scored.map { ["t": $0.t, "score": $0.score, "parts": $0.parts] },
]
let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
