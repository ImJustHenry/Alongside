import Foundation
import SwiftUI
import UIKit

/// A normalized image point: u = 0 (left) … 1 (right), v = 0 (top) … 1 (bottom).
struct UV: Codable, Hashable {
    var u: Double
    var v: Double
}

struct Member: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String
    var role: String?
}

/// The parts of the server's room snapshot the iPad needs.
struct RoomState: Decodable {
    let id: String
    var title: String?
    var collaborativeWriting: Bool?
    var aiEnabled: Bool?
    var members: [Member]?

    var writingAllowed: Bool { collaborativeWriting != false }
    var hostName: String? { members?.first(where: { $0.role == "host" })?.name }
}

struct Overlay: Decodable {
    let id: String?
    var ownerName: String?
    var source: String?
    let color: String
    let points: [UV]
}

/// Metadata the headset sends with every camera frame.
struct FrameMeta: Decodable {
    let epoch: String
    let seq: Int
    let ts: Double
    let w: Int
    let h: Int
    var source: String?
    var calibration: String?
    var overlays: [Overlay]?
    var hands: [UV]?
}

/// A decoded camera frame, ready to draw.
struct LiveFrame {
    let meta: FrameMeta
    let image: UIImage
    let received: Date
}

struct StreamStatus: Decodable {
    let live: Bool
    var epoch: String?
    var captureUntil: Double?
}

struct LiveCurrent: Decodable {
    let room: String
    let invite: String
    var host: String?
}

struct JoinResponse: Decodable {
    let room: RoomState
    let member: Member
    let token: String
}

/// Stroke message for the headset to reproject into 3D.
struct RemoteStroke: Encodable {
    var type = "remoteStroke"
    let id: String
    let epoch: String
    let frameSeq: Int
    let phase: String
    let points: [UV]
    let color: String
    let width: Double
}

// MARK: Colors

extension Color {
    /// "#rrggbb" → Color (falls back to white).
    init(hex: String) {
        self.init(uiColor: UIColor(hex: hex))
    }
}

extension UIColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let n = UInt32(s, radix: 16) else {
            self.init(white: 1, alpha: 1)
            return
        }
        self.init(
            red: CGFloat((n >> 16) & 0xFF) / 255,
            green: CGFloat((n >> 8) & 0xFF) / 255,
            blue: CGFloat(n & 0xFF) / 255,
            alpha: 1
        )
    }

    /// "#rrggbb" (alpha ignored), as the server expects.
    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        let rgb = UIColor(cgColor: cgColor).cgColor.converted(
            to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil
        )
        if let c = rgb?.components, c.count >= 3 {
            r = c[0]; g = c[1]; b = c[2]
        } else {
            getRed(&r, green: &g, blue: &b, alpha: &a)
        }
        func byte(_ x: CGFloat) -> Int { Int((min(max(x, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }
}

/// Where the camera image sits inside a view (aspect-fit, centered).
func containRect(in size: CGSize, imageWidth: Int, imageHeight: Int) -> CGRect {
    guard imageWidth > 0, imageHeight > 0 else { return .zero }
    let s = min(size.width / CGFloat(imageWidth), size.height / CGFloat(imageHeight))
    let w = CGFloat(imageWidth) * s, h = CGFloat(imageHeight) * s
    return CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
}

/// Friendly name for where a stroke was pinned. Simulated anchors are named ("sim-desk");
/// real Quest anchors are opaque IDs.
func surfaceName(_ anchorId: String?) -> String {
    guard let id = anchorId, id.hasPrefix("sim-") else { return "a real surface" }
    var name = String(id.dropFirst(4))
    if name.hasSuffix("-wall") { name = "wall" }
    return "the " + name
}
