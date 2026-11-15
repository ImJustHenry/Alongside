import Foundation

/// REST calls to the Alongside server.
struct AlongsideAPI {
    let base: URL

    struct Failure: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }

    private func request(_ path: String, method: String = "GET", token: String? = nil,
                         headers: [String: String] = [:], body: Any? = nil, timeout: TimeInterval = 8) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.httpMethod = method
        r.timeoutInterval = timeout
        r.cachePolicy = .reloadIgnoringLocalCacheData
        if let token { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return r
    }

    private func send<T: Decodable>(_ r: URLRequest, as: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: r)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(status: status, message: message ?? "Server error \(status)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// The room the Quest is hosting right now. 403 = wrong pairing code, 404 = no Quest yet.
    func liveCurrent(pairCode: String) async throws -> LiveCurrent {
        try await send(request("api/live/current", headers: ["X-Pair-Code": pairCode], timeout: 5), as: LiveCurrent.self)
    }

    func join(room: String, invite: String, name: String) async throws -> JoinResponse {
        try await send(request("api/rooms/\(room)/join", method: "POST", body: ["invite": invite, "name": name]),
                       as: JoinResponse.self)
    }

    /// Room actions: spatial.undo, spatial.clearMine, …
    func action(room: String, token: String, _ body: [String: Any]) async throws {
        struct Ignored: Decodable {}
        _ = try await send(request("api/rooms/\(room)/actions", method: "POST", token: token, body: body), as: Ignored.self)
    }

    /// Ask the room's AI about the current camera frame.
    func askAboutFrame(room: String, token: String, prompt: String) async throws -> String {
        struct Answer: Decodable { let text: String }
        return try await send(
            request("api/rooms/\(room)/liveview/ask", method: "POST", token: token,
                    body: ["prompt": prompt, "consent": true], timeout: 60),
            as: Answer.self
        ).text
    }
}
