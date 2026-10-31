// Original audio only. JSON lines use source seconds and public SoundAnalysis version-1 labels.
// Usage: reactions <original-audio-or-video>
import AVFoundation
import Foundation
import SoundAnalysis

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

final class Observer: NSObject, SNResultsObserving {
  let groups: [String: Set<String>]
  var failure: Error?
  init(known: [String]) {
    let available = Set(known)
    groups = [
      "applause": available.intersection(["applause", "clapping"]),
      "cheering": available.intersection(["cheering"]),
      "laughter": available.intersection(["laughter", "giggling", "snicker", "belly_laugh", "chuckle_chortle"]),
      "crowd": available.intersection(["crowd", "booing"])
    ]
    super.init()
  }
  func request(_ request: SNRequest, didProduce result: SNResult) {
    guard let result = result as? SNClassificationResult else { return }
    // Class confidences overlap: take the maximum, never sum them into a probability.
    var row: [String: Double] = ["t": result.timeRange.start.seconds, "duration": result.timeRange.duration.seconds]
    for (kind, labels) in groups {
      row[kind] = result.classifications.filter { labels.contains($0.identifier) }.map { $0.confidence }.max() ?? 0
    }
    guard let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return }
    print(text)
  }
  func request(_ request: SNRequest, didFailWithError error: Error) { failure = error }
  func requestDidComplete(_ request: SNRequest) {}
}

guard CommandLine.arguments.count == 2 else { fail("usage: reactions <original-audio-or-video>") }
if #available(macOS 12.0, *) {
  do {
    let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
    // The public setter rounds an unsupported duration to the nearest supported window.
    request.windowDuration = CMTime(seconds: 1.5, preferredTimescale: 48000)
    request.overlapFactor = 0.5
    let known = request.knownClassifications
    let observer = Observer(known: known)
    let analyzer = try SNAudioFileAnalyzer(url: URL(fileURLWithPath: CommandLine.arguments[1]))
    try analyzer.add(request, withObserver: observer)
    analyzer.analyze()
    if let error = observer.failure { fail("SoundAnalysis: \(error.localizedDescription)") }
  } catch { fail("SoundAnalysis: \(error.localizedDescription)") }
} else { fail("SoundAnalysis version1 requires macOS 12 or newer") }
