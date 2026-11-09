/// Launch-scoped product capabilities.
///
/// Money-out code remains compiled for a future release, but V1 fails closed
/// at every user entry point and at the router boundary.
abstract final class LaunchCapabilities {
  static const bool moneyOutEnabled = false;

  /// The standalone GHS wallet/account product is not part of V1.
  ///
  /// Keep its implementation compiled for a later launch, but do not expose
  /// wallet cards or cedi-account entry points until the product is ready.
  static const bool ghanaCedisWalletEnabled = false;
}
