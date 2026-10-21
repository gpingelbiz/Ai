// Find faces (and upper bodies, for someone turned away) in a few frames of a video with Apple Vision.
// Usage: faces <video> <t1> [t2 ...]
// Prints JSON: {"width":W,"height":H,"frames":[{"t":t,"faces":[box],"bodies":[box]}]}
// Boxes are fractions of the displayed (upright) frame, origin top-left: {"x","y","w","h"}.
import AVFoundation
import Foundation
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
if args.count < 3 { fail("usage: faces <video> <t1> [t2 ...]") }
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
