import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kReleaseMode;

import 'secure_transport_policy.dart';
import 'secure_transport_factory_stub.dart'
    if (dart.library.io) 'secure_transport_factory_io.dart' as platform;

export 'secure_transport_policy.dart'
    show
        CertificatePinSet,
        SecureApiOrigin,
        SecureTransportConfiguration,
        certificateDerSha256,
        parseCertificateSha256Pins;

/// Creates the Dio instance used by TrustPay's API and refresh clients.
///
/// On native platforms release builds require at least two distinct
/// comma-separated SHA-256 fingerprints in [certificatePins] or the
/// `API_CERTIFICATE_SHA256_PINS` Dart define. Each fingerprint is the SHA-256
/// digest of the leaf X.509 certificate's DER bytes. This is certificate
/// pinning and deliberately does not claim SPKI/public-key pinning.
///
/// Normal platform TLS validation remains enabled. Redirects are disabled and
/// requests are constrained to the exact configured API origin so an
/// Authorization header cannot follow a cross-host redirect.
Dio createApiDio(
  BaseOptions options, {
  String? certificatePins,
  bool? releaseMode,
}) {
  final configuration = SecureTransportConfiguration.fromEnvironment(
    baseUrl: options.baseUrl,
    rawPins: certificatePins,
    // A caller may opt into strict validation for tests/debug builds, but no
    // runtime argument can turn strict release validation off.
    releaseMode: kReleaseMode || releaseMode == true,
  );

  final releaseError = configuration.releaseValidationError(
    nativePinningSupported: platform.supportsNativeCertificatePinning,
    androidInternalSystemTls: platform.isAndroid &&
        const bool.fromEnvironment('ANDROID_INTERNAL_SYSTEM_TLS'),
  );
  if (releaseError != null) {
    throw StateError(releaseError);
  }

  final dio = Dio(options);
  // Do not permit an individual request to opt back into redirects. An
  // explicit redirect response is safer than forwarding bearer headers to a
  // host outside the controlled origin.
  dio.options.followRedirects = false;
  dio.options.maxRedirects = 0;
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (requestOptions, handler) {
        requestOptions.followRedirects = false;
        requestOptions.maxRedirects = 0;
        if (!configuration.apiOrigin.matches(requestOptions.uri)) {
          handler.reject(
            DioException.connectionError(
              requestOptions: requestOptions,
              reason: 'The request origin is outside the configured API.',
            ),
          );
          return;
        }
        handler.next(requestOptions);
      },
    ),
  );

  // In debug/local builds an empty or malformed value keeps ordinary TLS for
  // development. Never attach a partially parsed pin set, and never allow
  // this debug path in a native release build because of release validation
  // above.
  if (configuration.hasUsablePins &&
      configuration.apiOrigin.scheme == 'https') {
    final adapter = platform.createPlatformSecureAdapter(
      apiOrigin: configuration.apiOrigin,
      certificatePins: configuration.pinSet.pins,
    );
    if (adapter != null) {
      dio.httpClientAdapter = adapter;
    }
  }

  return dio;
}
