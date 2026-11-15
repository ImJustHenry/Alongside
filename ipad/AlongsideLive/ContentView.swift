import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var finder: ServerFinder
    @Environment(\.scenePhase) private var scenePhase

    @State private var showSettings = false
    @State private var loadError: String?
    @State private var reloadToken = 0
    /// Re-search once per failure before showing the error screen.
    @State private var retriedSearch = false

    /// Matches the web app's dark iPad theme (#0b0f0e).
    static let background = Color(red: 0x0B / 255, green: 0x0F / 255, blue: 0x0E / 255)

    var body: some View {
        ZStack {
            Self.background.ignoresSafeArea()

            switch finder.state {
            case .searching:
                SearchingView(enterManually: { showSettings = true })

            case .found(let server):
                // Edge to edge: the page handles safe areas itself (viewport-fit=cover).
                LiveWebView(
                    url: finder.pageURL(for: server),
                    reloadToken: reloadToken,
                    loadError: $loadError,
                    onPairCode: { finder.pairCode = $0 },
                    onRequestSettings: { showSettings = true }
                )
                .ignoresSafeArea()
                if let loadError {
                    ConnectionErrorView(
                        server: server.absoluteString,
                        message: loadError,
                        retry: { retriedSearch = false; self.loadError = nil; finder.search() },
                        changeServer: { showSettings = true }
                    )
                }

            case .notFound:
                ServerSetupView(
                    canCancel: false,
                    notice: "Couldn't find the Alongside server automatically.",
                    onConnect: { finder.use($0) },
                    onSearchAgain: { finder.search() }
                )
            }
        }
        .sheet(isPresented: $showSettings) {
            ServerSetupView(
                canCancel: true,
                notice: nil,
                onConnect: { finder.use($0) },
                onSearchAgain: { finder.search() }
            )
        }
        .preferredColorScheme(.dark)
        .task { finder.search() }
        .onChange(of: finder.state) { _, _ in
            loadError = nil
            reloadToken += 1
        }
        .onChange(of: loadError) { _, error in
            // The server may have moved (left the room, hotspot turned off): look again
            // once, which can switch to the public address, before showing the error.
            guard error != nil, !retriedSearch else { return }
            retriedSearch = true
            finder.currentServerFailed()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, loadError != nil || finder.state == .notFound {
                retriedSearch = false
                finder.search()
            }
        }
    }
}

private struct SearchingView: View {
    let enterManually: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            ProgressView().controlSize(.large)
            Text("Looking for the Alongside server…")
                .font(.title3.weight(.semibold))
            Text("Same Wi-Fi or the laptop's hotspot connects automatically. Far away works too once the server has a public address.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)
            Button("Enter address", action: enterManually)
                .buttonStyle(.bordered)
        }
        .padding(32)
    }
}

private struct ConnectionErrorView: View {
    let server: String
    let message: String
    let retry: () -> Void
    let changeServer: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Can't reach the Alongside server")
                .font(.title2.bold())
            Text(server)
                .font(.body.monospaced())
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Text("Check that the server is running (npm start), that this iPad is on the same Wi-Fi or the laptop's hotspot, and that any VPN is paused. From far away, the server needs to run with npm run start:remote.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("Search again", action: retry)
                    .buttonStyle(.borderedProminent)
                Button("Change server", action: changeServer)
                    .buttonStyle(.bordered)
            }
        }
        .padding(32)
        .frame(maxWidth: 520)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding()
    }
}
