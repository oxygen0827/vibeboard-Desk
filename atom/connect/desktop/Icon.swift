import AppKit
let directory = CommandLine.arguments[1]
let set = directory + "/AppIcon.iconset"
try! FileManager.default.createDirectory(atPath:set,withIntermediateDirectories:true)
for (points, scale) in [(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)] {
 let size = points * scale
 let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState()
 NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:bitmap)
 let factor = CGFloat(size)/1024
 let transform = NSAffineTransform();transform.scale(by:factor);transform.concat()
 NSColor(calibratedRed:0.17,green:0.43,blue:0.92,alpha:1).setFill()
 NSBezierPath(roundedRect:NSRect(x:0,y:0,width:1024,height:1024),xRadius:220,yRadius:220).fill()
 NSColor.white.setStroke()
 let screen=NSBezierPath(roundedRect:NSRect(x:200,y:360,width:624,height:430),xRadius:54,yRadius:54);screen.lineWidth=42;screen.stroke()
 let stand=NSBezierPath();stand.lineWidth=42;stand.lineCapStyle = .round;stand.move(to:NSPoint(x:512,y:360));stand.line(to:NSPoint(x:512,y:230));stand.move(to:NSPoint(x:365,y:230));stand.line(to:NSPoint(x:659,y:230));stand.stroke()
 let link=NSBezierPath();link.lineWidth=42;link.lineCapStyle = .round;link.move(to:NSPoint(x:390,y:580));link.line(to:NSPoint(x:634,y:580));link.move(to:NSPoint(x:565,y:650));link.line(to:NSPoint(x:635,y:580));link.line(to:NSPoint(x:565,y:510));link.stroke()
 NSGraphicsContext.restoreGraphicsState()
 let name="icon_\(points)x\(points)"+(scale==2 ? "@2x" : "")+".png"
 try! bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:set+"/"+name))
}
let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/iconutil");process.arguments=["-c","icns",set,"-o",directory+"/AppIcon.icns"];try! process.run();process.waitUntilExit()
if process.terminationStatus != 0 { exit(process.terminationStatus) }
try? FileManager.default.removeItem(atPath:set)
