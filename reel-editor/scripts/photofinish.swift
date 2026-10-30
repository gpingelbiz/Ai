// Bounded, retouch-free photo finishing with Core Image and Apple Vision.
// Usage: photofinish <in> <out.jpg> [--grade none|muted-editorial|bw|warm]
//        [--intensity 0..1] [--grain 0..0.03] [--target-luma 0..1] [--analyze]
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
  min(high, max(low, value))
}

func number(_ text: String, name: String, range: ClosedRange<Double>) -> Double {
  guard let value = Double(text), range.contains(value) else { fail("\(name) must be \(range.lowerBound)...\(range.upperBound)") }
  return value
}

let argv = Array(CommandLine.arguments.dropFirst())
if argv.count < 2 { fail("usage: photofinish <in> <out.jpg> [--grade none|muted-editorial|bw|warm] [--intensity 0..1] [--grain 0..0.03] [--target-luma 0..1] [--analyze]") }
let input = argv[0], output = argv[1]
var grade = "none", intensity = 1.0, grain = 0.0, targetLuma: Double? = nil, printAnalysis = false
var index = 2
while index < argv.count {
  let flag = argv[index]
  if flag == "--analyze" { printAnalysis = true; index += 1; continue }
  guard index + 1 < argv.count else { fail("\(flag) needs a value") }
  let value = argv[index + 1]
  switch flag {
  case "--grade":
    guard ["none", "muted-editorial", "bw", "warm"].contains(value) else { fail("--grade is none, muted-editorial, bw or warm") }
    grade = value
  case "--intensity": intensity = number(value, name: "--intensity", range: 0...1)
  case "--grain": grain = number(value, name: "--grain", range: 0...0.03)
  case "--target-luma": targetLuma = number(value, name: "--target-luma", range: 0...1)
  default: fail("unknown option: \(flag)")
  }
  index += 2
}

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CIContext(options: [.workingColorSpace: colorSpace, .outputColorSpace: colorSpace])
guard let source = CIImage(contentsOf: URL(fileURLWithPath: input), options: [.applyOrientationProperty: true]) else {
  fail("could not read \(input)")
}

struct PixelStats {
  let medianLuma: Double
  let faceLuma: Double?
  let faceP10: Double?
  let saturation: Double
  let clippedFraction: Double
  let highlightFraction: Double
  let faceBoxes: [CGRect]
  let neutralMean: (Double, Double, Double)?

  func json() -> [String: Any] {
    [
      "medianLuma": medianLuma,
      "faceLuma": faceLuma ?? NSNull(),
      "saturation": saturation,
      "clippedPercent": clippedFraction * 100,
      "faceBoxes": faceBoxes.map { r in
        ["x": Double(r.minX), "y": Double(1 - r.maxY), "w": Double(r.width), "h": Double(r.height)]
      },
    ]
  }
}

func percentile(_ values: [Double], _ p: Double) -> Double {
  guard !values.isEmpty else { return 0 }
  let sorted = values.sorted()
  let at = clamp(p, 0, 1) * Double(sorted.count - 1)
  let lo = Int(floor(at)), hi = Int(ceil(at)), mix = at - Double(lo)
  return sorted[lo] * (1 - mix) + sorted[hi] * mix
}

func analysisImage(_ image: CIImage, side: Double = 256) -> CIImage {
  let extent = image.extent
  let scale = min(1, side / max(extent.width, extent.height))
  return image
    .transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
    .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
}

func stats(_ image: CIImage, faceBoxes supplied: [CGRect]? = nil) -> PixelStats {
  let small = analysisImage(image)
  let w = max(1, Int(small.extent.width.rounded(.down))), h = max(1, Int(small.extent.height.rounded(.down)))
  var pixels = [UInt8](repeating: 0, count: w * h * 4)
  context.render(small, toBitmap: &pixels, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .RGBA8, colorSpace: colorSpace)

  var faceBoxes = supplied ?? []
  if supplied == nil, let cg = context.createCGImage(small, from: small.extent) {
    let request = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    faceBoxes = (request.results ?? []).filter { $0.confidence > 0.5 }.map(\.boundingBox)
  }
  let mainFace = faceBoxes.max { $0.width * $0.height < $1.width * $1.height }
  var luminances: [Double] = [], faceLuminances: [Double] = []
  luminances.reserveCapacity(w * h)
  var satSum = 0.0, clipped = 0, highlights = 0
  var neutralR = 0.0, neutralG = 0.0, neutralB = 0.0, neutralCount = 0
  for y in 0..<h { for x in 0..<w {
    let at = (y * w + x) * 4
    let r = Double(pixels[at]) / 255, g = Double(pixels[at + 1]) / 255, b = Double(pixels[at + 2]) / 255
    let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    let hi = max(r, max(g, b)), lo = min(r, min(g, b)), saturation = hi > 0 ? (hi - lo) / hi : 0
    luminances.append(luma); satSum += saturation
    if max(r, max(g, b)) >= 0.995 { clipped += 1 }
    if luma > 0.96 { highlights += 1 }
    let nx = (Double(x) + 0.5) / Double(w), ny = (Double(y) + 0.5) / Double(h)
    if let face = mainFace, face.contains(CGPoint(x: nx, y: ny)) { faceLuminances.append(luma) }
    let inAnyFace = faceBoxes.contains { $0.contains(CGPoint(x: nx, y: ny)) }
    if !inAnyFace && saturation < 0.20 && luma >= 0.20 && luma <= 0.85 {
      neutralR += r; neutralG += g; neutralB += b; neutralCount += 1
    }
  } }
  let count = max(1, w * h)
  let neutral: (Double, Double, Double)? = neutralCount >= 128
    ? (neutralR / Double(neutralCount), neutralG / Double(neutralCount), neutralB / Double(neutralCount))
    : nil
  return PixelStats(
    medianLuma: percentile(luminances, 0.5),
    faceLuma: faceLuminances.isEmpty ? nil : percentile(faceLuminances, 0.5),
    faceP10: faceLuminances.isEmpty ? nil : percentile(faceLuminances, 0.1),
    saturation: satSum / Double(count),
    clippedFraction: Double(clipped) / Double(count),
    highlightFraction: Double(highlights) / Double(count),
    faceBoxes: faceBoxes,
    neutralMean: neutral
  )
}

func filter(_ name: String, image: CIImage, values: [String: Any] = [:]) -> CIImage {
  guard let f = CIFilter(name: name) else { return image }
  f.setValue(image, forKey: kCIInputImageKey)
  for (key, value) in values { f.setValue(value, forKey: key) }
  return f.outputImage ?? image
}

func toneCurve(_ image: CIImage, points: [(Double, Double)]) -> CIImage {
  var values: [String: Any] = [:]
  for (i, point) in points.enumerated() { values["inputPoint\(i)"] = CIVector(x: point.0, y: point.1) }
  return filter("CIToneCurve", image: image, values: values)
}

func blend(_ base: CIImage, _ changed: CIImage, amount: Double) -> CIImage {
  if amount <= 0 { return base }
  if amount >= 1 { return changed }
  return filter("CIDissolveTransition", image: base, values: [kCIInputTargetImageKey: changed, kCIInputTimeKey: amount])
}

func applyGrade(_ image: CIImage, name: String, amount: Double) -> CIImage {
  var changed = image
  switch name {
  case "muted-editorial":
    changed = filter("CIColorControls", image: changed, values: [kCIInputSaturationKey: 0.90])
    changed = toneCurve(changed, points: [(0, 0.018), (0.25, 0.235), (0.5, 0.505), (0.75, 0.775), (1, 0.995)])
  case "bw":
    changed = filter("CIColorControls", image: changed, values: [kCIInputSaturationKey: 0.0])
    changed = toneCurve(changed, points: [(0, 0.012), (0.20, 0.17), (0.5, 0.51), (0.82, 0.88), (1, 0.995)])
  case "warm":
    changed = filter("CITemperatureAndTint", image: changed, values: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 6650, y: 0)])
    changed = filter("CIColorControls", image: changed, values: [kCIInputSaturationKey: 0.95])
  default: break
  }
  return blend(image, changed, amount: amount)
}

func seedForFile(_ file: String) -> UInt64 {
  guard let handle = FileHandle(forReadingAtPath: file) else { return 0x91E10DA5C79E7B1D }
  defer { try? handle.close() }
  let data = handle.readData(ofLength: 65536)
  var hash: UInt64 = 1469598103934665603
  for byte in data { hash = (hash ^ UInt64(byte)) &* 1099511628211 }
  return hash
}

func addGrain(_ image: CIImage, strength: Double, seed: UInt64) -> CIImage {
  if strength <= 0 { return image }
  let side = 256
  var state = seed == 0 ? 1 : seed
  var bytes = [UInt8](repeating: 0, count: side * side)
  for i in bytes.indices {
    state = state &* 6364136223846793005 &+ 1442695040888963407
    bytes[i] = UInt8(truncatingIfNeeded: state >> 32)
  }
  guard let provider = CGDataProvider(data: Data(bytes) as CFData),
        let cg = CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: side,
                         space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                         provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return image }
  var noise = CIImage(cgImage: cg)
    .transformed(by: CGAffineTransform(translationX: image.extent.minX, y: image.extent.minY))
    .applyingFilter("CIAffineTile")
    .cropped(to: image.extent)
  let scale = strength
  noise = filter("CIColorMatrix", image: noise, values: [
    "inputRVector": CIVector(x: scale, y: 0, z: 0, w: 0),
    "inputGVector": CIVector(x: 0, y: scale, z: 0, w: 0),
    "inputBVector": CIVector(x: 0, y: 0, z: scale, w: 0),
    "inputBiasVector": CIVector(x: 0.5 - scale / 2, y: 0.5 - scale / 2, z: 0.5 - scale / 2, w: 0),
  ])
  return filter("CISoftLightBlendMode", image: noise, values: [kCIInputBackgroundImageKey: image]).cropped(to: image.extent)
}

func writeJPEG(_ image: CIImage, to file: String) {
  try? FileManager.default.createDirectory(at: URL(fileURLWithPath: file).deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
  guard let cg = context.createCGImage(image, from: image.extent),
        let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: file) as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
    fail("could not prepare \(file)")
  }
  CGImageDestinationAddImage(destination, cg, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
  if !CGImageDestinationFinalize(destination) { fail("could not write \(file)") }
}

let before = stats(source)
let sourceLuma = before.faceLuma ?? before.medianLuma
let safe = before.faceLuma == nil ? 0.36...0.54 : 0.38...0.62
let desired = clamp(targetLuma ?? sourceLuma, safe.lowerBound, safe.upperBound)
let ev = clamp(log2(max(0.001, desired) / max(0.001, sourceLuma)), -0.25, 0.25)
var finished = filter("CIExposureAdjust", image: source, values: [kCIInputEVKey: ev])

if let neutral = before.neutralMean {
  let mean = (neutral.0 + neutral.1 + neutral.2) / 3
  let gains = (clamp(mean / max(0.001, neutral.0), 0.94, 1.06), clamp(mean / max(0.001, neutral.1), 0.94, 1.06), clamp(mean / max(0.001, neutral.2), 0.94, 1.06))
  finished = filter("CIColorMatrix", image: finished, values: [
    "inputRVector": CIVector(x: gains.0, y: 0, z: 0, w: 0),
    "inputGVector": CIVector(x: 0, y: gains.1, z: 0, w: 0),
    "inputBVector": CIVector(x: 0, y: 0, z: gains.2, w: 0),
  ])
}
if before.highlightFraction > 0.03 || (before.faceP10 ?? 1) < 0.18 {
  finished = filter("CIHighlightShadowAdjust", image: finished, values: [
    "inputHighlightAmount": before.highlightFraction > 0.03 ? 0.78 : 1.0,
    "inputShadowAmount": (before.faceP10 ?? 1) < 0.18 ? 0.22 : 0.0,
  ])
}
finished = applyGrade(finished, name: grade, amount: intensity)
finished = addGrain(finished, strength: grain, seed: seedForFile(input))
let after = stats(finished, faceBoxes: before.faceBoxes)
var reasons: [String] = []
if after.clippedFraction - before.clippedFraction > 0.005 { reasons.append("clipped pixels rose by more than 0.5%") }
// A face that ends outside 0.34 to 0.68 is a reject only when the finish moved it further out (or out of the band);
// a dark face lifted part of the way toward the band is an improvement, not a failure (2026-10-30 real-photo test).
func bandDistance(_ v: Double) -> Double { v < 0.34 ? 0.34 - v : (v > 0.68 ? v - 0.68 : 0) }
if let face = after.faceLuma, bandDistance(face) > 0, bandDistance(face) >= bandDistance(before.faceLuma ?? face) - 0.005 {
  reasons.append("face luma left the safe 0.34 to 0.68 band")
}
let rejected = !reasons.isEmpty
writeJPEG(rejected ? source : finished, to: output)

if printAnalysis {
  var report = before.json()
  report["after"] = after.json()
  report["rejected"] = rejected
  report["reason"] = reasons.joined(separator: "; ")
  report["exposureEV"] = ev
  let data = try! JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
}
