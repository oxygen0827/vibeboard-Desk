import AppKit
import WebKit
import Foundation
import UniformTypeIdentifiers

final class ConnectApplication: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    var worker: Process?
    var origin: URL?
    var readPipe: Pipe?
    var outputBuffer = ""
    let simulator = SimulatorController()
    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "chooseFolder")
        config.userContentController.add(self, name: "savePhoto")
        config.userContentController.add(self, name: "appearance")
        config.userContentController.add(self, name: "simulator")
        if let mode = UserDefaults.standard.string(forKey: "ATOMAppearance"), ["light", "dark"].contains(mode) {
            NSApp.appearance = NSAppearance(named: mode == "dark" ? .darkAqua : .aqua)
            let script = "window.atomNativeAppearance='\(mode)';if(document.documentElement){document.documentElement.dataset.appearance='\(mode)';document.documentElement.style.colorScheme='\(mode)';}"
            config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "ATOM Connect"
        window.minSize = NSSize(width: 820, height: 560)
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
        let device = NSMenuItem(title: "打开 ATOM 模拟器", action: #selector(openSimulator), keyEquivalent: "")
        device.target = self; menu.addItem(device)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出", action: #selector(quitApplication), keyEquivalent: "q")
        quit.target = self; menu.addItem(quit)
        status.menu = menu
        simulator.report = { [weak self] state, message in
            let detail = (try? JSONSerialization.data(withJSONObject: ["state": state, "message": message])).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            self?.web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('atom:simulator',{detail:\(detail)}))")
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        web.loadHTMLString("<html><head><style>:root{color-scheme:light dark}body{font:17px -apple-system;background:Canvas;color:CanvasText;padding:60px}</style></head><body><h1>ATOM Connect</h1><p>正在启动本机连接服务…</p></body></html>", baseURL: nil)
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
            if UserDefaults.standard.bool(forKey: "ATOMSimulatorRunning") { simulator.start() }
        }
    }
    func failure(_ message: String) {
        let alert = NSAlert(); alert.messageText = "ATOM Connect"; alert.informativeText = message; alert.addButton(withTitle: "知道了"); alert.runModal()
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApplication.shared.activate(ignoringOtherApps: true) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, let base = origin, url.scheme == base.scheme, url.host == base.host, url.port == base.port else { return }
        if message.name == "chooseFolder" { chooseFolder(); return }
        if message.name == "simulator", let body = message.body as? [String: Any], let action = body["action"] as? String {
            if action == "start" { simulator.start() } else if action == "stop" { simulator.stop() }
            return
        }
        if message.name == "appearance", let body = message.body as? [String: String], let mode = body["mode"], ["light", "dark"].contains(mode) {
            UserDefaults.standard.set(mode, forKey: "ATOMAppearance")
            let saved = UserDefaults.standard.string(forKey: "ATOMAppearance") == mode
            if saved {
                NSApp.appearance = NSAppearance(named: mode == "dark" ? .darkAqua : .aqua)
                // The worker chooses a new port on launch, so native storage owns this preference.
                // Refresh the document-start script too, including reloads in this session.
                web.configuration.userContentController.removeAllUserScripts()
                let script = "window.atomNativeAppearance='\(mode)';if(document.documentElement){document.documentElement.dataset.appearance='\(mode)';document.documentElement.style.colorScheme='\(mode)';}"
                web.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            web.evaluateJavaScript("window.atomNativeAppearance='\(mode)';window.dispatchEvent(new CustomEvent('atom:appearance-saved',{detail:{mode:'\(mode)',ok:\(saved ? "true" : "false")}}))")
            return
        }
        if message.name == "savePhoto", let body = message.body as? [String: String], let requestID = body["id"], requestID.count < 128,
           let value = body["data_url"], value.count <= 28 * 1024 * 1024,
           let split = value.firstIndex(of: ","), ["data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64", "data:image/heic;base64", "data:image/heif;base64"].contains(String(value[..<split])),
           let data = Data(base64Encoded: String(value[value.index(after: split)...])) {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (body["name"] ?? "photo").replacingOccurrences(of: "/", with: "_")
            let mime = String(value[..<split]).replacingOccurrences(of: "data:", with: "").replacingOccurrences(of: ";base64", with: "")
            panel.allowedContentTypes = [UTType(mimeType: mime) ?? .data]
            panel.beginSheetModal(for: window) { [weak self] response in
                var result: [String: Any] = ["id": requestID, "ok": false, "error": "已取消导出"]
                if response == .OK, let destination = panel.url {
                    do { try data.write(to: destination, options: .atomic); result = ["id": requestID, "ok": true] }
                    catch { result["error"] = "照片无法保存到所选位置" }
                }
                if let encoded = try? JSONSerialization.data(withJSONObject: result), let literal = String(data: encoded, encoding: .utf8) {
                    self?.web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('atom:photo-export',{detail:\(literal)}))")
                }
            }
        }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let url = frame.request.url, let base = origin, url.host == base.host, url.port == base.port, url.path.hasPrefix("/photo-album/") else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.allowedContentTypes = [.jpeg, .png, .webP] + ["public.heic", "public.heif"].compactMap { UTType($0) }
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? Array(panel.urls.prefix(20)) : nil) }
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
    @objc func openSimulator() {
        showWindow()
        web.evaluateJavaScript("window.atomConnectPage?.('simulator')")
        simulator.start()
    }
    @objc func quitApplication() { NSApplication.shared.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) {
        readPipe?.fileHandleForReading.readabilityHandler = nil
        worker?.terminationHandler = nil
        if let p = worker, p.isRunning { p.terminate() }
        simulator.stop(remember: false)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if let base = origin, url.scheme == base.scheme && url.host == base.host && url.port == base.port { decisionHandler(.allow); return }
        // The simulator screen (and the apps inside it) are embedded frames from the local device backend.
        if navigationAction.targetFrame?.isMainFrame == false {
            let sim = simulator.origin
            if (url.scheme == sim.scheme && url.host == sim.host && url.port == sim.port) || ["about", "data", "blob"].contains(url.scheme ?? "") || simulator.ownsFrame(navigationAction) { decisionHandler(.allow); return }
        }
        if url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "127.0.0.1" && origin.port == simulator.port ? .prompt : .deny)
    }
}
/// Runs the real ATOM device backend (bundled Python sources and prebuilt apps) on a fixed local
/// port. The dashboard embeds its 480x360 screen and shows the direct and relay links live.
final class SimulatorController: NSObject {
    // Fixed port: apps keep their saved data per origin, so it must not change between launches.
    let port = 8790
    var process: Process?
    var pipe: Pipe?
    var buffer = ""
    var ready = false
    var report: ((String, String) -> Void)?
    var origin: URL { URL(string: "http://127.0.0.1:\(port)")! }

    // App frames inside the simulator are sandboxed (opaque origin) but still load from the simulator.
    func ownsFrame(_ action: WKNavigationAction) -> Bool {
        let source = action.sourceFrame.securityOrigin
        return source.host == "127.0.0.1" && source.port == port
    }

    func start() {
        UserDefaults.standard.set(true, forKey: "ATOMSimulatorRunning")
        if process?.isRunning == true { report?(ready ? "running" : "starting", ""); return }
        guard let resources = Bundle.main.resourceURL else { return }
        let script = resources.appendingPathComponent("device/tools/simulator.py")
        let seed = resources.appendingPathComponent("device/seed-apps")
        let python = URL(fileURLWithPath: "/usr/bin/python3")
        guard FileManager.default.fileExists(atPath: script.path) else { report?("error", "安装包里没有模拟器，请用最新的构建脚本重新生成 ATOM Connect。"); return }
        guard hasPython(python) else { report?("error", "模拟设备需要 macOS 自带的 Python 3。请在终端运行 xcode-select --install 安装命令行工具后再启动。"); return }
        let home = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ATOMConnect/simulator")
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let p = Process()
        p.executableURL = python
        p.arguments = ["-u", script.path, "--no-open", "--seed", seed.path, "--home", home.path, "--port", String(port)]
        let out = Pipe(); pipe = out; buffer = ""; ready = false
        p.standardOutput = out; p.standardError = out
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.received(text) }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self = self, self.process === proc else { return }
                self.ready = false; self.process = nil
                self.pipe?.fileHandleForReading.readabilityHandler = nil
                let busy = self.buffer.contains("Address already in use")
                self.report?("error", busy ? "端口 \(self.port) 被占用：可能有在终端里运行的模拟器，关掉它后再启动。" : "模拟设备已退出：" + String(self.buffer.suffix(300)))
            }
        }
        process = p
        report?("starting", "")
        do { try p.run() } catch { process = nil; report?("error", "Python 3 启动失败。") }
    }

    func hasPython(_ url: URL) -> Bool {
        // /usr/bin/python3 is a stub until the Command Line Tools are installed.
        let check = Process(); check.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select"); check.arguments = ["-p"]
        check.standardOutput = FileHandle.nullDevice; check.standardError = FileHandle.nullDevice
        do { try check.run(); check.waitUntilExit() } catch { return false }
        return check.terminationStatus == 0 && FileManager.default.isExecutableFile(atPath: url.path)
    }

    func received(_ text: String) {
        buffer += text
        if buffer.count > 16384 { buffer = String(buffer.suffix(16384)) }
        if !ready && buffer.contains("ATOM simulator running at") { ready = true; report?("running", "") }
    }

    /// Stops the device. `remember` is false on app quit so the next launch resumes it.
    func stop(remember: Bool = true) {
        if remember { UserDefaults.standard.set(false, forKey: "ATOMSimulatorRunning") }
        pipe?.fileHandleForReading.readabilityHandler = nil
        process?.terminationHandler = nil
        if let p = process, p.isRunning { p.terminate() }
        process = nil; ready = false
        report?("stopped", "")
    }
}

let application = NSApplication.shared
let delegate = ConnectApplication()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
