import Foundation

/// Turns what the user typed ("192.168.137.1", "10.16.92.33:4173", "http://host:4173/")
/// into the server's base URL, and builds the URLs the app needs from it.
enum ServerAddress {
    static let defaultPort = 4173

    /// Addresses offered as one-tap choices, matching the Quest build's `serverUrl` list.
    static let presets: [(label: String, address: String)] = [
        ("Laptop hotspot", "http://192.168.137.1:4173"),
        ("Stanford Wi-Fi", "http://10.16.92.33:4173"),
    ]

    static func normalize(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "http://" + text }
        guard var parts = URLComponents(string: text),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty
        else { return nil }
        if parts.port == nil && scheme == "http" { parts.port = defaultPort }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    /// The paired iPad view the server serves at `/ipad`.
    static func pageURL(_ stored: String) -> URL? {
        normalize(stored)?.appendingPathComponent("ipad")
    }

    /// Checks `GET /api/health`, the same probe the Quest app uses.
    static func isReachable(_ base: URL, timeout: TimeInterval = 3) async -> Bool {
        var request = URLRequest(url: base.appendingPathComponent("api/health"))
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse
        else { return false }
        return (200..<300).contains(http.statusCode)
    }
}
