import 'package:crypto/crypto.dart';

/// A normalized API origin used to constrain both the initial request and the
/// certificate validator to the configured first-party API endpoint.
class SecureApiOrigin {
  SecureApiOrigin._({
    required this.scheme,
    required this.host,
    required this.port,
  });

  factory SecureApiOrigin.parse(String baseUrl) {
    final raw = baseUrl.trim();
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw StateError('API_BASE_URL must include a valid origin.');
    }
    if (uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment) {
      throw StateError('API_BASE_URL must not include credentials or a query.');
    }

    final scheme = uri.scheme.toLowerCase();
    return SecureApiOrigin._(
      scheme: scheme,
      host: uri.host.toLowerCase(),
      port: _effectivePort(uri),
    );
  }

  final String scheme;
  final String host;
  final int port;

  bool matches(Uri uri) {
    return uri.userInfo.isEmpty &&
        uri.scheme.toLowerCase() == scheme &&
        uri.host.toLowerCase() == host &&
        _effectivePort(uri) == port;
  }

  @override
  String toString() => '$scheme://$host:$port';

  static int _effectivePort(Uri uri) {
    if (uri.hasPort) return uri.port;
    switch (uri.scheme.toLowerCase()) {
      case 'https':
        return 443;
      case 'http':
        return 80;
      default:
        return 0;
    }
  }
}

class CertificatePinSet {
  const CertificatePinSet({
    required this.pins,
    required this.invalidTokenCount,
  });

  final Set<String> pins;
  final int invalidTokenCount;

  bool get hasMalformedTokens => invalidTokenCount > 0;
  bool get isNonEmpty => pins.isNotEmpty;
}

/// Parses comma-separated SHA-256 fingerprints of the leaf certificate's DER
/// bytes. These are certificate DER pins, not SPKI/public-key pins. Empty
/// segments are malformed so a typo cannot silently reduce the configured
/// rotation set.
CertificatePinSet parseCertificateSha256Pins(String raw) {
  if (raw.trim().isEmpty) {
    return const CertificatePinSet(pins: <String>{}, invalidTokenCount: 0);
  }

  final pins = <String>{};
  var invalidTokenCount = 0;
  for (final token in raw.split(',')) {
    final normalized = token.trim().toLowerCase();
    if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(normalized)) {
      invalidTokenCount += 1;
      continue;
    }
    pins.add(normalized);
  }

  return CertificatePinSet(
    pins: Set.unmodifiable(pins),
    invalidTokenCount: invalidTokenCount,
  );
}

String certificateDerSha256(Iterable<int> derBytes) {
  return sha256.convert(List<int>.from(derBytes)).toString();
}

class SecureTransportConfiguration {
  SecureTransportConfiguration({
    required this.apiOrigin,
    required this.pinSet,
    required this.releaseMode,
  });

  factory SecureTransportConfiguration.fromEnvironment({
    required String baseUrl,
    required bool releaseMode,
    String? rawPins,
  }) {
    return SecureTransportConfiguration(
      apiOrigin: SecureApiOrigin.parse(baseUrl),
      pinSet: parseCertificateSha256Pins(
        rawPins ?? const String.fromEnvironment('API_CERTIFICATE_SHA256_PINS'),
      ),
      releaseMode: releaseMode,
    );
  }

  final SecureApiOrigin apiOrigin;
  final CertificatePinSet pinSet;
  final bool releaseMode;

  /// Debug builds may use ordinary local HTTP/TLS endpoints. They never use a
  /// partially parsed pin set; malformed or empty values leave the adapter
  /// unconfigured. Release validation is performed by the platform factory.
  bool get hasUsablePins => pinSet.isNonEmpty && !pinSet.hasMalformedTokens;

  String? releaseValidationError({
    required bool nativePinningSupported,
  }) {
    if (!releaseMode) return null;
    if (apiOrigin.scheme != 'https') {
      return 'API_BASE_URL must use HTTPS in release builds.';
    }
    if (!nativePinningSupported) return null;
    if (!pinSet.isNonEmpty) {
      return 'API_CERTIFICATE_SHA256_PINS is required in release builds.';
    }
    if (pinSet.hasMalformedTokens) {
      return 'API_CERTIFICATE_SHA256_PINS contains malformed fingerprints.';
    }
    if (pinSet.pins.length < 2) {
      return 'API_CERTIFICATE_SHA256_PINS requires two distinct rotation fingerprints.';
    }
    return null;
  }
}
