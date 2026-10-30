// Find faces (and upper bodies, for someone turned away) in a few frames of a video with Apple Vision.
// Usage: faces <video> <t1> [t2 ...]
// Prints JSON: {"width":W,"height":H,"frames":[{"t":t,"faces":[box],"bodies":[box]}]}
// Boxes are fractions of the displayed (upright) frame, origin top-left: {"x","y","w","h"}.
//
// Photos (the Content Studio photo check): faces --photo <image> [<image> ...]
// Prints one JSON line per image: {"file","width","height","taken","screenshot","light","sharp","faces":[box + "quality"],
// "bodies":[box],"overallScore","isUtility"}. width/height are upright; quality is Vision's face capture quality
// (0-1: blur, closed eyes, angle); light is the mean luminance (0-1); sharp the variance of the Laplacian on a
// 256 px grey copy. overallScore is Vision's public -1...1 score; isUtility marks functional/document images.
import AVFoundation
import CoreImage
import Foundation
import ImageIO
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
if args.count >= 3 && args[1] == "--photo" {
  for file in args.dropFirst(2) { print(photoReport(file)) }
  exit(0)
}
if args.count < 3 { fail("usage: faces <video> <t1> [t2 ...]  |  faces --photo <image> [<image> ...]") }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
gen.maximumSize = CGSize(width: 1080, height: 1920)

func box(_ r: CGRect) -> [String: Double] {
  // Vision: normalized, origin bottom-left. Flip to top-left.
  ["x": Double(r.origin.x), "y": Double(1 - r.origin.y - r.size.height), "w": Double(r.size.width), "h": Double(r.size.height)]
}

var frames: [[String: Any]] = []
var size = CGSize.zero
for s in args.dropFirst(2) {
  guard let t = Double(s) else { continue }
  let cg: CGImage
  do {
    cg = try gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil)
  } catch {
    continue
  }
  size = CGSize(width: cg.width, height: cg.height)
  let faceReq = VNDetectFaceRectanglesRequest()
  let bodyReq = VNDetectHumanRectanglesRequest()
  bodyReq.upperBodyOnly = true
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  try? handler.perform([faceReq, bodyReq])
  let faces = (faceReq.results ?? []).filter { $0.confidence > 0.5 }.map { box($0.boundingBox) }
  let bodies = (bodyReq.results ?? []).filter { $0.confidence > 0.3 }.map { box($0.boundingBox) }
  frames.append(["t": t, "faces": faces, "bodies": bodies])
}
let out: [String: Any] = ["width": Double(size.width), "height": Double(size.height), "frames": frames]
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
print(String(data: data, encoding: .utf8)!)

/* ---------- photos ---------- */

func meanLight(_ img: CGImage) -> Double {
  let ci = CIImage(cgImage: img)
  let f = CIFilter(name: "CIAreaAverage")!
  f.setValue(ci, forKey: kCIInputImageKey)
  f.setValue(CIVector(cgRect: ci.extent), forKey: kCIInputExtentKey)
  var px = [UInt8](repeating: 0, count: 4)
  CIContext().render(f.outputImage!, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
  return (0.299 * Double(px[0]) + 0.587 * Double(px[1]) + 0.114 * Double(px[2])) / 255.0
}

func laplacianVariance(_ img: CGImage, side: Int = 256) -> Double {
  let w = side, h = max(16, Int(Double(side) * Double(img.height) / Double(max(1, img.width))))
  var buf = [UInt8](repeating: 0, count: w * h)
  guard let c = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 0 }
  c.interpolationQuality = .high
  c.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var sum = 0.0, sum2 = 0.0, count = 0.0
  for y in 1..<(h - 1) { for x in 1..<(w - 1) {
    let lap = Double(buf[y * w + x - 1]) + Double(buf[y * w + x + 1]) + Double(buf[(y - 1) * w + x]) + Double(buf[(y + 1) * w + x]) - 4 * Double(buf[y * w + x])
    sum += lap; sum2 += lap * lap; count += 1
  } }
  let mean = sum / max(1, count)
  return max(0, sum2 / max(1, count) - mean * mean) / (255.0 * 255.0)
}

func json(_ v: [String: Any]) -> String {
  String(data: try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys]), encoding: .utf8)!
}

func photoReport(_ file: String) -> String {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else {
    return json(["file": file, "error": "not an image this Mac can read"])
  }
  let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
  let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
  let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
  var pw = props[kCGImagePropertyPixelWidth] as? Int ?? 0, ph = props[kCGImagePropertyPixelHeight] as? Int ?? 0
  if orientation >= 5 { swap(&pw, &ph) }
  let taken = (exif[kCGImagePropertyExifDateTimeOriginal] as? String) ?? (tiff[kCGImagePropertyTIFFDateTime] as? String) ?? ""
  let comment = (exif[kCGImagePropertyExifUserComment] as? String) ?? ""
  let camera = (tiff[kCGImagePropertyTIFFModel] as? String) ?? ""
  // An upright working copy, 1600 px on the long side: Vision and the measures run on what a viewer sees.
  let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 1600]
  guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else {
    return json(["file": file, "error": "could not decode the image"])
  }
  let faceReq = VNDetectFaceRectanglesRequest()
  let qualityReq = VNDetectFaceCaptureQualityRequest()
  let bodyReq = VNDetectHumanRectanglesRequest()
  bodyReq.upperBodyOnly = true
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  try? handler.perform([faceReq, bodyReq])
  let found = (faceReq.results ?? []).filter { $0.confidence > 0.5 }
  if !found.isEmpty {
    qualityReq.inputFaceObservations = found
    try? handler.perform([qualityReq])
  }
  let scored = qualityReq.results ?? []
  let faces: [[String: Double]] = found.enumerated().map { i, f in
    var b = box(f.boundingBox)
    if i < scored.count, let q = scored[i].faceCaptureQuality { b["quality"] = Double(q) }
    return b
  }
  let bodies = (bodyReq.results ?? []).filter { $0.confidence > 0.3 }.map { box($0.boundingBox) }
  var aesthetic: Any = NSNull()
  var utility = false
  if #available(macOS 15.0, *) {
    let request = VNCalculateImageAestheticsScoresRequest()
    try? handler.perform([request])
    if let result = request.results?.first {
      aesthetic = Double(result.overallScore)
      utility = result.isUtility
    }
  }
  return json([
    "file": file, "width": pw, "height": ph, "taken": taken, "camera": camera,
    "screenshot": comment.lowercased().contains("screenshot"),
    "light": meanLight(cg), "sharp": laplacianVariance(cg), "faces": faces, "bodies": bodies,
    "overallScore": aesthetic, "isUtility": utility,
  ])
}
