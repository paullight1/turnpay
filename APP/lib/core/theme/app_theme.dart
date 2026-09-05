import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class _AppPalette {
  final Color background;
  final Color surface;
  final Color surfaceVariant;
  final Color inputFill;
  final Color primary;
  final Color primaryLight;
  final Color primaryDark;
  final Color textPrimary;
  final Color textSecondary;
  final Color textHint;
  final Color textLink;
  final Color border;
  final Color divider;
  final Color success;
  final Color warning;
  final Color error;
  final Color overlay;
  final Color overlayLight;

  const _AppPalette({
    required this.background,
    required this.surface,
    required this.surfaceVariant,
    required this.inputFill,
    required this.primary,
    required this.primaryLight,
    required this.primaryDark,
    required this.textPrimary,
    required this.textSecondary,
    required this.textHint,
    required this.textLink,
    required this.border,
    required this.divider,
    required this.success,
    required this.warning,
    required this.error,
    required this.overlay,
    required this.overlayLight,
  });
}

class AppColors {
  static const _dark = _AppPalette(
    background: Color(0xFF0D0E14),
    surface: Color(0xFF16182A),
    surfaceVariant: Color(0xFF1E2035),
    inputFill: Color(0xFF1C1E30),
    primary: Color(0xFFE8472A),
    primaryLight: Color(0xFFFF6B50),
    primaryDark: Color(0xFFC23620),
    textPrimary: Color(0xFFFFFFFF),
    textSecondary: Color(0xFFA0A3B8),
    textHint: Color(0xFF9B9FB4),
    textLink: Color(0xFFE8472A),
    border: Color(0xFF2A2D45),
    divider: Color(0xFF1E2035),
    success: Color(0xFF22C55E),
    warning: Color(0xFFF59E0B),
    error: Color(0xFFEF4444),
    overlay: Color(0x99000000),
    overlayLight: Color(0x40000000),
  );

  static const _light = _AppPalette(
    background: Color(0xFFF6F7FB),
    surface: Color(0xFFFFFFFF),
    surfaceVariant: Color(0xFFF1F3FA),
    inputFill: Color(0xFFF5F6FB),
    primary: Color(0xFFE8472A),
    primaryLight: Color(0xFFFF6B50),
    primaryDark: Color(0xFFC23620),
    textPrimary: Color(0xFF12131A),
    textSecondary: Color(0xFF5F6478),
    textHint: Color(0xFF686E82),
    textLink: Color(0xFFE8472A),
    border: Color(0xFFD8DCEA),
    divider: Color(0xFFE7EAF3),
    success: Color(0xFF16A34A),
    warning: Color(0xFFD97706),
    error: Color(0xFFDC2626),
    overlay: Color(0x73000000),
    overlayLight: Color(0x19000000),
  );

  static _AppPalette _active = _light;

  /// Whether the currently active palette is the dark one.
  static bool isDark = false;

  /// Register the widget's dependency on the inherited theme before reading
  /// shared palette/text getters. This also updates already-open routes and
  /// const child widgets when appearance changes, without resetting state.
  static void watch(BuildContext context) {
    applyBrightness(Theme.of(context).brightness);
  }

  /// Apply a resolved [Brightness]. This is the source of truth used by every
  /// static color getter below, so it must be called with the *effective*
  /// brightness (system mode already resolved) before the subtree builds.
  static void applyBrightness(Brightness brightness) {
    isDark = brightness == Brightness.dark;
    _active = isDark ? _dark : _light;
  }

  /// Backwards-compatible helper. Prefer [applyBrightness] with a resolved
  /// brightness so that [ThemeMode.system] follows the device correctly.
  static void applyThemeMode(ThemeMode mode) {
    applyBrightness(
        mode == ThemeMode.dark ? Brightness.dark : Brightness.light);
  }

  static Color get background => _active.background;
  static Color get surface => _active.surface;
  static Color get surfaceVariant => _active.surfaceVariant;
  static Color get inputFill => _active.inputFill;
  static Color get primary => _active.primary;
  static Color get primaryLight => _active.primaryLight;
  static Color get primaryDark => _active.primaryDark;
  static Color get textPrimary => _active.textPrimary;
  static Color get textSecondary => _active.textSecondary;
  static Color get textHint => _active.textHint;
  static Color get textLink => _active.textLink;
  static Color get border => _active.border;
  static Color get divider => _active.divider;
  static Color get success => _active.success;
  static Color get warning => _active.warning;
  static Color get error => _active.error;
  static Color get overlay => _active.overlay;
  static Color get overlayLight => _active.overlayLight;
}

class AppTextStyles {
  static TextStyle get _base => GoogleFonts.inter();

  static TextStyle get displayLarge => _base.copyWith(
        fontSize: 40,
        fontWeight: FontWeight.w800,
        color: AppColors.textPrimary,
        height: 1.15,
        letterSpacing: 0,
      );

  static TextStyle get displayMedium => _base.copyWith(
        fontSize: 32,
        fontWeight: FontWeight.w800,
        color: AppColors.textPrimary,
        height: 1.2,
        letterSpacing: 0,
      );

  static TextStyle get headingXL => _base.copyWith(
        fontSize: 28,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
        height: 1.25,
        letterSpacing: 0,
      );

  static TextStyle get headingL => _base.copyWith(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
        height: 1.3,
        letterSpacing: 0,
      );

  static TextStyle get headingM => _base.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: AppColors.textPrimary,
        height: 1.35,
      );

  static TextStyle get bodyL => _base.copyWith(
        fontSize: 16,
        fontWeight: FontWeight.w400,
        color: AppColors.textSecondary,
        height: 1.6,
      );

  static TextStyle get bodyM => _base.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        color: AppColors.textSecondary,
        height: 1.55,
      );

  static TextStyle get bodyS => _base.copyWith(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        color: AppColors.textHint,
        height: 1.5,
      );

  static TextStyle get labelL => _base.copyWith(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: AppColors.textPrimary,
        letterSpacing: 0,
      );

  static TextStyle get labelM => _base.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: AppColors.textPrimary,
        letterSpacing: 0,
      );

  static TextStyle get labelS => _base.copyWith(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: AppColors.textSecondary,
        letterSpacing: 0,
      );

  static TextStyle get caption => _base.copyWith(
        fontSize: 11,
        fontWeight: FontWeight.w400,
        color: AppColors.textHint,
        letterSpacing: 0,
      );

  static TextStyle get link => _base.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w500,
        color: AppColors.primary,
        decoration: TextDecoration.underline,
        decorationColor: AppColors.primary,
      );
}

class AppRadius {
  static const double xs = 6;
  static const double sm = 10;
  static const double md = 14;
  static const double lg = 20;
  static const double xl = 28;
  static const double full = 999;
}

class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
  static const double xxxl = 64;
}

class AppTheme {
  static ThemeData get dark => _buildTheme(
        brightness: Brightness.dark,
        palette: AppColors._dark,
      );

  static ThemeData get light => _buildTheme(
        brightness: Brightness.light,
        palette: AppColors._light,
      );

  static ThemeData _buildTheme({
    required Brightness brightness,
    required _AppPalette palette,
  }) {
    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
    );

    return base.copyWith(
      scaffoldBackgroundColor: palette.background,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: palette.primary,
        onPrimary: brightness == Brightness.dark ? Colors.white : Colors.white,
        secondary: palette.primaryLight,
        onSecondary:
            brightness == Brightness.dark ? Colors.white : Colors.white,
        error: palette.error,
        onError: Colors.white,
        surface: palette.surface,
        onSurface: palette.textPrimary,
      ),
      textTheme: GoogleFonts.interTextTheme(base.textTheme).apply(
        bodyColor: palette.textPrimary,
        displayColor: palette.textPrimary,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: palette.inputFill,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: palette.border, width: 1),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: palette.border, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: palette.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: palette.error, width: 1.5),
        ),
        hintStyle: AppTextStyles.bodyM.copyWith(color: palette.textHint),
        labelStyle: AppTextStyles.bodyM.copyWith(color: palette.textSecondary),
        errorStyle: AppTextStyles.bodyS.copyWith(color: palette.error),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: palette.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          textStyle: AppTextStyles.labelL,
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: palette.textPrimary,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          side: BorderSide(color: palette.border, width: 1.5),
          textStyle: AppTextStyles.labelL,
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: AppTextStyles.headingM,
        iconTheme: IconThemeData(color: palette.textPrimary),
      ),
      dividerTheme: DividerThemeData(
        color: palette.divider,
        thickness: 1,
      ),
    );
  }
}
