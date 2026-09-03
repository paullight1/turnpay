import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_page_header.dart';

class SendMoneyEntryScreen extends StatelessWidget {
  const SendMoneyEntryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xxl,
              ),
              sliver: SliverList.list(
                children: [
                  const TpPageHeader(
                    label: 'Send money',
                    showBackButton: true,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Center(
                    child: TpIllustration(
                      variant: TpIllustrationVariant.send,
                      size: 148,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    'Pick a TrustPay user or send to a bank account.',
                    style: AppTextStyles.bodyL,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  _ChoiceCard(
                    icon: Icons.people_alt_rounded,
                    title: 'TrustPay users',
                    description:
                        'Send instantly to another TrustPay user by email.',
                    accent: AppColors.primary,
                    onTap: () => context.push(AppRoutes.sendTrustpay),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _ChoiceCard(
                    icon: Icons.account_balance_rounded,
                    title: 'Other banks',
                    description:
                        'Send to a bank account with name verification.',
                    accent: AppColors.primaryDark,
                    onTap: () => context.push(AppRoutes.sendBank),
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

class _ChoiceCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final Color accent;
  final VoidCallback onTap;

  const _ChoiceCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.accent,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: () {
          Haptics.selection();
          onTap();
        },
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(icon, color: accent, size: 24),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppTextStyles.labelL),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      description,
                      style: AppTextStyles.bodyS.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Icon(
                Icons.arrow_forward_ios_rounded,
                color: accent,
                size: 16,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
