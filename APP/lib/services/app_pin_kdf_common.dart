import 'dart:convert';
import 'package:crypto/crypto.dart';

String deriveAppPinHashSync((String, List<int>) input) => base64.encode(pbkdf2(
    password: utf8.encode(input.$1),
    salt: input.$2,
    iterations: 120000,
    keyLength: 32));

List<int> pbkdf2({
  required List<int> password,
  required List<int> salt,
  required int iterations,
  required int keyLength,
}) {
  final hmac = Hmac(sha256, password);
  final blockCount = (keyLength / 32).ceil();
  final derived = <int>[];

  for (var block = 1; block <= blockCount; block++) {
    final blockIndex = [
      (block >> 24) & 0xff,
      (block >> 16) & 0xff,
      (block >> 8) & 0xff,
      block & 0xff,
    ];
    var u = hmac.convert([...salt, ...blockIndex]).bytes;
    final t = List<int>.from(u);
    for (var i = 1; i < iterations; i++) {
      u = hmac.convert(u).bytes;
      for (var j = 0; j < t.length; j++) {
        t[j] ^= u[j];
      }
    }
    derived.addAll(t);
  }

  return derived.sublist(0, keyLength);
}

/// Compatible fallback for browsers without SubtleCrypto. Keep work factor and
/// yield periodically so older browsers can still render unlock progress.
Future<String> deriveAppPinHashYielding(String pin, List<int> salt) async {
  final hmac = Hmac(sha256, utf8.encode(pin));
  var u = hmac.convert([...salt, 0, 0, 0, 1]).bytes;
  final result = List<int>.from(u);
  for (var i = 1; i < 120000; i++) {
    u = hmac.convert(u).bytes;
    for (var j = 0; j < result.length; j++) {
      result[j] ^= u[j];
    }
    if (i % 1000 == 0) await Future<void>.delayed(Duration.zero);
  }
  return base64.encode(result);
}
