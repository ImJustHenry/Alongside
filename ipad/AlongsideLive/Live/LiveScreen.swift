import SwiftUI
import UIKit

enum Theme {
    static let background = Color(hex: "#0b0f0e")
    static let accent = Color(hex: "#da6b45")
    static let live = Color(hex: "#ff7b72")
    static let swatches = ["#da6b45", "#e0457b", "#f2c94c", "#3fbf7f", "#2f7de1", "#ffffff"]
    static let widths: [(value: Double, label: String, dot: CGFloat)] = [
        (0.003, "Fine", 6), (0.006, "Medium", 10), (0.012, "Bold", 16),
    ]
}

/// Frosted panel used by the floating controls.
struct Glass: ViewModifier {
    var radius: CGFloat = 20
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(.white.opacity(0.1)))
            .shadow(color: .black.opacity(0.28), radius: 18, y: 8)
    }
}

extension View {
    func glass(_ radius: CGFloat = 20) -> some View { modifier(Glass(radius: radius)) }
}

/// Full-screen live view: camera stage with floating top bar, drawing dock and toasts.
struct LiveScreen: View {
    @ObservedObject var session: LiveSession
    let openServerSettings: () -> Void

    @State private var showMenu = false
    @State private var confirmClear = false
    @State private var toast: String?
    @State private var toastTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            LiveStage(session: session).ignoresSafeArea()

            if let lock = lockMessage {
                LockCard(title: lock.0, detail: lock.1, spinning: lock.2)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }

            VStack(spacing: 12) {
                topBar
                Spacer()
                if let toast {
                    Text(toast)
                        .font(.system(size: 15, weight: .medium))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .glass(22)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .allowsHitTesting(false)
                }
                dock
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .animation(.easeOut(duration: 0.25), value: toast)
        .animation(.easeOut(duration: 0.25), value: lockMessage?.0)
        .sheet(isPresented: $showMenu) {
            SessionMenu(session: session, openServerSettings: {
                showMenu = false
                openServerSettings()
            })
        }
        .confirmationDialog("Remove all of your strokes from the wearer's space?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear my strokes", role: .destructive) { session.clearMine() }
        }
        .onChange(of: session.noticeID) { _, _ in
            toast = session.notice
            toastTask?.cancel()
            toastTask = Task {
                try? await Task.sleep(for: .seconds(3.8))
                if !Task.isCancelled { toast = nil }
            }
        }
    }

    private var lockMessage: (String, String, Bool)? {
        if !session.socketConnected { return ("Connecting…", "Reaching the Alongside server.", true) }
        if session.room?.writingAllowed == false { return ("Drawing paused", "The host turned spatial writing off for everyone.", false) }
        if !session.streamLive { return ("Waiting for the Quest camera", "Ask the wearer to pinch Camera ON above the board.", true) }
        if session.frame == nil { return ("Starting video…", "The first camera frame is on its way.", true) }
        return nil
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(alignment: .top) {
            HStack(spacing: 12) {
                StatusPill(live: session.streamLive)
                VStack(alignment: .leading, spacing: 1) {
                    Text(session.hostTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    Text(statusLine)
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.leading, 8)
            .padding(.trailing, 16)
            .padding(.vertical, 8)
            .glass()

            Spacer(minLength: 12)

            HStack(spacing: 2) {
                Avatars(members: session.peers.isEmpty ? (session.me.map { [$0] } ?? []) : session.peers)
                    .padding(.horizontal, 10)
                IconButton(systemName: "tag", label: "Author labels", on: session.showLabels) {
                    session.showLabels.toggle()
                }
                IconButton(systemName: "ellipsis", label: "Session menu") { showMenu = true }
            }
            .padding(6)
            .glass()
        }
    }

    private var statusLine: String {
        var s = "Room \(session.room?.id ?? "—")"
        if session.streamLive, session.frame != nil {
            s += " · \(session.fps) fps · " + (session.latencyMs < 0 ? "clock skew" : "\(session.latencyMs) ms")
        }
        return s
    }

    // MARK: Dock

    private var dock: some View {
        HStack(spacing: 8) {
            HStack(spacing: 9) {
                ForEach(Theme.swatches, id: \.self) { hex in
                    Button {
                        session.inkHex = hex
                    } label: {
                        Circle()
                            .fill(Color(hex: hex))
                            .frame(width: 30, height: 30)
                            .overlay(Circle().strokeBorder(.white.opacity(0.3), lineWidth: 1.5))
                            .padding(3)
                            .overlay(Circle().strokeBorder(.white, lineWidth: session.inkHex == hex ? 2.5 : 0))
                    }
                    .accessibilityLabel("Ink \(hex)")
                    .accessibilityAddTraits(session.inkHex == hex ? .isSelected : [])
                }
                ColorPicker("Custom ink color", selection: Binding(
                    get: { Color(hex: session.inkHex) },
                    set: { session.inkHex = UIColor($0).hexString }
                ), supportsOpacity: false)
                .labelsHidden()
                .frame(width: 36, height: 36)
            }
            .padding(.horizontal, 4)

            Divider().frame(height: 28).overlay(.white.opacity(0.12))

            HStack(spacing: 0) {
                ForEach(Theme.widths, id: \.value) { w in
                    Button {
                        session.width = w.value
                    } label: {
                        Circle()
                            .fill(Color(hex: session.inkHex))
                            .frame(width: w.dot, height: w.dot)
                            .frame(width: 40, height: 44)
                            .background(session.width == w.value ? .white.opacity(0.16) : .clear,
                                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .accessibilityLabel("\(w.label) stroke")
                    .accessibilityAddTraits(session.width == w.value ? .isSelected : [])
                }
            }

            Divider().frame(height: 28).overlay(.white.opacity(0.12))

            IconButton(systemName: "arrow.uturn.backward", label: "Undo my spatial stroke") { session.undo() }
                .disabled(!session.canDraw)
            IconButton(systemName: "trash", label: "Clear my strokes") { confirmClear = true }
                .disabled(!session.canDraw)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .glass(26)
    }
}

// MARK: - Pieces

struct StatusPill: View {
    let live: Bool
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .frame(width: 8, height: 8)
                .opacity(live && pulse ? 0.35 : 1)
            Text(live ? "LIVE" : "OFFLINE")
                .font(.system(size: 12, weight: .bold))
                .tracking(0.6)
        }
        .foregroundStyle(live ? Theme.live : .secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(live ? Color(red: 1, green: 0.27, blue: 0.23).opacity(0.18) : .white.opacity(0.08), in: Capsule())
        .onAppear {
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true }
        }
    }
}

struct IconButton: View {
    let systemName: String
    let label: String
    var on = false
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 19, weight: .medium))
                .frame(width: 44, height: 44)
                .background(on ? .white.opacity(0.16) : .clear, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .opacity(enabled ? 1 : 0.32)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct Avatars: View {
    let members: [Member]

    var body: some View {
        HStack(spacing: -8) {
            ForEach(members.prefix(4)) { m in
                AvatarCircle(member: m)
                    .overlay(Circle().strokeBorder(Color(hex: "#18201d"), lineWidth: 2))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(members.count) people in the room")
    }
}

struct AvatarCircle: View {
    let member: Member
    var size: CGFloat = 30

    var body: some View {
        Text(String(member.name.prefix(1)).uppercased())
            .font(.system(size: size * 0.43, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(hex: member.color), in: Circle())
    }
}

struct LockCard: View {
    let title: String
    let detail: String
    let spinning: Bool

    var body: some View {
        VStack(spacing: 8) {
            if spinning {
                ProgressView().controlSize(.large).tint(Theme.accent).padding(.bottom, 6)
            }
            Text(title).font(.system(size: 19, weight: .semibold))
            Text(detail).font(.system(size: 14)).foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 30)
        .padding(.vertical, 26)
        .frame(maxWidth: 380)
        .glass(22)
    }
}

// MARK: - Session menu

struct SessionMenu: View {
    @ObservedObject var session: LiveSession
    let openServerSettings: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var question = "What should I inspect next? Explain uncertainty."
    @State private var consent = false
    @State private var asking = false
    @State private var answer: String?
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            Form {
                Section("In the room") {
                    ForEach(session.peers.isEmpty ? (session.me.map { [$0] } ?? []) : session.peers) { m in
                        HStack(spacing: 12) {
                            AvatarCircle(member: m, size: 30)
                            Text(m.name)
                            if m.id == session.me?.id { Text("you").foregroundStyle(.secondary) }
                            if m.role == "host" || m.name == session.room?.hostName {
                                Spacer()
                                Text("Quest").font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }

                Section {
                    TextField("Question", text: $question, axis: .vertical)
                        .lineLimit(3...6)
                    Toggle("Send this frame and question to the room's AI", isOn: $consent)
                    Button {
                        asking = true
                        Task {
                            answer = await session.ask(question)
                            asking = false
                        }
                    } label: {
                        if asking { ProgressView() } else { Text("Ask AI about this view") }
                    }
                    .disabled(asking || !consent || !session.streamLive || question.trimmingCharacters(in: .whitespaces).isEmpty)
                    if let answer {
                        Text(answer).font(.callout).textSelection(.enabled)
                    }
                } header: {
                    Text("Ask AI")
                } footer: {
                    Text("Without an AI key on the server, the reply is a clearly labelled scripted answer.")
                }

                Section("Connection") {
                    LabeledContent("Server", value: session.server.absoluteString)
                    LabeledContent("Your name", value: session.displayName)
                    Button("Change server", action: openServerSettings)
                    Button("Use a different pairing code", role: .destructive) { confirmForget = true }
                }
            }
            .navigationTitle("Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Unpair this iPad?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Unpair", role: .destructive) {
                    dismiss()
                    session.forgetPairing()
                }
            } message: {
                Text("You'll need the 6-digit code from the server window to pair again.")
            }
        }
    }
}
