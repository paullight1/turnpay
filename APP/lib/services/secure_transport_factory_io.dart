import 'package:dio/dio.dart';
import 'package:dio/io.dart';

import 'secure_transport_policy.dart';

const supportsNativeCertificatePinning = true;

HttpClientAdapter? createPlatformSecureAdapter({
  required SecureApiOrigin apiOrigin,
  required Set<String> certificatePins,
}) {
  if (certificatePins.isEmpty) return null;

  // Do not replace the platform SecurityContext or install a permissive
  // badCertificateCallback. The adapter first performs ordinary CA/hostname
  // validation, then this callback adds the configured leaf-certificate pin.
  return IOHttpClientAdapter(
    validateCertificate: (certificate, host, port) {
      if (certificate == null || host.toLowerCase() != apiOrigin.host) {
        return false;
      }
      if (port != apiOrigin.port) return false;

      final fingerprint = certificateDerSha256(certificate.der);
      return certificatePins.contains(fingerprint);
    },
  );
}
