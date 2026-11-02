import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/services/secure_transport_factory.dart';

void main() {
  const firstPin =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const secondPin =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  test(
      'parses distinct DER certificate fingerprints and rejects malformed tokens',
      () {
    final parsed = parseCertificateSha256Pins(
      '$firstPin, ${secondPin.toUpperCase()}, $firstPin',
    );

    expect(parsed.pins, {firstPin, secondPin});
    expect(parsed.invalidTokenCount, 0);

    final malformed = parseCertificateSha256Pins('$firstPin,short,,$secondPin');
    expect(malformed.pins, {firstPin, secondPin});
    expect(malformed.invalidTokenCount, 2);
  });

  test('hashes the certificate DER bytes, not an SPKI representation', () {
    expect(
      certificateDerSha256(const [0, 1, 2, 3]),
      '054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8',
    );
  });

  test('release native configuration fails closed without two rotation pins',
      () {
    final options = BaseOptions(baseUrl: 'https://api.example.test');

    expect(
      () => createApiDio(options, releaseMode: true),
      throwsA(isA<StateError>()),
    );
    expect(
      () => createApiDio(
        BaseOptions(baseUrl: 'http://api.example.test'),
        certificatePins: '$firstPin,$secondPin',
        releaseMode: true,
      ),
      throwsA(isA<StateError>()),
    );
    expect(
      () => createApiDio(
        BaseOptions(baseUrl: 'https://api.example.test'),
        certificatePins: '$firstPin,short',
        releaseMode: true,
      ),
      throwsA(isA<StateError>()),
    );
    expect(
      () => createApiDio(
        BaseOptions(baseUrl: 'https://api.example.test'),
        certificatePins: firstPin,
        releaseMode: true,
      ),
      throwsA(isA<StateError>()),
    );
    expect(
      () => createApiDio(
        BaseOptions(baseUrl: 'https://api.example.test'),
        certificatePins: '$firstPin,$firstPin',
        releaseMode: true,
      ),
      throwsA(isA<StateError>()),
    );
  });

  test(
      'approved Android internal test allows system TLS but rejects HTTP and malformed pins',
      () {
    SecureTransportConfiguration config(String url, String pins) =>
        SecureTransportConfiguration.fromEnvironment(
          baseUrl: url,
          releaseMode: true,
          rawPins: pins,
        );
    expect(
        config('https://api.example.test', '').releaseValidationError(
          nativePinningSupported: true,
          androidInternalSystemTls: true,
        ),
        isNull);
    expect(
        config('http://api.example.test', '').releaseValidationError(
          nativePinningSupported: true,
          androidInternalSystemTls: true,
        ),
        isNotNull);
    expect(
        config('https://api.example.test', 'invalid').releaseValidationError(
          nativePinningSupported: true,
          androidInternalSystemTls: true,
        ),
        isNotNull);
  });

  test('native adapter matches only the configured host and DER fingerprints',
      () {
    final firstDer = Uint8List.fromList([0, 1, 2, 3]);
    final secondDer = Uint8List.fromList([4, 5, 6, 7]);
    final firstFingerprint = certificateDerSha256(firstDer);
    final secondFingerprint = certificateDerSha256(secondDer);

    final dio = createApiDio(
      BaseOptions(baseUrl: 'https://api.example.test'),
      certificatePins: '$firstFingerprint,$secondFingerprint',
      releaseMode: true,
    );

    expect(dio.options.followRedirects, isFalse);
    expect(dio.options.maxRedirects, 0);

    final adapter = dio.httpClientAdapter;
    expect(adapter, isA<IOHttpClientAdapter>());
    final ioAdapter = adapter as IOHttpClientAdapter;
    expect(ioAdapter.createHttpClient, isNull);
    final validateCertificate = ioAdapter.validateCertificate;
    expect(validateCertificate, isNotNull);

    final firstCertificate = _FakeCertificate(firstDer);
    final wrongCertificate = _FakeCertificate(Uint8List.fromList([9, 9, 9]));
    expect(
      validateCertificate!(firstCertificate, 'api.example.test', 443),
      isTrue,
    );
    expect(
      validateCertificate(_FakeCertificate(secondDer), 'api.example.test', 443),
      isTrue,
    );
    expect(
      validateCertificate(wrongCertificate, 'api.example.test', 443),
      isFalse,
    );
    expect(
      validateCertificate(firstCertificate, 'other.example.test', 443),
      isFalse,
    );
    expect(
      validateCertificate(firstCertificate, 'api.example.test', 8443),
      isFalse,
    );
    expect(validateCertificate(null, 'api.example.test', 443), isFalse);
  });

  test('debug builds retain ordinary TLS when pins are not configured', () {
    final dio = createApiDio(
      BaseOptions(baseUrl: 'https://api.example.test'),
      releaseMode: false,
    );

    final adapter = dio.httpClientAdapter as IOHttpClientAdapter;
    expect(adapter.validateCertificate, isNull);
  });

  test('requests outside the exact API origin are rejected before transport',
      () async {
    final dio = createApiDio(
      BaseOptions(baseUrl: 'https://api.example.test'),
      releaseMode: false,
    );

    await expectLater(
      dio.getUri(Uri.parse('https://other.example.test/private')),
      throwsA(isA<DioException>()),
    );
  });

  test('request userinfo cannot be smuggled into the API origin', () async {
    final dio = createApiDio(
      BaseOptions(baseUrl: 'https://api.example.test'),
      releaseMode: false,
    );

    await expectLater(
      dio.getUri(Uri.parse('https://attacker@api.example.test/private')),
      throwsA(isA<DioException>()),
    );
  });

  test('API origin rejects embedded credentials and query parameters', () {
    expect(
      () => createApiDio(
        BaseOptions(baseUrl: 'https://user:password@api.example.test'),
        releaseMode: false,
      ),
      throwsA(isA<StateError>()),
    );
    expect(
      () => createApiDio(
        BaseOptions(baseUrl: 'https://api.example.test?redirect=other'),
        releaseMode: false,
      ),
      throwsA(isA<StateError>()),
    );
  });
}

class _FakeCertificate implements X509Certificate {
  _FakeCertificate(List<int> der) : _der = Uint8List.fromList(der);

  final Uint8List _der;

  @override
  Uint8List get der => _der;

  @override
  DateTime get endValidity => DateTime.utc(2030);

  @override
  String get issuer => 'test issuer';

  @override
  String get pem => 'test pem';

  @override
  Uint8List get sha1 => Uint8List(20);

  @override
  DateTime get startValidity => DateTime.utc(2020);

  @override
  String get subject => 'test subject';
}
