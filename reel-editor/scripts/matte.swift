// Person matte for text-behind-subject: one grayscale PNG per frame (255 = person) over a stretch of a video,
// from Apple Vision's person segmentation, with a share of the previous frame blended in so edges do not flicker.
// Usage: matte <video> <from> <to> <outDir> [--quality accurate|balanced|fast] [--blend 0.35] [--max-frames N] [--grid 27x48]
// Prints JSON: {"frames":n,"width":W,"height":H,"fps":f,"coverage":0.31}
// The input is the editor's clean intermediate, which ffmpeg writes upright, so there is no rotation handling.
import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
var quality = "accurate"
var blend = 0.35
var maxFrames = 100000
var gridCols = 0
var gridRows = 0
func takeOpt(_ name: String) -> String? {
  if let i = args.firstIndex(of: name), i + 1 < args.count {
    let v = args[i + 1]
    args.removeSubrange(i...(i + 1))
    return v
  }
  return nil
}
if let q = takeOpt("--quality") { quality = q }
if let b = takeOpt("--blend"), let v = Double(b) { blend = min(0.9, max(0, v)) }
if let m = takeOpt("--max-frames"), let v = Int(m) { maxFrames = v }
if let g = takeOpt("--grid") {
  let p = g.lowercased().split(separator: "x")
  if p.count != 2 || Int(p[0]) == nil || Int(p[1]) == nil { fail("bad grid (use COLSxROWS)") }
  gridCols = max(1, Int(p[0])!)
  gridRows = max(1, Int(p[1])!)
}
if args.count < 4 { fail("usage: matte <video> <from> <to> <outDir> [--quality accurate|balanced|fast] [--blend 0.35] [--grid 27x48]") }
guard let from = Double(args[1]), let to = Double(args[2]), to > from else { fail("bad times") }
let outDir = args[3]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: URL(fileURLWithPath: args[0]))
guard let track = asset.tracks(withMediaType: .video).first else { fail("no video track") }
let reader = try! AVAssetReader(asset: asset)
reader.timeRange = CMTimeRange(start: CMTime(seconds: max(0, from), preferredTimescale: 600), end: CMTime(seconds: to, preferredTimescale: 600))
let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
output.alwaysCopiesSampleData = false
reader.add(output)
reader.startReading()
let fps = Double(track.nominalFrameRate)
let W = Int(track.naturalSize.width), H = Int(track.naturalSize.height)
if W < 2 || H < 2 { fail("no frame size") }

let ctx = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
let gray = CGColorSpaceCreateDeviceGray()
var prev: [UInt8]? = nil
var cur = [UInt8](repeating: 0, count: W * H)
var frames = 0
var coverage = 0.0
var gridMax = [Double](repeating: 0, count: gridCols * gridRows)

while let sample = output.copyNextSampleBuffer() {
  if frames >= maxFrames { break }
  guard let pb = CMSampleBufferGetImageBuffer(sample) else { continue }
  let req = VNGeneratePersonSegmentationRequest()
  req.qualityLevel = quality == "fast" ? .fast : quality == "balanced" ? .balanced : .accurate
  req.outputPixelFormat = kCVPixelFormatType_OneComponent8
  let handler = VNImageRequestHandler(cvPixelBuffer: pb, options: [:])
  do { try handler.perform([req]) } catch { fail("segmentation failed: \(error)") }
  guard let mask = req.results?.first?.pixelBuffer else { continue }
  // Vision returns the mask smaller than the frame; scale it up to the frame.
  let mw = CVPixelBufferGetWidth(mask), mh = CVPixelBufferGetHeight(mask)
  let ci = CIImage(cvPixelBuffer: mask).transformed(by: CGAffineTransform(scaleX: CGFloat(W) / CGFloat(mw), y: CGFloat(H) / CGFloat(mh)))
  ctx.render(ci, toBitmap: &cur, rowBytes: W, bounds: CGRect(x: 0, y: 0, width: W, height: H), format: .L8, colorSpace: gray)
  if let p = prev, blend > 0 {
    let a = blend, b = 1 - blend
    for i in 0..<cur.count { cur[i] = UInt8(min(255, a * Double(p[i]) + b * Double(cur[i]))) }
  }
  prev = cur
  if gridCols > 0 && gridRows > 0 {
    for row in 0..<gridRows {
      let y0 = row * H / gridRows, y1 = max(y0 + 1, (row + 1) * H / gridRows)
      for col in 0..<gridCols {
        let x0 = col * W / gridCols, x1 = max(x0 + 1, (col + 1) * W / gridCols)
        var cell = 0, samples = 0
        for y in stride(from: y0, to: y1, by: 4) {
          for x in stride(from: x0, to: x1, by: 4) { cell += Int(cur[y * W + x]); samples += 1 }
        }
        let i = row * gridCols + col
        gridMax[i] = max(gridMax[i], Double(cell) / Double(max(1, samples)) / 255)
      }
    }
  }
  var sum = 0
  var n = 0
  for i in stride(from: 0, to: cur.count, by: 97) { sum += Int(cur[i]); n += 1 }
  coverage += Double(sum) / Double(max(1, n)) / 255
  guard let cg = CGContext(data: &cur, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W, space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue)?.makeImage() else { continue }
  let url = URL(fileURLWithPath: outDir).appendingPathComponent(String(format: "%05d.png", frames + 1))
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
  CGImageDestinationAddImage(dest, cg, nil)
  CGImageDestinationFinalize(dest)
  frames += 1
}
if gridCols > 0 && gridRows > 0 {
  let grid: [String: Any] = ["cols": gridCols, "rows": gridRows, "cells": gridMax.map { round($0 * 10000) / 10000 }]
  let gridData = try! JSONSerialization.data(withJSONObject: grid, options: [])
  try! gridData.write(to: URL(fileURLWithPath: outDir).appendingPathComponent("occupancy.json"))
}
let out: [String: Any] = ["frames": frames, "width": W, "height": H, "fps": fps, "coverage": frames > 0 ? coverage / Double(frames) : 0]
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
print(String(data: data, encoding: .utf8)!)
