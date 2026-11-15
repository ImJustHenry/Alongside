import SwiftUI
import WebKit

/// Full-screen web view showing the server's `/ipad` page (pairing, live Quest view, drawing).
struct LiveWebView: UIViewRepresentable {
    let url: URL
    /// Bump to force a reload (retry, server changed).
    let reloadToken: Int
    @Binding var loadError: String?
    /// Called with the pairing code whenever the page saves (or clears) it.
    var onPairCode: (String?) -> Void = { _ in }
    /// The page asked for the native server settings ("Server" / "Change server" buttons).
    var onRequestSettings: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Keeps localStorage (pairing code, name) between launches.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(
            WKUserScript(source: Self.appFeel, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        config.userContentController.addUserScript(
            WKUserScript(source: Self.pairBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        config.userContentController.add(WeakMessageHandler(context.coordinator), name: "alongside")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isInspectable = true // Safari ▸ Develop ▸ <iPad> for debugging
        context.coordinator.load(url, in: webView, token: reloadToken)
        return webView
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "alongside")
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.load(url, in: webView, token: reloadToken)
    }

    /// Makes the page behave like an app: no pinch-zoom of the whole page, no long-press
    /// callouts or accidental text selection while drawing (text fields still work).
    private static let appFeel = """
    (() => {
      let m = document.querySelector('meta[name=viewport]');
      if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
      m.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
      const s = document.createElement('style');
      s.textContent = `
        html, body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
                     overscroll-behavior: none; }
        input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }`;
      document.head.appendChild(s);
    })();
    """

    /// Tells the app when the page stores its pairing code, so it can be reused on the
    /// server's other addresses (each address is a separate origin with its own storage).
    private static let pairBridge = """
    (() => {
      const KEY = 'alongside-pair';
      const post = (v) => { try { webkit.messageHandlers.alongside.postMessage({ pair: v || '' }); } catch {} };
      const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (k === KEY) post(String(v)); };
      Storage.prototype.removeItem = function (k) { remove.call(this, k); if (k === KEY) post(''); };
      try { const v = localStorage.getItem(KEY); if (v) post(v); } catch {}
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: LiveWebView
        private var loadedURL: URL?
        private var loadedToken: Int?

        init(_ parent: LiveWebView) { self.parent = parent }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            if body["action"] as? String == "server" { parent.onRequestSettings() }
            if let pair = body["pair"] as? String { parent.onPairCode(pair.isEmpty ? nil : pair) }
        }

        func load(_ url: URL, in webView: WKWebView, token: Int) {
            // Only the server/path matter; a pairing code added to the query later shouldn't reload.
            func base(_ u: URL?) -> String? {
                guard let u, var c = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return nil }
                c.query = nil
                return c.string
            }
            guard base(url) != base(loadedURL) || token != loadedToken else { return }
            loadedURL = url
            loadedToken = token
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 8))
        }

        private func report(_ error: String?) {
            DispatchQueue.main.async { self.parent.loadError = error }
        }

        // MARK: Navigation

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            report(nil)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            report(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            report(error.localizedDescription)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        /// Stay on the Alongside server; open anything else (docs, external links) in Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else { return decisionHandler(.allow) }
            let sameServer = target.host == parent.url.host && target.port == parent.url.port
            if sameServer || target.scheme == "about" || target.scheme == "blob" || target.scheme == "data" {
                decisionHandler(.allow)
            } else {
                if action.navigationType == .linkActivated { UIApplication.shared.open(target) }
                decisionHandler(.cancel)
            }
        }

        /// target="_blank" / window.open: load same-server pages here, others in Safari.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = action.request.url {
                if target.host == parent.url.host { webView.load(action.request) }
                else { UIApplication.shared.open(target) }
            }
            return nil
        }

        // MARK: JavaScript alert / confirm / prompt (the web client uses confirm())

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            present(alert, from: webView) { completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            present(alert, from: webView) { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                completionHandler(alert.textFields?.first?.text)
            })
            present(alert, from: webView) { completionHandler(nil) }
        }

        /// Presents from the top-most view controller; calls `fallback` if nothing can present.
        private func present(_ alert: UIAlertController, from webView: WKWebView, fallback: () -> Void) {
            var top = webView.window?.rootViewController
            while let next = top?.presentedViewController { top = next }
            guard let top else { return fallback() }
            top.present(alert, animated: true)
        }
    }
}

/// Avoids the retain cycle WKUserContentController creates with its message handlers.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
