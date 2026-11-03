import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';
import 'app_pin_kdf_common.dart';

@JS('crypto.subtle')
external _SubtleCrypto get _subtle;

@JS()
@staticInterop
class _SubtleCrypto {}

extension _SubtleCryptoMethods on _SubtleCrypto {
  external JSPromise<JSObject> importKey(JSString format, JSUint8Array data,
      JSObject algorithm, JSBoolean extractable, JSArray<JSString> usages);
  external JSPromise<JSArrayBuffer> deriveBits(
      JSObject algorithm, JSObject key, JSNumber length);
}

/// Browser-native PBKDF2 preserves the existing 120,000-round SHA-256 digest
/// while running outside Dart's UI event loop.
Future<String> deriveAppPinHash(String pin, List<int> salt) async {
  try {
    final key = await _subtle
        .importKey(
            'raw'.toJS,
            Uint8List.fromList(utf8.encode(pin)).toJS,
            {'name': 'PBKDF2'}.jsify()! as JSObject,
            false.toJS,
            ['deriveBits'.toJS].toJS)
        .toDart;
    final bits = await _subtle
        .deriveBits(
            {
              'name': 'PBKDF2',
              'hash': 'SHA-256',
              'iterations': 120000,
              'salt': Uint8List.fromList(salt).toJS,
            }.jsify()! as JSObject,
            key,
            256.toJS)
        .toDart;
    return base64.encode(bits.toDart.asUint8List());
  } catch (_) {
    return deriveAppPinHashYielding(pin, salt);
  }
}
