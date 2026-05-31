import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';

class RecentRecipients extends StatelessWidget {
  const RecentRecipients({super.key});

  @override
  Widget build(BuildContext context) {
    return const _RecentRecipientsContent();
  }
}

class _RecentRecipientsContent extends StatefulWidget {
  const _RecentRecipientsContent();

  @override
  State<_RecentRecipientsContent> createState() => _RecentRecipientsContentState();
}

class _RecentRecipientsContentState extends State<_RecentRecipientsContent> {
  final _service = HomeDataService();
  late Future<List<HomeBeneficiary>> _future;

  @override
  void initState() {
    super.initState();
    _future = _service.fetchBeneficiaries();
  }

  void _reload() {
    setState(() {
      _future = _service.fetchBeneficiaries();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Recipients', style: AppTextStyles.headingM),
            GestureDetector(
              onTap: () => context.push(AppRoutes.withdraw),
              child: Text(
                'Add',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        FutureBuilder<List<HomeBeneficiary>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const _RecipientsLoadingState();
            }

            if (snapshot.hasError) {
              return _RecipientsMessage(
                title: authErrorMessage(
                  snapshot.error ?? 'Could not load recipients',
                  'Could not load recipients',
                ),
                actionLabel: 'Retry',
                onAction: _reload,
              );
            }

            final recipients = snapshot.data ?? const <HomeBeneficiary>[];
            if (recipients.isEmpty) {
              return _RecipientsMessage(
                title: 'No recent recipients yet',
                detail: 'Save a withdrawal beneficiary to show it here.',
                actionLabel: 'Withdraw',
                onAction: () => context.push(AppRoutes.withdraw),
              );
            }

            return Column(
              children: recipients.map(_RecipientRow.new).toList(),
            );
          },
        ),
      ],
    );
  }
}

class _RecipientsLoadingState extends StatelessWidget {
  const _RecipientsLoadingState();

  @override
  Widget build(BuildContext context) {
    return const TrustPayAnimatedState(
      variant: TrustPayAnimationVariant.loading,
      title: 'Loading recent recipients',
      detail: 'Pulling your saved beneficiaries.',
      animationSize: 62,
    );
  }
}

class _RecipientsMessage extends StatelessWidget {
  final String title;
  final String? detail;
  final String actionLabel;
  final VoidCallback onAction;

  const _RecipientsMessage({
    required this.title,
    this.detail,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          TrustPayLottie(
            variant: detail == null
                ? TrustPayAnimationVariant.send
                : TrustPayAnimationVariant.loading,
            size: 60,
            semanticsLabel: title,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(title, style: AppTextStyles.labelM, textAlign: TextAlign.center),
          if (detail != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              detail!,
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          TextButton(onPressed: onAction, child: Text(actionLabel)),
        ],
      ),
    );
  }
}

class _RecipientRow extends StatelessWidget {
  final HomeBeneficiary beneficiary;

  const _RecipientRow(this.beneficiary);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.inputFill,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.border),
            ),
            child: Icon(
              Icons.account_balance_outlined,
              color: AppColors.textSecondary,
              size: 22,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(beneficiary.accountName, style: AppTextStyles.labelM),
                const SizedBox(height: 2),
                Text(
                  '${beneficiary.bankName} • ${beneficiary.accountNumberMasked}',
                  style: AppTextStyles.bodyS,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Text(
            beneficiary.currency,
            style: AppTextStyles.bodyS,
            textAlign: TextAlign.right,
          ),
        ],
      ),
    );
  }
}
