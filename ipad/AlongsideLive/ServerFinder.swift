import Foundation
import Network
import os

private let log = Logger(subsystem: "edu.slu.stanfordxr.alongside.ipad", category: "ServerFinder")

/// Finds a reachable Alongside server without the user typing an IP.
///
/// Order of preference:
/// 1. Servers that worked before on the local network (fast, works on the hotspot).
/// 2. Servers advertising `_alongside._tcp` over Bonjour right now.
/// 3. The server's public HTTPS address (Cloudflare tunnel), for when this iPad is far away.
///
/// Every successful connection refreshes the list from the server's `/api/discover`, so
/// the app learns the public address while nearby and can use it later from anywhere.
@MainActor
final class ServerFinder: ObservableObject {
    enum State: Equatable {
        case searching
        case found(URL)
        case notFound
    }

    @Published private(set) var state: State = .searching
    /// True when connected through the public address rather than the local network.
    @Published private(set) var isRemote = false

    private let defaults = UserDefaults.standard
    private var searchTask: Task<Void, Never>?
    private var pathMonitor: NWPathMonitor?
    private var lastPath: NWPath.Status?

    /// Local-network servers, most recently working first.
    private var localServers: [URL] {
        get { (defaults.stringArray(forKey: "localServers") ?? []).compactMap(URL.init(string:)) }
        set { defaults.set(Array(newValue.map(\.absoluteString).uniqued().prefix(8)), forKey: "localServers") }
    }

    /// Public HTTPS origin of the server, if it runs a tunnel.
    private var publicServer: URL? {
        get { defaults.string(forKey: "publicServer").flatMap(URL.init(string:)) }
        set { defaults.set(newValue?.absoluteString, forKey: "publicServer") }
    }

    /// The 6-digit pairing code (works on every address of the same server).
    var pairCode: String? {
        get { defaults.string(forKey: "pairCode") }
        set {
            let valid = newValue.flatMap { $0.range(of: #"^\d{6}$"#, options: .regularExpression) != nil ? $0 : nil }
            defaults.set(valid, forKey: "pairCode")
        }
    }

    init() {
        // Migrate the address saved by the first version of the app.
        if let old = defaults.string(forKey: "serverURL"), let url = ServerAddress.normalize(old) {
            remember(url)
            defaults.removeObject(forKey: "serverURL")
        }
        watchNetwork()
    }

    // MARK: Searching

    func search() {
        searchTask?.cancel()
        state = .searching
        searchTask = Task { await runSearch() }
    }

    private func runSearch() async {
        if let url = await findServer() { return use(url) }
        if Task.isCancelled { return }
        log.notice("No server found")
        state = .notFound
        // Keep looking quietly (e.g. the server starts later, or networking was still
        // waking up). The manual-entry screen stays put; we switch only on success.
        while !Task.isCancelled, state == .notFound {
            try? await Task.sleep(for: .seconds(6))
            if Task.isCancelled || state != .notFound { return }
            if let url = await findServer() { return use(url) }
        }
    }

    /// One pass over every way of reaching the server; nil if none answers.
    private func findServer() async -> URL? {
        let scan = BonjourScan()
        scan.start()
        defer { scan.stop() }
        let started = Date()

        // 1. Known local servers: answers in well under a second when on the same network.
        if let url = await firstHealthy(localServers, timeout: 3) { return url }
        if Task.isCancelled { return nil }

        // 2. Whatever Bonjour found meanwhile (give it ~2.5 s in total).
        let wait = 2.5 - Date().timeIntervalSince(started)
        if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
        if Task.isCancelled { return nil }
        for advert in scan.adverts {
            if let pub = advert.publicURL { publicServer = pub }
        }
        let advertised = scan.adverts.flatMap(\.urls).filter { !localServers.contains($0) }
        if let url = await firstHealthy(advertised, timeout: 3) { return url }
        if Task.isCancelled { return nil }

        // 3. Far away: the public address.
        if let pub = publicServer, let url = await firstHealthy([pub], timeout: 8) { return url }
        return nil
    }

    /// Connect to a specific server (manual entry or quick pick).
    func use(_ url: URL) {
        searchTask?.cancel()
        log.notice("Using server \(url.absoluteString, privacy: .public)")
        let isPublic = url.scheme == "https" || url == publicServer
        if isPublic { publicServer = url } else { remember(url) }
        isRemote = isPublic
        state = .found(url)
        Task { await learnAddresses(from: url) }
    }

    /// The server stopped answering: it may have moved (e.g. we left the room and need
    /// the public address). Search again.
    func currentServerFailed() {
        guard case .found = state else { return }
        search()
    }

    // MARK: App links

    /// Handles `alongside-live://connect?server=<url>&server=<url>&pair=123456`.
    func handle(link: URL) {
        guard link.scheme == "alongside-live",
              let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems
        else { return }
        if let pair = items.first(where: { $0.name == "pair" })?.value { pairCode = pair }
        let servers = items.filter { $0.name == "server" }.compactMap { $0.value.flatMap(ServerAddress.normalize) }
        for url in servers.reversed() {
            if url.scheme == "https" { publicServer = url } else { remember(url) }
        }
        search()
    }

    // MARK: Helpers

    private func remember(_ url: URL) {
        localServers = [url] + localServers.filter { $0 != url }
    }

    /// Ask the server for all its addresses (`/api/discover`) and keep them for later.
    private func learnAddresses(from server: URL) async {
        struct Discover: Decodable { let lan: [String]; let `public`: String? }
        var request = URLRequest(url: server.appendingPathComponent("api/discover"))
        request.timeoutInterval = 4
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let info = try? JSONDecoder().decode(Discover.self, from: data)
        else { return }
        let lan = info.lan.compactMap(ServerAddress.normalize)
        let current = localServers
        // Keep the server we're using first; add the others after it.
        localServers = (current.prefix(1) + lan + current.dropFirst()).uniqued()
        if let pub = info.public.flatMap(ServerAddress.normalize) { publicServer = pub }
    }

    private func firstHealthy(_ urls: [URL], timeout: TimeInterval) async -> URL? {
        guard !urls.isEmpty else { return nil }
        return await withTaskGroup(of: (Int, Bool).self) { group in
            for (i, url) in urls.enumerated() {
                group.addTask { (i, await ServerAddress.isReachable(url, timeout: timeout)) }
            }
            // Probe all at once, but prefer earlier (higher-ranked) URLs: return a healthy URL
            // as soon as every URL ranked above it has answered "no".
            var answers = [Bool?](repeating: nil, count: urls.count)
            for await (i, healthy) in group {
                answers[i] = healthy
                for (rank, answer) in answers.enumerated() {
                    if answer == nil { break }          // still waiting on a better-ranked one
                    if answer == true {
                        group.cancelAll()
                        return urls[rank]
                    }
                }
            }
            return nil
        }
    }

    /// When the network changes (Wi-Fi ↔ hotspot ↔ cellular), make sure the server still answers.
    private func watchNetwork() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self else { return }
                let changed = self.lastPath != nil
                self.lastPath = path.status
                guard changed, path.status == .satisfied, case .found(let url) = self.state else { return }
                Task {
                    if await !ServerAddress.isReachable(url, timeout: 3) { self.search() }
                }
            }
        }
        monitor.start(queue: .global(qos: .utility))
        pathMonitor = monitor
    }
}

/// Collects `_alongside._tcp` Bonjour adverts. The server puts its URLs in the TXT record,
/// so no extra address resolution is needed.
@MainActor
final class BonjourScan {
    struct Advert {
        let urls: [URL]
        let publicURL: URL?
    }

    private(set) var adverts: [Advert] = []
    private var browser: NWBrowser?

    func start() {
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: "_alongside._tcp", domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.compactMap(Self.parse)
            DispatchQueue.main.async { self?.adverts = found }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    nonisolated private static func parse(_ result: NWBrowser.Result) -> Advert? {
        guard case .bonjour(let txt) = result.metadata else { return nil }
        let urls = (txt["urls"] ?? "")
            .split(separator: ",")
            .compactMap { ServerAddress.normalize(String($0)) }
            .filter { $0.scheme == "http" }
        let pub = txt["public"].flatMap(ServerAddress.normalize)
        return urls.isEmpty && pub == nil ? nil : Advert(urls: urls, publicURL: pub)
    }
}

private extension Sequence where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
