// Faces with lip motion over a stretch of video, for speaker-aware reframing. Decodes frames in order (fast) and
// runs Apple Vision landmarks every `step` seconds.
// Usage: speakers <video> <from> <to> <step>
// Prints JSON: {"width":W,"height":H,"frames":[{"t":t,"faces":[{"x","y","w","h","mouth","yaw"}]}]}
// Boxes are fractions of the upright frame, origin top-left. mouth = inner-lip height / outer-lip height (0 closed).
import AVFoundation
import Foundation
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
if args.count < 5 { fail("usage: speakers <video> <from> <to> <step>") }
guard let from = Double(args[2]), let to = Double(args[3]), let step = Double(args[4]), step > 0 else { fail("bad times") }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
guard let track = asset.tracks(withMediaType: .video).first else { fail("no video track") }
let reader = try! AVAssetReader(asset: asset)
reader.timeRange = CMTimeRange(start: CMTime(seconds: max(0, from), preferredTimescale: 600), end: CMTime(seconds: to, preferredTimescale: 600))
let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
output.alwaysCopiesSampleData = false
reader.add(output)
reader.startReading()

// The upright orientation: Vision gets the raw buffer plus the track's rotation.
let tf = track.preferredTransform
let angle = atan2(tf.b, tf.a)
var orientation = CGImagePropertyOrientation.up
if abs(angle - .pi / 2) < 0.1 { orientation = .right } else if abs(angle + .pi / 2) < 0.1 { orientation = .left } else if abs(abs(angle) - .pi) < 0.1 { orientation = .down }
let natural = track.naturalSize.applying(tf)
let width = abs(natural.width), height = abs(natural.height)

func box(_ r: CGRect) -> [String: Double] {
  ["x": Double(r.origin.x), "y": Double(1 - r.origin.y - r.size.height), "w": Double(r.size.width), "h": Double(r.size.height)]
}

var frames: [[String: Any]] = []
var next = from
while let sample = output.copyNextSampleBuffer() {
  let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
  if t + 1e-6 < next { continue }
  next += step
  guard let pb = CMSampleBufferGetImageBuffer(sample) else { continue }
  let req = VNDetectFaceLandmarksRequest()
  let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: orientation, options: [:])
  try? handler.perform([req])
  var faces: [[String: Double]] = []
  for f in (req.results ?? []) where f.confidence > 0.5 {
    var d = box(f.boundingBox)
    var mouth = 0.0
    if let lm = f.landmarks, let outer = lm.outerLips, let inner = lm.innerLips {
      let oy = outer.normalizedPoints.map { Double($0.y) }, iy = inner.normalizedPoints.map { Double($0.y) }
      let oh = (oy.max() ?? 0) - (oy.min() ?? 0), ih = (iy.max() ?? 0) - (iy.min() ?? 0)
      mouth = oh > 0 ? ih / oh : 0
    }
    d["mouth"] = mouth
    d["yaw"] = Double(truncating: f.yaw ?? 0)
    faces.append(d)
  }
  frames.append(["t": (t * 1000).rounded() / 1000, "faces": faces])
}
let out: [String: Any] = ["width": Double(width), "height": Double(height), "frames": frames]
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
print(String(data: data, encoding: .utf8)!)
