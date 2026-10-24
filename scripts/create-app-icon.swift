// Reproduce the existing public/index.html document mark as a macOS app icon.
// Run: swift scripts/create-app-icon.swift desktop/assets
import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let iconset = output.appendingPathComponent("icon.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func render(_ size: Int) throws -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                              bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                              isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let scale = CGFloat(size) / 1024
    let transform = NSAffineTransform()
    transform.scale(by: scale)
    transform.concat()
    NSColor(calibratedRed: 0.09, green: 0.095, blue: 0.086, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 72, y: 72, width: 880, height: 880), xRadius: 196, yRadius: 196).fill()
    NSColor(calibratedRed: 1, green: 0.353, blue: 0.122, alpha: 1).setStroke()
    let document = NSBezierPath(roundedRect: NSRect(x: 300, y: 252, width: 424, height: 520), xRadius: 20, yRadius: 20)
    document.lineWidth = 38
    document.stroke()
    let lines = NSBezierPath()
    lines.lineWidth = 34
    lines.lineCapStyle = .round
    for (y, end) in [(644.0, 620.0), (512.0, 548.0), (380.0, 620.0)] {
        lines.move(to: NSPoint(x: 400, y: y))
        lines.line(to: NSPoint(x: end, y: y))
    }
    lines.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try render(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", output.appendingPathComponent("icon.icns").path]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else { exit(task.terminationStatus) }
try FileManager.default.removeItem(at: iconset)
