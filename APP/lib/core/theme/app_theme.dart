import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// ─── TRUSTPAY DESIGN SYSTEM ───────────────────────────────────────────────────
// Extracted from reference images: SeatGeek, Superlist, Toko
// - Dark near-black background
// - Coral / Red-Orange accent (#E8472A)
// - Bold modern sans-serif typography (Inter)
// - Pill / Stadium shaped buttons
// - Subtle grey secondary surfaces
// ─────────────────────────────────────────────────────────────────────────────

class AppColors {
  // Backgrounds
  static const Color background     = Color(0xFF0D0E14); // Deep near-black
  static const Color surface        = Color(0xFF16182A); // Slightly lifted surface
  static const Color surfaceVariant = Color(0xFF1E2035); // Elevated card surface
  static const Color inputFill      = Color(0xFF1C1E30); // Text field fill

  // Accents
  static const Color primary        = Color(0xFFE8472A); // Coral / Red-Orange
  static const Color primaryLight   = Color(0xFFFF6B50); // Lighter tint
  static const Color primaryDark    = Color(0xFFC23620); // Pressed state

  // Text
  static const Color textPrimary    = Color(0xFFFFFFFF); // Pure white
  static const Color textSecondary  = Color(0xFFA0A3B8); // Muted grey
  static const Color textHint       = Color(0xFF6B6E87); // Placeholder text
  static const Color textLink       = Color(0xFFE8472A); // Link text (accent)

  // Borders & Dividers
  static const Color border         = Color(0xFF2A2D45); // Subtle border
  static const Color divider        = Color(0xFF1E2035); // Divider line

  // Semantic Colors
  static const Color success        = Color(0xFF22C55E);
  static const Color warning        = Color(0xFFF59E0B);
  static const Color error          = Color(0xFFEF4444);

  // Overlay
  static const Color overlay        = Color(0x99000000); // 60% black
  static const Color overlayLight   = Color(0x40000000); // 25% black
}

class AppTextStyles {
  static TextStyle get _base => GoogleFonts.inter();

  static TextStyle get displayLarge => _base.copyWith(
    fontSize: 40,
    fontWeight: FontWeight.w800,
    color: AppColors.textPrimary,
    height: 1.15,
    letterSpacing: -1.0,
  );

  static TextStyle get displayMedium => _base.copyWith(
    fontSize: 32,
    fontWeight: FontWeight.w800,
    color: AppColors.textPrimary,
    height: 1.2,
    letterSpacing: -0.8,
  );

  static TextStyle get headingXL => _base.copyWith(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.25,
    letterSpacing: -0.5,
  );

  static TextStyle get headingL => _base.copyWith(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.3,
    letterSpacing: -0.3,
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
    letterSpacing: 0.1,
  );

  static TextStyle get labelM => _base.copyWith(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    letterSpacing: 0.1,
  );

  static TextStyle get labelS => _base.copyWith(
    fontSize: 12,
    fontWeight: FontWeight.w500,
    color: AppColors.textSecondary,
    letterSpacing: 0.2,
  );

  static TextStyle get caption => _base.copyWith(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    color: AppColors.textHint,
    letterSpacing: 0.3,
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
  static const double xs   = 6;
  static const double sm   = 10;
  static const double md   = 14;
  static const double lg   = 20;
  static const double xl   = 28;
  static const double full = 999;
}

class AppSpacing {
  static const double xs   = 4;
  static const double sm   = 8;
  static const double md   = 16;
  static const double lg   = 24;
  static const double xl   = 32;
  static const double xxl  = 48;
  static const double xxxl = 64;
}

class AppTheme {
  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.background,
    colorScheme: const ColorScheme.dark(
      primary: AppColors.primary,
      secondary: AppColors.primaryLight,
      surface: AppColors.surface,
      error: AppColors.error,
      onPrimary: AppColors.textPrimary,
      onSecondary: AppColors.textPrimary,
      onSurface: AppColors.textPrimary,
      onError: AppColors.textPrimary,
    ),
    textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.inputFill,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.md,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: const BorderSide(color: AppColors.border, width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: const BorderSide(color: AppColors.border, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: const BorderSide(color: AppColors.error, width: 1.5),
      ),
      hintStyle: AppTextStyles.bodyM.copyWith(color: AppColors.textHint),
      labelStyle: AppTextStyles.bodyM.copyWith(color: AppColors.textSecondary),
      errorStyle: AppTextStyles.bodyS.copyWith(color: AppColors.error),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.textPrimary,
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
        foregroundColor: AppColors.textPrimary,
        minimumSize: const Size(double.infinity, 54),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.full),
        ),
        side: const BorderSide(color: AppColors.border, width: 1.5),
        textStyle: AppTextStyles.labelL,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: AppTextStyles.headingM,
      iconTheme: const IconThemeData(color: AppColors.textPrimary),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.divider,
      thickness: 1,
    ),
  );
}
