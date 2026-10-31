import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';
import '../../../services/auth_service.dart';

/// Animated splash screen that transitions to onboarding or home.
/// Features the TrustPay brand mark before the app name.
class SplashScreen extends StatefulWidget {
  final AuthService authService;
  final Duration minimumDelay;

  SplashScreen({
    super.key,
    AuthService? authService,
    this.minimumDelay = Duration.zero,
  }) : authService = authService ?? AuthService();

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _logoScale;
  late Animation<double> _logoOpacity;
  late Animation<double> _taglineOpacity;

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
    // Restore the session immediately; optional branding delays must not hold
    // up the default launch path after authentication is ready.
    final results = await Future.wait([
      Future.delayed(widget.minimumDelay),
      _tryRestoreSession(),
    ]);

    if (!mounted) return;

    final state = results[1] as SessionRestoreState;
    switch (state) {
      // Active session, or an offline launch where we still hold valid tokens:
      // let the user in and retry the refresh on the next authenticated call
      // instead of logging them out because the network is down.
      case SessionRestoreState.active:
      case SessionRestoreState.offline:
        context.go(AppRoutes.home);
      case SessionRestoreState.expired:
        context.go(AppRoutes.onboarding);
    }
  }

  Future<SessionRestoreState> _tryRestoreSession() async {
    try {
      return await widget.authService.restoreSession();
    } catch (_) {
      // An unexpected error should not blow away a stored session; retry later.
      return SessionRestoreState.offline;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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

            const SizedBox(height: AppSpacing.xl),

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
                    'TrustPay',
                    style: AppTextStyles.displayMedium.copyWith(
                      letterSpacing: -0.4,
                      color: AppColors.textPrimary,
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

class _LogoMark extends StatelessWidget {
  const _LogoMark();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: 116,
      height: 116,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 32,
            offset: const Offset(0, 18),
          ),
        ],
      ),
      child: Image.asset(
        'assets/icons/trustpay-logo.png',
        fit: BoxFit.contain,
        semanticLabel: 'TrustPay logo',
      ),
    );
  }
}
