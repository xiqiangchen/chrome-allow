import Foundation
import AppKit
import ApplicationServices

// chrome-allow native watcher
// args: mode ("persistent" | "once"), timeoutSeconds (0 = infinite), resultFile

let args = CommandLine.arguments
guard args.count >= 4, let timeoutSeconds = Int(args[2]) else {
    FileHandle.standardError.write(Data("usage: chrome-allow-watcher <persistent|once> <timeout> <result-file>\n".utf8))
    exit(64)
}

let mode = args[1]
let resultPath = args[3]
let startedAt = Date()
var lastClickAt = Date.distantPast

func timestamp() -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return formatter.string(from: Date())
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("[\(timestamp())] \(message)\n".utf8))
}

func record(_ message: String) {
    guard let data = (message + "\n").data(using: .utf8) else { return }
    if !FileManager.default.fileExists(atPath: resultPath) {
        FileManager.default.createFile(atPath: resultPath, contents: nil)
    }
    guard let handle = FileHandle(forWritingAtPath: resultPath) else { return }
    handle.seekToEndOfFile()
    handle.write(data)
    handle.closeFile()
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    (attribute(element, name) as? String) ?? ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement]) ?? []
}

func chromeApplication() -> AXUIElement? {
    guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").first else {
        return nil
    }
    return AXUIElementCreateApplication(running.processIdentifier)
}

func sheets(of window: AXUIElement) -> [AXUIElement] {
    var result: [AXUIElement] = []
    if let direct = attribute(window, "AXSheets" as CFString) as? [AXUIElement] {
        result.append(contentsOf: direct)
    }
    for child in children(window) {
        if stringAttribute(child, kAXRoleAttribute as CFString) == "AXSheet" {
            result.append(child)
        }
    }
    return result
}

func isConsentSheet(_ sheet: AXUIElement) -> Bool {
    let title = stringAttribute(sheet, kAXTitleAttribute as CFString)
    let description = stringAttribute(sheet, kAXDescriptionAttribute as CFString)
    let combined = (title + " " + description)
    return combined.contains("远程调试")
        || combined.lowercased().contains("remote debugging")
}

func findAllowButton(_ element: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 12 { return nil }

    let role = stringAttribute(element, kAXRoleAttribute as CFString)
    if role == "AXButton" {
        let title = stringAttribute(element, kAXTitleAttribute as CFString)
        let description = stringAttribute(element, kAXDescriptionAttribute as CFString)
        let labels = [title, description]
        if labels.contains("允许") || labels.contains("Allow") {
            return element
        }
    }

    for child in children(element) {
        if let found = findAllowButton(child, depth: depth + 1) {
            return found
        }
    }
    return nil
}

func press(_ button: AXUIElement) -> Bool {
    AXUIElementPerformAction(button, kAXPressAction as CFString) == .success
}

guard AXIsProcessTrusted() else {
    record("error:permission")
    log("accessibility permission missing")
    exit(3)
}

log("watcher start mode=\(mode) timeout=\(timeoutSeconds)s")

while true {
    if timeoutSeconds > 0, Date().timeIntervalSince(startedAt) >= Double(timeoutSeconds) {
        record("timeout")
        log("timeout")
        exit(1)
    }

    if let app = chromeApplication() {
        if let windows = attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement] {
            for window in windows {
                for sheet in sheets(of: window) where isConsentSheet(sheet) {
                    guard Date().timeIntervalSince(lastClickAt) >= 1.5 else { continue }
                    if let button = findAllowButton(sheet) {
                        if press(button) {
                            lastClickAt = Date()
                            record("clicked")
                            log("clicked allow")
                            if mode == "once" {
                                Thread.sleep(forTimeInterval: 0.3)
                                exit(0)
                            }
                            Thread.sleep(forTimeInterval: 0.8)
                        } else {
                            log("press failed")
                        }
                    }
                }
            }
        }
    }

    Thread.sleep(forTimeInterval: 0.3)
}
