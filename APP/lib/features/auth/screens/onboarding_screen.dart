import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/launch_capabilities.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../widgets/auth_help_button.dart';
import '../widgets/legal_page_link.dart';

class _OnboardingPage {
  final String title;
  final String subtitle;
  final String imageAsset;

  const _OnboardingPage({
    required this.title,
    required this.subtitle,
    required this.imageAsset,
  });
}

const _pages = [
  if (LaunchCapabilities.moneyOutEnabled)
    _OnboardingPage(
      title: 'Send money\nwithout limits.',
      subtitle:
          'Transfer between GHS and NGN instantly at the best market rates.',
      imageAsset: 'assets/images/onboarding_transfer.jpg',
    ),
  _OnboardingPage(
    title: 'Swap cedis to naira\nin seconds.',
    subtitle:
        'Move between GHS and NGN instantly, then keep airtime, data, electricity, and cable TV in one wallet.',
    imageAsset: 'assets/images/onboarding_bills.jpg',
  ),
  _OnboardingPage(
    title: 'Your money,\nalways safe.',
    subtitle:
        'Bank-grade encryption and two-factor authentication protect every transaction.',
    imageAsset: 'assets/images/onboarding_security.jpg',
  ),
];

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _pageController = PageController();
  Timer? _autoScrollTimer;
  int _currentPage = 0;

  @override
  void initState() {
    super.initState();
    _autoScrollTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted || !_pageController.hasClients) return;

      final nextPage = (_currentPage + 1) % _pages.length;
      _pageController.animateToPage(
        nextPage,
        duration: const Duration(milliseconds: 520),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _autoScrollTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    setState(() => _currentPage = index);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: const Color(0xFF0D0E14),
      body: Stack(
        children: [
          PageView.builder(
            controller: _pageController,
            itemCount: _pages.length,
            onPageChanged: _onPageChanged,
            itemBuilder: (context, index) {
              return _OnboardingPageView(page: _pages[index]);
            },
          ),
          Positioned(
            top: 56,
            right: AppSpacing.lg,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const AuthHelpButton(onDark: true),
                const SizedBox(width: AppSpacing.sm),
                GestureDetector(
                  onTap: () => context.go(AppRoutes.login),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: AppSpacing.sm,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(AppRadius.full),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.18),
                      ),
                    ),
                    child: Text(
                      'SKIP',
                      style: AppTextStyles.labelS.copyWith(
                        color: Colors.white.withValues(alpha: 0.86),
                        letterSpacing: 1.5,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _BottomSection(
              currentPage: _currentPage,
              totalPages: _pages.length,
            ),
          ),
        ],
      ),
    );
  }
}

class _OnboardingPageView extends StatelessWidget {
  final _OnboardingPage page;

  const _OnboardingPageView({required this.page});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Stack(
      fit: StackFit.expand,
      children: [
        Image.asset(
          page.imageAsset,
          fit: BoxFit.cover,
          alignment: Alignment.center,
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              stops: const [0, 0.36, 0.66, 1],
              colors: [
                Colors.black.withValues(alpha: 0.18),
                Colors.black.withValues(alpha: 0.05),
                Colors.black.withValues(alpha: 0.62),
                Colors.black.withValues(alpha: 0.94),
              ],
            ),
          ),
        ),
        Positioned(
          bottom: 214,
          left: AppSpacing.lg,
          right: AppSpacing.lg,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                page.title,
                style: AppTextStyles.displayLarge.copyWith(
                  color: Colors.white,
                  height: 1.08,
                  shadows: [
                    Shadow(
                      color: Colors.black.withValues(alpha: 0.28),
                      blurRadius: 18,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                page.subtitle,
                style: AppTextStyles.bodyL.copyWith(
                  color: Colors.white.withValues(alpha: 0.82),
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _BottomSection extends StatelessWidget {
  final int currentPage;
  final int totalPages;

  const _BottomSection({
    required this.currentPage,
    required this.totalPages,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.lg,
        40,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(totalPages, (index) {
              final isActive = index == currentPage;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOut,
                margin: const EdgeInsets.symmetric(horizontal: 4),
                width: isActive ? 24 : 8,
                height: 8,
                decoration: BoxDecoration(
                  color: isActive
                      ? AppColors.primary
                      : Colors.white.withValues(alpha: 0.36),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
              );
            }),
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: _AuthButton(
                  label: 'Sign up',
                  isPrimary: true,
                  onTap: () => context.push(AppRoutes.register),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _AuthButton(
                  label: 'Log in',
                  isPrimary: false,
                  onTap: () => context.push(AppRoutes.login),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.xs,
            children: [
              LegalPageLink(
                label: 'Terms of use',
                fragment: 'terms',
                style: AppTextStyles.caption.copyWith(
                  color: Colors.white.withValues(alpha: 0.74),
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                '|',
                style: AppTextStyles.caption.copyWith(
                  color: Colors.white.withValues(alpha: 0.48),
                ),
              ),
              LegalPageLink(
                label: 'Privacy Policy',
                fragment: 'privacy',
                style: AppTextStyles.caption.copyWith(
                  color: Colors.white.withValues(alpha: 0.74),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AuthButton extends StatelessWidget {
  final String label;
  final bool isPrimary;
  final VoidCallback onTap;

  const _AuthButton({
    required this.label,
    required this.isPrimary,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final style = FilledButton.styleFrom(
      backgroundColor:
          isPrimary ? AppColors.primary : Colors.white.withValues(alpha: .14),
      foregroundColor: Colors.white,
      minimumSize: const Size.fromHeight(56),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.button)),
      side: isPrimary
          ? null
          : BorderSide(color: Colors.white.withValues(alpha: .42), width: 1.5),
      textStyle: AppTextStyles.labelL.copyWith(fontWeight: FontWeight.w700),
    );
    return FilledButton(
        onPressed: onTap,
        style: style,
        child: Text(label, textAlign: TextAlign.center));
  }
}
