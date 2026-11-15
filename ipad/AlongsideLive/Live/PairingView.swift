import SwiftUI

/// The Alongside logo: two interlocking rings and the wordmark.
struct BrandMark: View {
    var body: some View {
        HStack(spacing: 10) {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 12).stroke(.white, lineWidth: 2)
                    .frame(width: 19, height: 25).rotationEffect(.degrees(-25))
                RoundedRectangle(cornerRadius: 12).stroke(Theme.accent, lineWidth: 2)
                    .frame(width: 19, height: 25).rotationEffect(.degrees(25)).offset(x: 10)
            }
            .frame(width: 30, height: 32, alignment: .leading)
            (Text("alongside") + Text(".").foregroundColor(Theme.accent))
                .font(.custom("AvenirNext-DemiBold", size: 22))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Alongside")
    }
}

/// Dark backdrop with soft color glows, shared by the pairing and connecting screens.
struct GlowBackground: View {
    var body: some View {
        ZStack {
            Theme.background
            RadialGradient(colors: [Theme.accent.opacity(0.28), .clear], center: UnitPoint(x: 0.2, y: 0.1), startRadius: 0, endRadius: 520)
            RadialGradient(colors: [Color(hex: "#2f7de1").opacity(0.22), .clear], center: UnitPoint(x: 0.85, y: 0.9), startRadius: 0, endRadius: 480)
        }
        .ignoresSafeArea()
    }
}

struct Card<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .padding(.horizontal, 28)
            .padding(.top, 30)
            .padding(.bottom, 24)
            .frame(maxWidth: 440)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(.white.opacity(0.1)))
            .shadow(color: .black.opacity(0.45), radius: 40, y: 30)
            .padding(20)
    }
}

struct PairingView: View {
    @ObservedObject var session: LiveSession
    let openServerSettings: () -> Void

    @State private var name = ""
    @State private var code = ""
    @FocusState private var codeFocused: Bool

    private var valid: Bool { code.range(of: #"^\d{6}$"#, options: .regularExpression) != nil }

    var body: some View {
        ZStack {
            GlowBackground()
            ScrollView {
                Card {
                    BrandMark()
                    Text("Pair this iPad")
                        .font(.system(size: 30, weight: .bold))
                        .padding(.top, 10)
                    Text("See what the Quest wearer sees, and draw straight into their space.")
                        .foregroundStyle(.secondary)

                    field("Your name") {
                        TextField("iPad", text: $name)
                            .textContentType(.name)
                            .submitLabel(.next)
                            .onSubmit { codeFocused = true }
                    }
                    field("Pairing code") {
                        TextField("••••••", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .font(.system(size: 28, weight: .semibold, design: .monospaced))
                            .tracking(12)
                            .multilineTextAlignment(.center)
                            .focused($codeFocused)
                            .onChange(of: code) { _, new in
                                let digits = String(new.filter(\.isNumber).prefix(6))
                                if digits != new { code = digits }
                            }
                    }
                    Text("The 6-digit code is shown in the server window.")
                        .font(.footnote)
                        .foregroundStyle(.tertiary)

                    Button {
                        session.pair(code: code, name: name)
                    } label: {
                        Text("Pair")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(Theme.accent.opacity(valid ? 1 : 0.35), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .foregroundStyle(.white.opacity(valid ? 1 : 0.6))
                    }
                    .buttonStyle(.plain)
                    .disabled(!valid)
                    .padding(.top, 4)

                    if let error = session.pairingError {
                        Text(error)
                            .font(.callout)
                            .foregroundStyle(Color(hex: "#ffb4ad"))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                    }

                    Divider().overlay(.white.opacity(0.08)).padding(.top, 6)
                    HStack {
                        Text("You only pair once.").foregroundStyle(.tertiary)
                        Spacer()
                        Button("Change server", action: openServerSettings).foregroundStyle(Color(hex: "#f0a084"))
                    }
                    .font(.footnote)
                }
                .frame(maxWidth: .infinity, minHeight: 700)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .onAppear { name = session.displayName == "iPad" ? "" : session.displayName }
    }

    private func field<F: View>(_ title: String, @ViewBuilder _ content: () -> F) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
            content()
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.12)))
        }
    }
}

/// Shown while finding / joining the Quest's room.
struct ConnectingView: View {
    @ObservedObject var session: LiveSession
    let message: String
    let openServerSettings: () -> Void
    @State private var ping = false

    var body: some View {
        ZStack {
            GlowBackground()
            Card {
                BrandMark()
                ZStack {
                    ForEach(0..<2) { i in
                        Circle()
                            .stroke(Theme.accent.opacity(0.7), lineWidth: 2)
                            .scaleEffect(ping ? 1 : 0.35)
                            .opacity(ping ? 0 : 1)
                            .animation(.easeOut(duration: 2).repeatForever(autoreverses: false).delay(Double(i)), value: ping)
                    }
                    Circle().fill(Theme.accent).frame(width: 20, height: 20)
                }
                .frame(width: 72, height: 72)
                .padding(.top, 8)
                Text("Connecting to the Quest")
                    .font(.system(size: 30, weight: .bold))
                Text(message).foregroundStyle(.secondary)
                Divider().overlay(.white.opacity(0.08)).padding(.top, 6)
                HStack {
                    Button("Use a different pairing code") { session.forgetPairing() }
                    Spacer()
                    Button("Change server", action: openServerSettings)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color(hex: "#f0a084"))
            }
        }
        .onAppear { ping = true }
    }
}

/// Picks the screen for the session's phase.
struct LiveRootView: View {
    @StateObject private var session: LiveSession
    let openServerSettings: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    init(server: URL, finder: ServerFinder, openServerSettings: @escaping () -> Void) {
        _session = StateObject(wrappedValue: LiveSession(server: server, finder: finder))
        self.openServerSettings = openServerSettings
    }

    var body: some View {
        Group {
            switch session.phase {
            case .needsPairing:
                PairingView(session: session, openServerSettings: openServerSettings)
            case .connecting(let message), .waitingForQuest(let message):
                ConnectingView(session: session, message: message, openServerSettings: openServerSettings)
            case .joined:
                LiveScreen(session: session, openServerSettings: openServerSettings)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.phase)
        .onAppear { session.start() }
        .onDisappear { session.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { session.resume() }
        }
    }
}
