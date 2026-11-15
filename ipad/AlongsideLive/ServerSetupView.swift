import SwiftUI

/// Manual fallback: type the server's address, or pick a known one. Normally not needed —
/// the app finds the server by itself (Bonjour, remembered and public addresses).
struct ServerSetupView: View {
    let canCancel: Bool
    let notice: String?
    let onConnect: (URL) -> Void
    let onSearchAgain: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft = ServerAddress.presets[0].address
    @State private var checking = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                if let notice {
                    Section {
                        Label(notice, systemImage: "magnifyingglass")
                        Button("Search again") { finish(onSearchAgain) }
                    } footer: {
                        Text("Easiest: on the laptop, open http://localhost:4173/connect and scan the QR code with this iPad's Camera. It opens this app connected and paired.")
                    }
                }

                Section {
                    TextField("192.168.137.1:4173", text: $draft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .onSubmit(connect)
                } header: {
                    Text("Server address")
                } footer: {
                    Text("The address the server prints when it starts. A public https:// address works from anywhere.")
                }

                Section("Quick picks") {
                    ForEach(ServerAddress.presets, id: \.address) { preset in
                        Button {
                            draft = preset.address
                            connect()
                        } label: {
                            LabeledContent(preset.label, value: preset.address)
                        }
                    }
                }

                if let problem {
                    Section {
                        Label(problem, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        if let url = ServerAddress.normalize(draft) {
                            Button("Use \(url.absoluteString) anyway") { finish { onConnect(url) } }
                        }
                    }
                }
            }
            .navigationTitle("Alongside Live")
            .toolbar {
                if canCancel {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if checking {
                        ProgressView()
                    } else {
                        Button("Connect", action: connect)
                            .disabled(ServerAddress.normalize(draft) == nil)
                    }
                }
            }
        }
    }

    private func finish(_ action: () -> Void) {
        action()
        if canCancel { dismiss() }
    }

    private func connect() {
        guard let url = ServerAddress.normalize(draft) else {
            problem = "That doesn't look like an address. Try something like 192.168.137.1:4173."
            return
        }
        draft = url.absoluteString
        problem = nil
        checking = true
        Task {
            let ok = await ServerAddress.isReachable(url, timeout: url.scheme == "https" ? 8 : 3)
            checking = false
            if ok {
                finish { onConnect(url) }
            } else {
                problem = "No answer from \(url.absoluteString). Is the server running, and is this iPad on the same network?"
            }
        }
    }
}
