import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';

/// Animated splash screen that transitions to onboarding or home.
/// Features the TRUSTPAY logo on a dark background with a coral glow.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _logoScale;
  late Animation<double> _logoOpacity;
  late Animation<double> _taglineOpacity;
  final _authService = AuthService();
  bool _isCheckingSession = true;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );

    _logoScale = Tween<double>(begin: 0.6, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.6, curve: Curves.elasticOut),
      ),
    );

    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.4, curve: Curves.easeIn),
      ),
    );

    _taglineOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.5, 1.0, curve: Curves.easeIn),
      ),
    );

    _controller.forward();

    _resolveInitialRoute();
  }

  Future<void> _resolveInitialRoute() async {
    // Wait for splash animation to play (min 2.8s) while checking session
    final results = await Future.wait([
      Future.delayed(const Duration(milliseconds: 2800)),
      _tryRestoreSession(),
    ]);

    if (!mounted) return;

    final hasSession = results[1] as bool;
    if (hasSession) {
      context.go(AppRoutes.home);
    } else {
      context.go(AppRoutes.onboarding);
    }
  }

  Future<bool> _tryRestoreSession() async {
    try {
      _isCheckingSession = true;
      return await _authService.refreshSession();
    } catch (_) {
      return false;
    } finally {
      _isCheckingSession = false;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Logo Mark
            AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                return Opacity(
                  opacity: _logoOpacity.value,
                  child: Transform.scale(
                    scale: _logoScale.value,
                    child: child,
                  ),
                );
              },
              child: const _LogoMark(),
            ),

            SizedBox(height: AppSpacing.xl),

            // App Name + Tagline
            AnimatedBuilder(
              animation: _taglineOpacity,
              builder: (context, child) {
                return Opacity(
                  opacity: _taglineOpacity.value,
                  child: child,
                );
              },
              child: Column(
                children: [
                  Text(
                    'TRUSTPAY',
                    style: AppTextStyles.displayMedium.copyWith(
                      letterSpacing: 4,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Send money across borders.',
                    style: AppTextStyles.bodyL.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// â”€â”€â”€ LOGO MARK WIDGET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _LogoMark extends StatelessWidget {
  const _LogoMark();

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        TrustPayLottie(
          variant: TrustPayAnimationVariant.loading,
          size: 136,
          semanticsLabel: 'Starting TRUSTPAY',
        ),
        Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(AppRadius.xl),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.4),
                blurRadius: 40,
                spreadRadius: 8,
              ),
            ],
          ),
          child: Center(
            child: Text(
              'T',
              style: TextStyle(
                fontSize: 44,
                fontWeight: FontWeight.w900,
                color: Colors.white,
                letterSpacing: -2,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
