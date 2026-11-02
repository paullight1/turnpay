import 'package:dio/dio.dart';

import 'secure_transport_policy.dart';

// Browser TLS is controlled by the browser and does not expose a native leaf
// certificate callback. Keep standard browser TLS and report this limitation
// explicitly; this factory makes no native pinning claim for web builds.
const supportsNativeCertificatePinning = false;
const isAndroid = false;

HttpClientAdapter? createPlatformSecureAdapter({
  required SecureApiOrigin apiOrigin,
  required Set<String> certificatePins,
}) {
  return null;
}
