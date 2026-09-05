import Flutter
import UIKit

class SceneDelegate: FlutterSceneDelegate {

  private static let privacyChannelName = "trustpay/app_privacy"
  private static let privacyReadyMethod = "ready"
  private static let privacyShowMethod = "show"

  private var privacyCover: UIView?
  private var privacyChannel: FlutterMethodChannel?
  private var integrityChannel: FlutterMethodChannel?

  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)

    // Cover the storyboard/Flutter view from the first native scene frame. The
    // Flutter lock gate removes it only after it has resolved the active
    // session and lock state.
    installPrivacyCover()
    configurePrivacyChannel()
  }

  override func sceneWillResignActive(_ scene: UIScene) {
    installPrivacyCover()
    super.sceneWillResignActive(scene)
  }

  override func sceneDidEnterBackground(_ scene: UIScene) {
    installPrivacyCover()
    super.sceneDidEnterBackground(scene)
  }

  override func sceneDidBecomeActive(_ scene: UIScene) {
    // Keep the cover until Flutter reports that its lock/readiness boundary is
    // established. Removing it here would allow a protected frame to flash on
    // resume before AppLockGate has run.
    super.sceneDidBecomeActive(scene)
  }

  private func configurePrivacyChannel() {
    guard let flutterViewController = window?.rootViewController as? FlutterViewController else {
      return
    }

    let channel = FlutterMethodChannel(
      name: Self.privacyChannelName,
      binaryMessenger: flutterViewController.binaryMessenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case Self.privacyShowMethod:
        self?.installPrivacyCover()
        result(nil)
      case Self.privacyReadyMethod:
        self?.removePrivacyCover()
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    privacyChannel = channel
    let integrity = FlutterMethodChannel(name: "trustpay/device_integrity", binaryMessenger: flutterViewController.binaryMessenger)
    integrity.setMethodCallHandler { call, result in
      guard call.method == "check" else { result(FlutterMethodNotImplemented); return }
      #if targetEnvironment(simulator)
      result("unavailable")
      #else
      let markers = ["/Applications/Cydia.app", "/Library/MobileSubstrate/MobileSubstrate.dylib", "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/var/jb"]
      result(markers.contains { FileManager.default.fileExists(atPath: $0) } ? "risky" : "clear")
      #endif
    }
    integrityChannel = integrity
  }

  private func installPrivacyCover() {
    guard let window else { return }

    if let privacyCover {
      window.bringSubviewToFront(privacyCover)
      return
    }

    let cover = UIView(frame: window.bounds)
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.backgroundColor = .black
    cover.isOpaque = true
    window.addSubview(cover)
    privacyCover = cover
  }

  private func removePrivacyCover() {
    privacyCover?.removeFromSuperview()
    privacyCover = nil
  }

}
