import SwiftUI

/// Finds the server, then hands over to the native live app for that server.
struct ContentView: View {
    @EnvironmentObject private var finder: ServerFinder
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSettings = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            switch finder.state {
            case .searching:
                SearchingView(enterManually: { showSettings = true })
            case .found(let server):
                LiveRootView(server: server, finder: finder, openServerSettings: { showSettings = true })
                    .id(server) // a new server gets a fresh session
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
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, finder.state == .notFound { finder.search() }
        }
    }
}

private struct SearchingView: View {
    let enterManually: () -> Void

    var body: some View {
        ZStack {
            GlowBackground()
            Card {
                BrandMark()
                ProgressView().controlSize(.large).tint(Theme.accent).padding(.top, 10)
                Text("Looking for the Alongside server…")
                    .font(.system(size: 24, weight: .bold))
                Text("Same Wi-Fi or the laptop's hotspot connects automatically. Far away works too once the server has a public address.")
                    .foregroundStyle(.secondary)
                Button("Enter address", action: enterManually)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color(hex: "#f0a084"))
            }
        }
    }
}
