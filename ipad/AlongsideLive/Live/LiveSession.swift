import Foundation
import SwiftUI
import UIKit
import os

private let log = Logger(subsystem: "edu.slu.stanfordxr.alongside.ipad", category: "LiveSession")

/// Everything between the iPad and the Alongside server for one server address:
/// pairing, joining the Quest's room, the live WebSocket (camera frames, room state,
/// presence) and sending strokes for the headset to place in 3D.
@MainActor
final class LiveSession: ObservableObject {
    enum Phase: Equatable {
        case needsPairing
        case connecting(String)
        case waitingForQuest(String)
        case joined
    }

    // MARK: Published state

    @Published private(set) var phase: Phase = .connecting("Connecting…")
    @Published private(set) var room: RoomState?
    @Published private(set) var me: Member?
    @Published private(set) var peers: [Member] = []
    @Published private(set) var streamLive = false
    @Published private(set) var socketConnected = false
    @Published private(set) var frame: LiveFrame?
    @Published private(set) var stroke: ActiveStroke?
    @Published private(set) var fps = 0
    @Published private(set) var latencyMs = 0
    @Published private(set) var pairingError: String?
    /// Short message shown as a toast; `noticeID` changes on every new message.
    @Published private(set) var notice = ""
    @Published private(set) var noticeID = 0

    // Drawing settings
    @Published var inkHex = "#da6b45"
    @Published var width: Double = 0.006
    @Published var showLabels = true

    let server: URL
    private let api: AlongsideAPI
    private weak var finder: ServerFinder?
    private let defaults = UserDefaults.standard

    private var hostName: String?
    private var socket: URLSessionWebSocketTask?
    private var socketTask: Task<Void, Never>?
    private var pairTask: Task<Void, Never>?
    private var followTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var active = false
    private var decoding = false
    private var pendingFrame: Data?
    private var frameTimes: [Date] = []

    struct ActiveStroke {
        let id: String
        let frame: LiveFrame
        var points: [UV]
        let color: String
        let width: Double
        let started: Date
        var lastSent: Date
    }

    init(server: URL, finder: ServerFinder) {
        self.server = server
        self.api = AlongsideAPI(base: server)
        self.finder = finder
    }

    var displayName: String {
        get { defaults.string(forKey: "displayName") ?? "iPad" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "displayName") }
    }

    var hostTitle: String { room?.hostName ?? hostName ?? "Quest" }

    var canDraw: Bool {
        phase == .joined && socketConnected && streamLive && (room?.writingAllowed ?? true)
    }

    // MARK: Lifecycle

    func start() {
        guard !active else { return }
        active = true
        if finder?.pairCode == nil {
            phase = .needsPairing
        } else {
            connectToQuest()
        }
    }

    func stop() {
        active = false
        pairTask?.cancel()
        followTask?.cancel()
        closeSocket()
    }

    /// App came back to the foreground: reconnect right away instead of waiting for backoff.
    func resume() {
        guard active, phase == .joined, !socketConnected else { return }
        reconnectAttempt = 0
        openSocket()
    }

    // MARK: Pairing

    func pair(code: String, name: String) {
        pairingError = nil
        displayName = name.isEmpty ? "iPad" : name
        finder?.pairCode = code
        connectToQuest()
    }

    func forgetPairing() {
        finder?.pairCode = nil
        clearSavedSession()
        closeSocket()
        followTask?.cancel()
        room = nil
        frame = nil
        phase = .needsPairing
    }

    /// Poll the server until the Quest is hosting a room, then join it.
    private func connectToQuest() {
        pairTask?.cancel()
        phase = .connecting("Looking for the Quest…")
        pairTask = Task { [weak self] in
            while let self, !Task.isCancelled, self.active {
                guard let code = self.finder?.pairCode else {
                    self.phase = .needsPairing
                    return
                }
                do {
                    let current = try await self.api.liveCurrent(pairCode: code)
                    self.hostName = current.host
                    try await self.join(current)
                    return
                } catch let e as AlongsideAPI.Failure where e.status == 403 {
                    self.finder?.pairCode = nil
                    self.pairingError = "That pairing code didn't match. Check the server window."
                    self.phase = .needsPairing
                    return
                } catch let e as AlongsideAPI.Failure where e.status == 404 {
                    self.phase = .waitingForQuest("Open Alongside LiveView in the headset.")
                } catch {
                    self.phase = .waitingForQuest("Can't reach the Alongside server. Retrying…")
                    if await !ServerAddress.isReachable(self.server) {
                        self.finder?.currentServerFailed()
                        return
                    }
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private struct SavedSession: Codable {
        let server: String
        let room: String
        let token: String
        let member: Member
    }

    private func join(_ current: LiveCurrent) async throws {
        // Reuse our membership if we were already in this room (avoids piling up members).
        if let data = defaults.data(forKey: "session"),
           let saved = try? JSONDecoder().decode(SavedSession.self, from: data),
           saved.server == server.absoluteString, saved.room == current.room {
            me = saved.member
            token = saved.token
            roomID = saved.room
        } else {
            let joined = try await api.join(room: current.room, invite: current.invite, name: displayName)
            me = joined.member
            token = joined.token
            roomID = joined.room.id
            room = joined.room
            let saved = SavedSession(server: server.absoluteString, room: joined.room.id, token: joined.token, member: joined.member)
            defaults.set(try? JSONEncoder().encode(saved), forKey: "session")
        }
        log.notice("Joined room \(self.roomID ?? "?", privacy: .public)")
        phase = .joined
        reconnectAttempt = 0
        openSocket()
        followQuest()
    }

    private var token: String?
    private var roomID: String?

    private func clearSavedSession() {
        defaults.removeObject(forKey: "session")
        token = nil
        roomID = nil
    }

    /// If the Quest restarts and hosts a new room, follow it.
    private func followQuest() {
        followTask?.cancel()
        followTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self, self.active, let code = self.finder?.pairCode, let current = self.roomID else { return }
                if let live = try? await self.api.liveCurrent(pairCode: code), live.room != current {
                    self.say("The Quest opened a new room. Switching…")
                    self.closeSocket()
                    self.clearSavedSession()
                    self.frame = nil
                    self.connectToQuest()
                    return
                }
            }
        }
    }

    // MARK: WebSocket

    private func openSocket() {
        closeSocket()
        guard let roomID, let token else { return }
        var parts = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        parts.scheme = server.scheme == "https" ? "wss" : "ws"
        parts.path = "/live"
        guard let url = parts.url else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        task.maximumMessageSize = 2_000_000
        socket = task
        task.resume()
        sendJSON(["type": "auth", "room": roomID, "token": token])
        socketTask = Task { [weak self] in
            var subscribed = false
            while !Task.isCancelled {
                guard let message = try? await task.receive() else { break }
                guard let self else { return }
                switch message {
                case .data(let data):
                    self.receiveFrame(data)
                case .string(let text):
                    self.handle(text: text, subscribed: &subscribed)
                @unknown default:
                    break
                }
            }
            await MainActor.run { self?.socketClosed(task) }
        }
    }

    private func closeSocket() {
        socketTask?.cancel()
        socketTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        socketConnected = false
        streamLive = false
        stroke = nil
    }

    private func socketClosed(_ task: URLSessionWebSocketTask) {
        guard task === socket else { return } // an old socket we already replaced
        socket = nil
        socketConnected = false
        streamLive = false
        stroke = nil
        guard active, phase == .joined else { return }
        let delay = min(pow(2, Double(reconnectAttempt)), 10)
        reconnectAttempt += 1
        log.notice("Socket closed; reconnecting in \(delay, privacy: .public)s")
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, self.active, self.phase == .joined, self.socket == nil else { return }
            // Several failures in a row: maybe the server moved (e.g. we left the room).
            if self.reconnectAttempt >= 3, await !ServerAddress.isReachable(self.server) {
                self.finder?.currentServerFailed()
                return
            }
            self.openSocket()
        }
    }

    private func sendJSON(_ object: [String: Any]) {
        guard let socket, let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    private func send<T: Encodable>(_ value: T) {
        guard let socket, let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    private struct Envelope: Decodable { let type: String }
    private struct StateMessage: Decodable { let state: RoomState }
    private struct PresenceMessage: Decodable { let members: [Member] }
    private struct ErrorMessage: Decodable { let error: String }
    private struct ResultMessage: Decodable {
        let id: String?
        var error: String?
        var placement: String?
        var anchorId: String?
    }

    private func handle(text: String, subscribed: inout Bool) {
        let data = Data(text.utf8)
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { return }
        switch envelope.type {
        case "state":
            if let m = try? JSONDecoder().decode(StateMessage.self, from: data) {
                room = m.state
                if !m.state.writingAllowed, stroke != nil { cancelStroke() }
            }
            socketConnected = true
            reconnectAttempt = 0
            if !subscribed {
                subscribed = true
                sendJSON(["type": "watchLive", "enabled": true])
            }
        case "presence":
            if let m = try? JSONDecoder().decode(PresenceMessage.self, from: data) { peers = m.members }
        case "streamStatus":
            if let s = try? JSONDecoder().decode(StreamStatus.self, from: data) {
                if s.live != streamLive {
                    say(s.live ? "Live camera connected." : "The Quest camera stopped.")
                    if !s.live {
                        frame = nil
                        stroke = nil
                    }
                }
                streamLive = s.live
            }
        case "remoteResult":
            if let r = try? JSONDecoder().decode(ResultMessage.self, from: data) {
                if let error = r.error { say(error) }
                else if r.placement == "fixed-distance" { say("Placed 1.5 m in front of the wearer — no surface found there") }
                else { say("Pinned to \(surfaceName(r.anchorId)) in the wearer's space") }
            }
        case "error":
            if let e = try? JSONDecoder().decode(ErrorMessage.self, from: data) {
                // Our saved membership is no longer valid (e.g. server data reset): join again.
                let lostMembership = e.error.localizedCaseInsensitiveContains("token") ||
                    e.error.localizedCaseInsensitiveContains("room not found")
                if !socketConnected, lostMembership {
                    clearSavedSession()
                    closeSocket()
                    connectToQuest()
                    return
                }
                say(e.error)
            }
        default:
            break
        }
    }

    // MARK: Frames

    /// Packet: UInt32 little-endian JSON length, JSON metadata, JPEG bytes.
    private func receiveFrame(_ data: Data) {
        if decoding {
            pendingFrame = data // keep only the newest
            return
        }
        decoding = true
        Task { [weak self] in
            var next: Data? = data
            while let packet = next {
                let decoded = await Task.detached(priority: .userInitiated) { LiveSession.unpack(packet) }.value
                guard let self else { return }
                if let (meta, image) = decoded {
                    self.show(LiveFrame(meta: meta, image: image, received: Date()))
                }
                next = self.pendingFrame
                self.pendingFrame = nil
            }
            self?.decoding = false
        }
    }

    nonisolated private static func unpack(_ data: Data) -> (FrameMeta, UIImage)? {
        guard data.count > 12 else { return nil }
        let b = [UInt8](data.prefix(4))
        let n = Int(UInt32(b[0]) | UInt32(b[1]) << 8 | UInt32(b[2]) << 16 | UInt32(b[3]) << 24)
        guard n > 1, n + 4 < data.count else { return nil }
        let start = data.startIndex
        let metaData = data.subdata(in: (start + 4)..<(start + 4 + n))
        let jpeg = data.subdata(in: (start + 4 + n)..<data.endIndex)
        guard let meta = try? JSONDecoder().decode(FrameMeta.self, from: metaData),
              let image = UIImage(data: jpeg)?.preparingForDisplay()
        else { return nil }
        return (meta, image)
    }

    private func show(_ newFrame: LiveFrame) {
        streamLive = true
        frame = newFrame
        let now = Date()
        frameTimes = frameTimes.filter { now.timeIntervalSince($0) < 1 } + [now]
        fps = frameTimes.count
        latencyMs = Int(now.timeIntervalSince1970 * 1000 - newFrame.meta.ts)
        #if DEBUG
        demoStrokeIfRequested()
        #endif
    }

    #if DEBUG
    /// Debug aid (launch argument `-AlongsideDemoStroke YES`): once live, draw one stroke
    /// through the normal drawing path, so stroke sending can be tested without touch.
    private var demoStrokeDone = false
    private func demoStrokeIfRequested() {
        guard !demoStrokeDone, UserDefaults.standard.bool(forKey: "AlongsideDemoStroke"), canDraw else { return }
        demoStrokeDone = true
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self else { return }
            self.strokeBegan(at: UV(u: 0.3, v: 0.72))
            for i in 1...20 {
                try? await Task.sleep(for: .milliseconds(30))
                self.strokeMoved(to: [UV(u: 0.3 + Double(i) * 0.012, v: 0.72 - Double(i % 5) * 0.004)])
            }
            self.strokeEnded()
        }
    }
    #endif

    /// The frame on screen: frozen on the stroke's frame while drawing (the headset
    /// reprojects the stroke from that exact camera pose).
    var displayFrame: LiveFrame? { stroke?.frame ?? frame }

    // MARK: Strokes

    func strokeBegan(at p: UV) {
        guard canDraw else { return }
        guard let f = frame, Date().timeIntervalSince(f.received) < 1.8 else {
            say("Waiting for a fresh camera frame…")
            return
        }
        stroke = ActiveStroke(id: UUID().uuidString.lowercased(), frame: f, points: [p], color: inkHex, width: width,
                              started: Date(), lastSent: Date())
        sendStroke("preview")
    }

    func strokeMoved(to points: [UV]) {
        guard var s = stroke else { return }
        if Date().timeIntervalSince(s.started) > 9 {
            cancelStroke()
            say("That stroke took too long. Draw a shorter one on a fresh frame.")
            return
        }
        for p in points where s.points.count < 256 {
            if let last = s.points.last, hypot(p.u - last.u, p.v - last.v) < 0.003 { continue }
            s.points.append(p)
        }
        let now = Date()
        let due = now.timeIntervalSince(s.lastSent) > 0.09
        if due { s.lastSent = now }
        stroke = s
        if due { sendStroke("preview") }
    }

    func strokeEnded() {
        guard stroke != nil else { return }
        sendStroke("commit")
        stroke = nil
        say("Placing your stroke in the wearer's space…")
    }

    func cancelStroke() {
        guard stroke != nil else { return }
        sendStroke("cancel")
        stroke = nil
    }

    private func sendStroke(_ phase: String) {
        guard let s = stroke else { return }
        send(RemoteStroke(id: s.id, epoch: s.frame.meta.epoch, frameSeq: s.frame.meta.seq, phase: phase,
                          points: s.points, color: s.color, width: s.width))
    }

    // MARK: Actions

    func undo() { runAction(["type": "spatial.undo"]) }
    func clearMine() { runAction(["type": "spatial.clearMine"]) }

    private func runAction(_ body: [String: Any]) {
        guard let roomID, let token else { return }
        Task {
            do { try await api.action(room: roomID, token: token, body) }
            catch { say(error.localizedDescription) }
        }
    }

    func ask(_ prompt: String) async -> String {
        guard let roomID, let token else { return "Not connected." }
        do { return try await api.askAboutFrame(room: roomID, token: token, prompt: prompt) }
        catch { return error.localizedDescription }
    }

    func say(_ text: String) {
        notice = text
        noticeID += 1
    }
}
