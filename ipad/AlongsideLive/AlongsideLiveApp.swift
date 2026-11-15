import SwiftUI

@main
struct AlongsideLiveApp: App {
    @StateObject private var finder = ServerFinder()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(finder)
                // alongside-live://connect?server=...&pair=... (QR on the laptop, or a link sent to a remote person)
                .onOpenURL { finder.handle(link: $0) }
        }
    }
}
