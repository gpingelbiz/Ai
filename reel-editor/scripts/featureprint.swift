// Original upright scene frames only. No generated picture, identity matching or source modification.
// Usage: featureprint <video> <seconds> [seconds ...]
import Foundation
import AVFoundation
import Vision
import CoreGraphics

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}
let args = CommandLine.arguments
if args.count < 3 { fail("usage: featureprint <video> <seconds> [seconds ...]") }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 960, height: 960)
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
var frames: [[String: Any]] = []
for value in args.dropFirst(2) {
  autoreleasepool {
    guard let t = Double(value), let image = try? generator.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 60000), actualTime: nil) else { return }
    let printRequest = VNGenerateImageFeaturePrintRequest()
    printRequest.revision = 1 // Fixed revision keeps signatures comparable across OS upgrades.
    let textRequest = VNRecognizeTextRequest()
    textRequest.recognitionLevel = .fast
    textRequest.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    guard (try? handler.perform([printRequest, textRequest])) != nil,
          let observation = printRequest.results?.first,
          observation.elementType == .float else { return }
    let signature: [Double] = observation.data.withUnsafeBytes { raw in
      raw.bindMemory(to: Float.self).map { Double($0) }
    }
    let textArea = min(1, (textRequest.results ?? []).filter { $0.confidence >= 0.4 }.reduce(0.0) { sum, text in
      sum + Double(text.boundingBox.width * text.boundingBox.height)
    })
    // RGBA context avoids device-dependent RGB row padding. JS computes shared thumbnail metrics.
    var pixels = [UInt8](repeating: 0, count: 16 * 9 * 4)
    guard let context = CGContext(data: &pixels, width: 16, height: 9, bitsPerComponent: 8, bytesPerRow: 16 * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: 16, height: 9))
    let thumbnail = (0..<(16 * 9)).flatMap { i in [Int(pixels[i * 4]), Int(pixels[i * 4 + 1]), Int(pixels[i * 4 + 2])] }
    frames.append(["t": t, "width": image.width, "height": image.height, "signature": signature, "textArea": textArea, "thumbnail": thumbnail])
  }
}
let data = try! JSONSerialization.data(withJSONObject: ["frames": frames], options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
