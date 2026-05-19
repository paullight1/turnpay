import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/router/app_router.dart';

// â”€â”€â”€ ONBOARDING DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _OnboardingPage {
  final String title;
  final String subtitle;
  final Color gradientTopColor;
  final Color gradientBottomColor;
  final IconData icon;

  const _OnboardingPage({
    required this.title,
    required this.subtitle,
    required this.gradientTopColor,
    required this.gradientBottomColor,
    required this.icon,
  });
}

const _pages = [
  _OnboardingPage(
    title: 'Send money\nwithout limits.',
    subtitle: 'Transfer between GHS and NGN instantly at the best market rates.',
    gradientTopColor: Color(0xFF1A0A0A),
    gradientBottomColor: Color(0xFF0D0E14),
    icon: Icons.send_rounded,
  ),
  _OnboardingPage(
    title: 'Pay your bills\nin seconds.',
    subtitle: 'Top up airtime, pay for data, electricity and cable TV â€” all in one place.',
    gradientTopColor: Color(0xFF0A0F1A),
    gradientBottomColor: Color(0xFF0D0E14),
    icon: Icons.receipt_long_rounded,
  ),
  _OnboardingPage(
    title: 'Your money,\nalways safe.',
    subtitle: 'Bank-grade encryption and two-factor authentication protect every transaction.',
    gradientTopColor: Color(0xFF0A1A10),
    gradientBottomColor: Color(0xFF0D0E14),
    icon: Icons.shield_rounded,
  ),
];

// â”€â”€â”€ ONBOARDING SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/// SeatGeek-inspired full-screen onboarding with large hero illustrations,
/// dot page indicators, and dual Sign Up / Log In bottom CTAs.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with TickerProviderStateMixin {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    setState(() => _currentPage = index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          // â”€â”€ Full-screen PageView â”€â”€
          PageView.builder(
            controller: _pageController,
            itemCount: _pages.length,
            onPageChanged: _onPageChanged,
            itemBuilder: (context, index) {
              return _OnboardingPageView(page: _pages[index]);
            },
          ),

          // â”€â”€ Skip Button â”€â”€
          Positioned(
            top: 56,
            right: AppSpacing.lg,
            child: GestureDetector(
              onTap: () => context.go(AppRoutes.login),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceVariant,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
                child: Text(
                  'SKIP',
                  style: AppTextStyles.labelS.copyWith(
                    color: AppColors.textSecondary,
                    letterSpacing: 1.5,
                  ),
                ),
              ),
            ),
          ),

          // â”€â”€ Bottom Section (Dots + Buttons) â”€â”€
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

// â”€â”€â”€ INDIVIDUAL PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _OnboardingPageView extends StatelessWidget {
  final _OnboardingPage page;

  const _OnboardingPageView({required this.page});

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);

    return Stack(
      children: [
        // Hero gradient background (top 60% of screen)
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          height: size.height * 0.60,
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  page.gradientTopColor,
                  AppColors.background,
                ],
              ),
            ),
            child: Center(
              child: _HeroIllustration(icon: page.icon),
            ),
          ),
        ),

        // Text Content Overlay (bottom 55%)
        Positioned(
          bottom: 170, // above the CTA buttons
          left: AppSpacing.lg,
          right: AppSpacing.lg,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                page.title,
                style: AppTextStyles.displayLarge,
              ),
              SizedBox(height: AppSpacing.md),
              Text(
                page.subtitle,
                style: AppTextStyles.bodyL,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// â”€â”€â”€ HERO ILLUSTRATION (placeholder icon with glow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _HeroIllustration extends StatelessWidget {
  final IconData icon;
  const _HeroIllustration({required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 140,
      height: 140,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.surfaceVariant,
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.25),
            blurRadius: 60,
            spreadRadius: 20,
          ),
        ],
      ),
      child: Icon(
        icon,
        size: 64,
        color: AppColors.primary,
      ),
    );
  }
}

// â”€â”€â”€ BOTTOM SECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _BottomSection extends StatelessWidget {
  final int currentPage;
  final int totalPages;

  const _BottomSection({
    required this.currentPage,
    required this.totalPages,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.lg,
        40,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.background.withOpacity(0),
            AppColors.background,
            AppColors.background,
          ],
          stops: const [0.0, 0.2, 1.0],
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Page Indicator Dots
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
                  color: isActive ? AppColors.primary : AppColors.border,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
              );
            }),
          ),

          SizedBox(height: AppSpacing.lg),

          // CTA Buttons Row (Sign up | Log in)
          Row(
            children: [
              // Sign Up - White fill (primary action)
              Expanded(
                child: _AuthButton(
                  label: 'Sign up',
                  isFilledWhite: true,
                  onTap: () => context.push(AppRoutes.register),
                ),
              ),
              SizedBox(width: AppSpacing.md),
              // Log In - Dark outline
              Expanded(
                child: _AuthButton(
                  label: 'Log in',
                  isFilledWhite: false,
                  onTap: () => context.push(AppRoutes.login),
                ),
              ),
            ],
          ),

          SizedBox(height: AppSpacing.lg),

          // Legal links
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Terms of use', style: AppTextStyles.caption),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                child: Text('|', style: AppTextStyles.caption),
              ),
              Text('Privacy Policy', style: AppTextStyles.caption),
            ],
          ),
        ],
      ),
    );
  }
}

class _AuthButton extends StatelessWidget {
  final String label;
  final bool isFilledWhite;
  final VoidCallback onTap;

  const _AuthButton({
    required this.label,
    required this.isFilledWhite,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 54,
        decoration: BoxDecoration(
          color: isFilledWhite
              ? AppColors.textPrimary
              : AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: isFilledWhite
              ? null
              : Border.all(color: AppColors.border, width: 1.5),
        ),
        child: Center(
          child: Text(
            label,
            style: AppTextStyles.labelL.copyWith(
              color: isFilledWhite
                  ? AppColors.background
                  : AppColors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

