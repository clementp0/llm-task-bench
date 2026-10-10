import AppKit

let args = CommandLine.arguments
let input = args.count > 1 ? args[1] : "build/icon-source.png"
let output = args.count > 2 ? args[2] : "build/icon.png"

guard let src = NSImage(contentsOfFile: input) else {
  FileHandle.standardError.write("Image not found: \(input)\n".data(using: .utf8)!)
  exit(1)
}

if let bmp = src.representations.first as? NSBitmapImageRep, (bmp.colorAt(x: 0, y: 0)?.alphaComponent ?? 1) < 0.01 {
  try? FileManager.default.removeItem(atPath: output)
  try! FileManager.default.copyItem(atPath: input, toPath: output)
  print("\(input) already has transparent corners, copied as is to \(output)")
  exit(0)
}

// Apple's macOS icon grid: 824px body centered on a 1024px canvas, 185px corner radius.
let size = 1024, inset: CGFloat = 100, radius: CGFloat = 185
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let box = NSRect(x: inset, y: inset, width: CGFloat(size) - 2 * inset, height: CGFloat(size) - 2 * inset)
NSBezierPath(roundedRect: box, xRadius: radius, yRadius: radius).addClip()
src.draw(in: box)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
print("Wrote \(output)")
