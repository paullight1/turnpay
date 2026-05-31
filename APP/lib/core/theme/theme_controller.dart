import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final themeModeProvider =
    StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController()..load();
});

class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController() : super(ThemeMode.light);

  static const _storage = FlutterSecureStorage();
  static const _storageKey = 'trustpay_theme_mode';

  Future<void> load() async {
    final raw = await _storage.read(key: _storageKey);
    if (raw == 'light') {
      state = ThemeMode.light;
      return;
    }

    state = ThemeMode.light;
  }

  Future<void> setMode(ThemeMode mode) async {
    state = mode;
    await _storage.write(
      key: _storageKey,
      value: mode == ThemeMode.light ? 'light' : 'dark',
    );
  }

  Future<void> toggle(bool isLight) {
    return setMode(isLight ? ThemeMode.light : ThemeMode.dark);
  }
}
