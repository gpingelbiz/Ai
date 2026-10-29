// OCR and face boxes for a user-supplied evidence image; a second mode draws irreversible solid redactions.
// Usage: ocr <image>
//        ocr --redact <image> <boxes.json> <out.png> <#RRGGBB> <radius>
import AppKit
import Foundation
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func imageAt(_ path: String) -> CGImage {
  guard let image = NSImage(contentsOfFile: path) else { fail("image could not be read") }
  var rect = CGRect(origin: .zero, size: image.size)
  guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fail("image pixels could not be read") }
  return cg
}

func topBox(_ rect: CGRect) -> [String: Double] {
  ["x": Double(rect.minX), "y": Double(1 - rect.maxY), "w": Double(rect.width), "h": Double(rect.height)]
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "--redact" {
  if args.count != 6 { fail("usage: ocr --redact <image> <boxes.json> <out.png> <#RRGGBB> <radius>") }
  let source = imageAt(args[1])
  guard let data = try? Data(contentsOf: URL(fileURLWithPath: args[2])), let boxes = try? JSONSerialization.jsonObject(with: data) as? [[String: Double]] else { fail("redaction boxes could not be read") }
  let colorText = args[4].trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  guard colorText.count == 6, let rgb = Int(colorText, radix: 16) else { fail("redaction color must be #RRGGBB") }
  let radius = CGFloat(Double(args[5]) ?? 0)
  let width = source.width, height = source.height
  guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("redaction canvas failed") }
  context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
  let r = CGFloat((rgb >> 16) & 255) / 255, g = CGFloat((rgb >> 8) & 255) / 255, b = CGFloat(rgb & 255) / 255
  context.setFillColor(CGColor(red: r, green: g, blue: b, alpha: 1))
  for box in boxes {
    let x = CGFloat(box["x"] ?? 0) * CGFloat(width), w = CGFloat(box["w"] ?? 0) * CGFloat(width)
    let h = CGFloat(box["h"] ?? 0) * CGFloat(height), y = (1 - CGFloat(box["y"] ?? 0) - CGFloat(box["h"] ?? 0)) * CGFloat(height)
    let rect = CGRect(x: x, y: y, width: w, height: h)
    context.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.fillPath()
  }
  guard let output = context.makeImage(), let png = NSBitmapImageRep(cgImage: output).representation(using: .png, properties: [:]) else { fail("redacted PNG failed") }
  do { try png.write(to: URL(fileURLWithPath: args[3])) } catch { fail("redacted PNG could not be written") }
  exit(0)
}

if args.count != 1 { fail("usage: ocr <image>") }
let image = imageAt(args[0])
let text = VNRecognizeTextRequest()
text.recognitionLevel = .accurate
text.recognitionLanguages = ["en-US"]
text.usesLanguageCorrection = true
let faces = VNDetectFaceRectanglesRequest()
do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([text, faces]) } catch { fail("Vision analysis failed: \(error.localizedDescription)") }

let lines: [[String: Any]] = (text.results ?? []).compactMap { observation in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  var spans: [[String: Any]] = []
  var index = candidate.string.startIndex
  while index < candidate.string.endIndex {
    let next = candidate.string.index(after: index)
    if let character = try? candidate.boundingBox(for: index..<next) {
      spans.append([
        "start": candidate.string[..<index].utf16.count,
        "end": candidate.string[..<next].utf16.count,
        "box": topBox(character.boundingBox),
      ])
    }
    index = next
  }
  return ["text": candidate.string, "confidence": Double(candidate.confidence), "box": topBox(observation.boundingBox), "spans": spans]
}
let faceBoxes: [[String: Any]] = (faces.results ?? []).map { ["confidence": Double($0.confidence), "box": topBox($0.boundingBox)] }
let output: [String: Any] = ["width": image.width, "height": image.height, "lines": lines, "faces": faceBoxes]
let json = try! JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
