import SwiftUI
import UIKit

/// The camera view: the latest frame (frozen while you draw), everyone's marks as the
/// headset projects them, the wearer's hands, and your stroke in progress. Touch or
/// Apple Pencil draws.
struct LiveStage: View {
    @ObservedObject var session: LiveSession

    var body: some View {
        GeometryReader { geo in
            let frame = session.displayFrame
            let rect = frame.map { containRect(in: geo.size, imageWidth: $0.meta.w, imageHeight: $0.meta.h) } ?? .zero
            ZStack {
                Canvas { ctx, size in
                    guard let f = frame else { return }
                    draw(f, in: rect, ctx: &ctx)
                }
                TouchCapture(
                    began: { p in if let u = uv(p, rect) { session.strokeBegan(at: u) } },
                    moved: { ps in
                        let points = ps.compactMap { uv($0, rect) }
                        if !points.isEmpty { session.strokeMoved(to: points) }
                    },
                    ended: { session.strokeEnded() },
                    cancelled: { session.cancelStroke() }
                )
            }
        }
    }

    private func uv(_ p: CGPoint, _ r: CGRect) -> UV? {
        guard r.width > 0, r.height > 0 else { return nil }
        let u = (p.x - r.minX) / r.width, v = (p.y - r.minY) / r.height
        return (0...1).contains(u) && (0...1).contains(v) ? UV(u: u, v: v) : nil
    }

    private func draw(_ f: LiveFrame, in r: CGRect, ctx: inout GraphicsContext) {
        ctx.draw(Image(uiImage: f.image), in: r)
        var clipped = ctx
        clipped.clip(to: Path(r))
        let pt = { (p: UV) in CGPoint(x: r.minX + p.u * r.width, y: r.minY + p.v * r.height) }

        func line(_ points: [UV], _ color: Color, _ width: CGFloat) {
            guard let first = points.first else { return }
            if points.count == 1 {
                let c = pt(first)
                clipped.fill(Path(ellipseIn: CGRect(x: c.x - width, y: c.y - width, width: width * 2, height: width * 2)), with: .color(color))
                return
            }
            var path = Path()
            path.addLines(points.map(pt))
            clipped.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
        }

        // Marks already placed in the wearer's space, as seen from this camera pose.
        for o in f.meta.overlays ?? [] {
            line(o.points, Color(hex: o.color), 3)
            if session.showLabels, let first = o.points.first, let name = o.ownerName ?? o.source, !name.isEmpty {
                var label = clipped
                label.addFilter(.shadow(color: .black.opacity(0.7), radius: 2))
                label.draw(Text(String(name.prefix(30))).font(.system(size: 12, weight: .semibold)).foregroundColor(.white),
                           at: CGPoint(x: pt(first).x + 6, y: pt(first).y - 7), anchor: .bottomLeading)
            }
        }
        // The wearer's tracked hands.
        for h in f.meta.hands ?? [] {
            let c = pt(h)
            clipped.fill(Path(ellipseIn: CGRect(x: c.x - 6, y: c.y - 6, width: 12, height: 12)), with: .color(Color(hex: "#b8ffd5")))
        }
        // Your stroke in progress.
        if let s = session.stroke { line(s.points, Color(hex: s.color), 4) }

        // Never let a simulated feed pass for a real camera.
        if f.meta.source == "simulation" {
            let tag = CGRect(x: r.minX + 12, y: r.maxY - 40, width: 232, height: 28)
            ctx.fill(Path(roundedRect: tag, cornerRadius: 6), with: .color(Color(hex: "#f9d378")))
            ctx.draw(Text("SIMULATED SOURCE — NOT CAMERA").font(.system(size: 12, weight: .bold)).foregroundColor(Color(hex: "#17261f")),
                     at: CGPoint(x: tag.midX, y: tag.midY))
        }
    }
}

/// Single-touch drawing input with coalesced touches (smooth Apple Pencil strokes).
struct TouchCapture: UIViewRepresentable {
    var began: (CGPoint) -> Void
    var moved: ([CGPoint]) -> Void
    var ended: () -> Void
    var cancelled: () -> Void

    func makeUIView(context: Context) -> TouchView {
        let v = TouchView()
        v.backgroundColor = .clear
        v.isMultipleTouchEnabled = false
        return v
    }

    func updateUIView(_ v: TouchView, context: Context) {
        v.began = began
        v.moved = moved
        v.ended = ended
        v.cancelled = cancelled
    }

    final class TouchView: UIView {
        var began: (CGPoint) -> Void = { _ in }
        var moved: ([CGPoint]) -> Void = { _ in }
        var ended: () -> Void = {}
        var cancelled: () -> Void = {}
        private weak var tracking: UITouch?

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard tracking == nil, let t = touches.first else { return }
            tracking = t
            began(t.location(in: self))
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let t = tracking, touches.contains(t) else { return }
            let all = event?.coalescedTouches(for: t) ?? [t]
            moved(all.map { $0.location(in: self) })
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let t = tracking, touches.contains(t) else { return }
            tracking = nil
            ended()
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let t = tracking, touches.contains(t) else { return }
            tracking = nil
            cancelled()
        }
    }
}
