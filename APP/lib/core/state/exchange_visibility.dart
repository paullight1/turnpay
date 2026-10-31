import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _storage = FlutterSecureStorage();
const _key = 'exchange-services-enabled';
final ValueNotifier<bool> exchangeServicesEnabled = ValueNotifier(true);
bool _loaded = false;

Future<void> loadExchangeServicesPreference() async {
  if (_loaded) return;
  _loaded = true;
  try {
    exchangeServicesEnabled.value = await _storage.read(key: _key) != 'false';
  } catch (_) {
    exchangeServicesEnabled.value = true;
  }
}

Future<void> setExchangeServicesEnabled(bool enabled) async {
  exchangeServicesEnabled.value = enabled;
  try {
    await _storage.write(key: _key, value: enabled.toString());
  } catch (_) {
    // The in-memory setting still applies for this app session.
  }
}
