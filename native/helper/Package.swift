// swift-tools-version: 6.0
// Dumbledore helper. `build.sh` (plain swiftc) is the supported build; this manifest lets
// `swift build` and editors with SourceKit-LSP work on the same sources.
import PackageDescription

let package = Package(
  name: "DumbledoreHelper",
  platforms: [.macOS(.v15)],
  targets: [
    .executableTarget(
      name: "DumbledoreHelper",
      path: "Sources/DumbledoreHelper",
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [
        .linkedFramework("AppKit"), .linkedFramework("Vision"), .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("ApplicationServices"), .linkedFramework("CoreGraphics"), .linkedFramework("Carbon"),
        .unsafeFlags(["-Xlinker", "-weak_framework", "-Xlinker", "FoundationModels"]),
      ]
    )
  ]
)
