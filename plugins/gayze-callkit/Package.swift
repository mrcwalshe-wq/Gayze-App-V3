// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GayzeCallkit",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "GayzeCallkit", targets: ["GayzeCallkit"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        // Native WebRTC, for audio calls answered on the lock screen (the web view cannot run there).
        .package(url: "https://github.com/stasel/WebRTC.git", exact: "137.0.0")
    ],
    targets: [
        .target(
            name: "GayzeCallkit",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "WebRTC", package: "WebRTC")
            ],
            path: "ios/Sources/GayzeCallKit")
    ]
)
