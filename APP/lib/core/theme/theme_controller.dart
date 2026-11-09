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
  ThemeModeController() : super(ThemeMode.system);

  static const _storage = FlutterSecureStorage();
  static const _storageKey = 'trustpay_theme_mode';

  bool _selectedThisSession = false;
  Future<void> _pendingWrite = Future.value();

  Future<void> load() async {
    try {
      final raw = await _storage.read(key: _storageKey);
      if (mounted && !_selectedThisSession) state = _decode(raw);
    } catch (_) {
      // Follow the phone setting if the stored preference is unavailable.
    }
  }

  Future<void> setMode(ThemeMode mode) {
    _selectedThisSession = true;
    state = mode;
    _pendingWrite = _pendingWrite.then((_) async {
      try {
        await _storage.write(key: _storageKey, value: _encode(mode));
      } catch (_) {
        // The selected theme still applies for the current session.
      }
    });
    return _pendingWrite;
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
        return ThemeMode.system;
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
