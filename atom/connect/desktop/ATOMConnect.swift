import AppKit
import WebKit
import Foundation

final class ConnectApplication: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    var worker: Process?
    var origin: URL?
    var readPipe: Pipe?
    var outputBuffer = ""
    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "chooseFolder")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 760), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "ATOM Connect · 我的电脑"
        window.minSize = NSSize(width: 640, height: 520)
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "ATOM"
        let menu = NSMenu()
        let show = NSMenuItem(title: "打开 ATOM Connect", action: #selector(showWindow), keyEquivalent: "")
        show.target = self; menu.addItem(show)
        let folder = NSMenuItem(title: "选择项目文件夹…", action: #selector(chooseFolder), keyEquivalent: "")
        folder.target = self; menu.addItem(folder)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出", action: #selector(quitApplication), keyEquivalent: "q")
        quit.target = self; menu.addItem(quit)
        status.menu = menu
        NSApplication.shared.activate(ignoringOtherApps: true)
        web.loadHTMLString("<html><body style='font:17px -apple-system;background:#f2f2f7;padding:60px;color:#1c1c1e'><h1>ATOM Connect</h1><p>正在启动本机连接服务…</p></body></html>", baseURL: nil)
        startWorker()
    }
    func startWorker() {
        guard let resources = Bundle.main.resourceURL else { failure("安装包资源不存在"); return }
        let executable = resources.appendingPathComponent("runtime/node")
        let script = resources.appendingPathComponent("computer/main.mjs")
        guard FileManager.default.isExecutableFile(atPath: executable.path), FileManager.default.fileExists(atPath: script.path) else { failure("安装包缺少 Node 运行时或电脑连接程序。"); return }
        do {
            let state = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ATOMConnect")
            try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let p = Process()
            p.executableURL = executable
            p.arguments = [script.path, "--port", "0", "--state-dir", state.path]
            var env = ProcessInfo.processInfo.environment
            let home = NSHomeDirectory()
            env["PATH"] = ["/opt/homebrew/bin", "/usr/local/bin", home + "/.local/bin", home + "/.npm-global/bin", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS", env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"].joined(separator: ":")
            p.environment = env
            let pipe = Pipe(); readPipe = pipe
            p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                DispatchQueue.main.async { self?.received(text) }
            }
            p.terminationHandler = { [weak self] process in
                DispatchQueue.main.async { if NSApplication.shared.isRunning && process.terminationStatus != 0 { self?.failure("本机连接服务已退出。重新打开应用后会恢复保存的配置；未完成任务不会被自动重复执行。") } }
            }
            worker = p
            try p.run()
        } catch { failure("无法启动本机连接服务。请确认应用安装包完整且可执行。") }
    }
    func received(_ text: String) {
        guard origin == nil else { return }
        outputBuffer += text
        if outputBuffer.count > 8192 { outputBuffer = String(outputBuffer.suffix(8192)) }
        if let match = outputBuffer.range(of: #"http://127\.0\.0\.1:[0-9]+"#, options: .regularExpression), let url = URL(string: String(outputBuffer[match])) {
            origin = url
            web.load(URLRequest(url: url))
        }
    }
    func failure(_ message: String) {
        let alert = NSAlert(); alert.messageText = "ATOM Connect"; alert.informativeText = message; alert.addButton(withTitle: "知道了"); alert.runModal()
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApplication.shared.activate(ignoringOtherApps: true) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "chooseFolder", message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, let base = origin, url.scheme == base.scheme, url.host == base.host, url.port == base.port else { return }
        chooseFolder()
    }
    @objc func chooseFolder() {
        showWindow()
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false; panel.prompt = "选择此文件夹"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let path = panel.url?.path, let self = self else { return }
            let data = try! JSONSerialization.data(withJSONObject: [path])
            let literal = String(data: data, encoding: .utf8)!
            self.web.evaluateJavaScript("(()=>{window.atomConnectPage?.('projects');const field=document.querySelector('#project input[name=path]');if(field){field.value=(\(literal))[0];field.scrollIntoView({block:'center'});field.focus();}})()")
        }
    }
    @objc func quitApplication() { NSApplication.shared.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) {
        readPipe?.fileHandleForReading.readabilityHandler = nil
        worker?.terminationHandler = nil
        if let p = worker, p.isRunning { p.terminate() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if let base = origin, url.scheme == base.scheme && url.host == base.host && url.port == base.port { decisionHandler(.allow); return }
        if url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }
}
let application = NSApplication.shared
let delegate = ConnectApplication()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
