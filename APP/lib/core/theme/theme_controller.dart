import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final themeModeProvider =
    StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController()..load();
});

/// Persists the user's appearance preference and exposes it as a [ThemeMode].
///
/// Supports three states:
///  - [ThemeMode.system] (default): follow the device light/dark setting.
///  - [ThemeMode.light] / [ThemeMode.dark]: an explicit manual override.
class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController() : super(ThemeMode.light);

  static const _storage = FlutterSecureStorage();
  static const _storageKey = 'trustpay_theme_mode';

  Future<void> load() async {
    final raw = await _storage.read(key: _storageKey);
    state = _decode(raw);
  }

  Future<void> setMode(ThemeMode mode) async {
    state = mode;
    await _storage.write(key: _storageKey, value: _encode(mode));
  }

  Future<void> toggle(bool isLight) {
    return setMode(isLight ? ThemeMode.light : ThemeMode.dark);
  }

  static ThemeMode _decode(String? raw) {
    switch (raw) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
        return ThemeMode.system;
      default:
        return ThemeMode.light;
    }
  }

  static String _encode(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }
}
