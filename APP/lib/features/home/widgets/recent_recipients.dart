import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/trustpay_lottie.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';
import '../screens/money_action_screen.dart';

class RecentRecipients extends StatelessWidget {
  final HomeDataService homeDataService;

  RecentRecipients({
    super.key,
    HomeDataService? homeDataService,
  }) : homeDataService = homeDataService ?? HomeDataService();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return _RecentRecipientsContent(homeDataService: homeDataService);
  }
}

class _RecentRecipientsContent extends StatefulWidget {
  final HomeDataService homeDataService;

  const _RecentRecipientsContent({
    required this.homeDataService,
  });

  @override
  State<_RecentRecipientsContent> createState() =>
      _RecentRecipientsContentState();
}

class _RecentRecipientsContentState extends State<_RecentRecipientsContent> {
  late Future<List<HomeBeneficiary>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.homeDataService.fetchBeneficiaries();
  }

  void _reload() {
    setState(() {
      _future = widget.homeDataService.fetchBeneficiaries();
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
                variant: TpIllustrationVariant.connectionLost,
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
                variant: TpIllustrationVariant.emptyRecipients,
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
    AppColors.watch(context);
    return const TrustPayAnimatedState(
      variant: TrustPayAnimationVariant.loading,
      title: 'Loading recent recipients',
      detail: 'Pulling your saved beneficiaries.',
      animationSize: 62,
    );
  }
}

class _RecipientsMessage extends StatelessWidget {
  final TpIllustrationVariant variant;
  final String title;
  final String? detail;
  final String actionLabel;
  final VoidCallback onAction;

  const _RecipientsMessage({
    required this.variant,
    required this.title,
    this.detail,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
          TpIllustration(variant: variant, size: 124, semanticLabel: title),
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
          TextButton(
            onPressed: () {
              Haptics.selection();
              onAction();
            },
            child: Text(actionLabel),
          ),
        ],
      ),
    );
  }
}

class _RecipientRow extends StatelessWidget {
  final HomeBeneficiary beneficiary;

  const _RecipientRow(this.beneficiary);

  void _openWithdraw(BuildContext context) {
    Haptics.selection();
    context.push(
      AppRoutes.withdraw,
      extra: WithdrawPrefill(
        beneficiaryId: beneficiary.id,
        bankCode: beneficiary.bankCode,
        bankName: beneficiary.bankName,
        accountName: beneficiary.accountName,
        accountNumberMasked: beneficiary.accountNumberMasked,
        currency: beneficiary.currency,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return GestureDetector(
      onTap: () => _openWithdraw(context),
      child: Container(
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
      ),
    );
  }
}
