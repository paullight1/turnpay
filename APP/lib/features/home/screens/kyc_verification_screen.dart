import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../services/api_client.dart';
import '../../../services/auth_service.dart';
import '../../../services/kyc_service.dart';

class KycVerificationScreen extends StatefulWidget {
  final KycOverview? initialOverview;
  final KycService? service;

  const KycVerificationScreen({
    super.key,
    this.initialOverview,
    this.service,
  });

  @override
  State<KycVerificationScreen> createState() => _KycVerificationScreenState();
}

class _KycVerificationScreenState extends State<KycVerificationScreen> {
  late final KycService _service;
  final _attemptIdempotency = MoneyAttemptIdempotency();
  late Future<KycOverview> _future;
  bool _isStarting = false;
  String _country = 'NG';
  String _documentType = 'BVN';

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? KycService();
    _future = widget.initialOverview == null
        ? _service.fetchOverview()
        : Future.value(widget.initialOverview);
  }

  void _reload() {
    setState(() {
      _future = _service.fetchOverview();
    });
  }

  Future<void> _startSmileId(KycOverview overview) async {
    if (_isStarting) return;

    if (overview.isVerified) {
      _reload();
      return;
    }

    setState(() => _isStarting = true);
    try {
      final session = await _service.createSmileSession(
        country: _country,
        type: _documentType,
        idempotencyKey: _attemptIdempotency.keyFor(
          'kyc-smile-id|$_country|$_documentType',
        ),
      );
      _attemptIdempotency.markFinalOutcome();

      if (!mounted) return;

      if (session.canOpen) {
        final opened = await launchUrl(
          session.verificationUri!,
          mode: LaunchMode.platformDefault,
          webOnlyWindowName: '_blank',
        );
        if (!opened) {
          throw StateError('Could not open Smile ID verification.');
        }
        _showMessage('Smile ID opened. Return here when you finish.');
        _reload();
        return;
      }

      if (session.hasSdkToken) {
        await _showSdkTokenNotice();
        _reload();
        return;
      }

      _showMessage(
        'Verification session created, but no Smile ID launch link was returned.',
      );
      _reload();
    } catch (error) {
      if (!mounted) return;
      _showMessage(authErrorMessage(error, 'Unable to start KYC verification'));
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  Future<void> _showSdkTokenNotice() {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _KycIconBadge(
                      icon: Icons.token_rounded,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text(
                        'Smile ID session ready',
                        style: AppTextStyles.headingM,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'The backend returned a provider SDK token. This mobile build '
                  'will need either a Smile ID hosted link from the backend or '
                  'a native SDK bridge to continue inside the app.',
                  style: AppTextStyles.bodyM,
                ),
                const SizedBox(height: AppSpacing.lg),
                ElevatedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Got it'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'KYC verification',
        menuActions: [
          TpPageMenuAction(
            label: 'Refresh',
            icon: Icons.refresh_rounded,
            onTap: _reload,
          ),
          TpPageMenuAction(
            label: 'Home',
            icon: Icons.home_rounded,
            onTap: () => context.go(AppRoutes.home),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async {
          _reload();
          await _future;
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            Text(
              'Verify once with Smile ID to unlock higher limits, '
              'withdrawals, transfers, and virtual account access.',
              style: AppTextStyles.bodyM,
            ),
            const SizedBox(height: AppSpacing.xl),
            FutureBuilder<KycOverview>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const _KycLoadingView();
                }

                if (snapshot.hasError || !snapshot.hasData) {
                  return _KycErrorView(
                    message: authErrorMessage(
                      snapshot.error ?? 'Could not load KYC status',
                      'Could not load KYC status',
                    ),
                    onRetry: _reload,
                  );
                }

                return _KycContent(
                  overview: snapshot.data!,
                  country: _country,
                  documentType: _documentType,
                  isStarting: _isStarting,
                  onCountryChanged: (country) {
                    setState(() {
                      _country = country;
                      _documentType = country == 'GH' ? 'GHANA_CARD' : 'BVN';
                    });
                  },
                  onDocumentTypeChanged: (type) {
                    setState(() => _documentType = type);
                  },
                  onStart: () => _startSmileId(snapshot.data!),
                  onRefresh: _reload,
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _KycContent extends StatelessWidget {
  final KycOverview overview;
  final String country;
  final String documentType;
  final bool isStarting;
  final ValueChanged<String> onCountryChanged;
  final ValueChanged<String> onDocumentTypeChanged;
  final VoidCallback onStart;
  final VoidCallback onRefresh;

  const _KycContent({
    required this.overview,
    required this.country,
    required this.documentType,
    required this.isStarting,
    required this.onCountryChanged,
    required this.onDocumentTypeChanged,
    required this.onStart,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _StatusHeroCard(
          overview: overview,
          isStarting: isStarting,
          onStart: onStart,
        ),
        const SizedBox(height: AppSpacing.md),
        _VerificationChoiceCard(
          country: country,
          documentType: documentType,
          enabled: !isStarting && !overview.isVerified,
          onCountryChanged: onCountryChanged,
          onDocumentTypeChanged: onDocumentTypeChanged,
        ),
        const SizedBox(height: AppSpacing.md),
        const _RequiredChecksCard(),
        const SizedBox(height: AppSpacing.md),
        const _UnlocksCard(),
        const SizedBox(height: AppSpacing.md),
        _DocumentsCard(documents: overview.documents, onRefresh: onRefresh),
        const SizedBox(height: AppSpacing.md),
        const _PrivacyCard(),
      ],
    );
  }
}

class _StatusHeroCard extends StatelessWidget {
  final KycOverview overview;
  final bool isStarting;
  final VoidCallback onStart;

  const _StatusHeroCard({
    required this.overview,
    required this.isStarting,
    required this.onStart,
  });

  @override
  Widget build(BuildContext context) {
    final tone = _toneForStatus(overview.status);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.primaryDark,
            AppColors.primary,
            AppColors.primaryLight,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.24),
            blurRadius: 24,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.20),
                  ),
                ),
                child: Icon(tone.icon, color: Colors.white, size: 28),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      overview.displayStatus,
                      style: AppTextStyles.headingL.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Powered by ${overview.provider}',
                      style: AppTextStyles.bodyM.copyWith(
                        color: Colors.white.withValues(alpha: 0.84),
                      ),
                    ),
                  ],
                ),
              ),
              _TierPill(label: overview.displayTier),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            _statusCopy(overview),
            style: AppTextStyles.bodyM.copyWith(
              color: Colors.white.withValues(alpha: 0.88),
            ),
          ),
          if (overview.failureReason.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _InlineNotice(
              icon: Icons.info_outline_rounded,
              message: overview.failureReason,
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: isStarting
                      ? null
                      : () {
                          Haptics.medium();
                          onStart();
                        },
                  icon: isStarting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          overview.isVerified
                              ? Icons.refresh_rounded
                              : Icons.verified_user_rounded,
                        ),
                  label: Text(
                    isStarting
                        ? 'Preparing Smile ID'
                        : overview.primaryActionLabel,
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.primary,
                    disabledBackgroundColor:
                        Colors.white.withValues(alpha: 0.52),
                    disabledForegroundColor:
                        AppColors.primary.withValues(alpha: 0.72),
                  ),
                ),
              ),
            ],
          ),
          if (overview.reference.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              'Reference ${_maskReference(overview.reference)}',
              style: AppTextStyles.caption.copyWith(
                color: Colors.white.withValues(alpha: 0.72),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _VerificationChoiceCard extends StatelessWidget {
  final String country;
  final String documentType;
  final bool enabled;
  final ValueChanged<String> onCountryChanged;
  final ValueChanged<String> onDocumentTypeChanged;

  const _VerificationChoiceCard({
    required this.country,
    required this.documentType,
    required this.enabled,
    required this.onCountryChanged,
    required this.onDocumentTypeChanged,
  });

  @override
  Widget build(BuildContext context) {
    final documentOptions = country == 'GH'
        ? const [
            _KycOption('GHANA_CARD', 'Ghana Card'),
            _KycOption('PASSPORT', 'Passport'),
          ]
        : const [
            _KycOption('BVN', 'BVN'),
            _KycOption('NIN', 'NIN'),
          ];

    return _KycPanel(
      title: 'Verification country',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _ChoiceChipButton(
                  label: 'Nigeria',
                  selected: country == 'NG',
                  enabled: enabled,
                  onTap: () => onCountryChanged('NG'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: _ChoiceChipButton(
                  label: 'Ghana',
                  selected: country == 'GH',
                  enabled: enabled,
                  onTap: () => onCountryChanged('GH'),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text('Identity document', style: AppTextStyles.labelM),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: documentOptions.map((option) {
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                    right: option == documentOptions.last ? 0 : AppSpacing.sm,
                  ),
                  child: _ChoiceChipButton(
                    label: option.label,
                    selected: documentType == option.value,
                    enabled: enabled,
                    onTap: () => onDocumentTypeChanged(option.value),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _KycOption {
  final String value;
  final String label;

  const _KycOption(this.value, this.label);
}

class _ChoiceChipButton extends StatelessWidget {
  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _ChoiceChipButton({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: enabled ? onTap : null,
        child: Ink(
          height: 48,
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primary.withValues(alpha: 0.10)
                : AppColors.inputFill,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: AppTextStyles.labelM.copyWith(
                color: selected ? AppColors.primary : AppColors.textPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RequiredChecksCard extends StatelessWidget {
  const _RequiredChecksCard();

  @override
  Widget build(BuildContext context) {
    return const _KycPanel(
      title: 'What Smile ID checks',
      child: Column(
        children: [
          _CheckRow(
            icon: Icons.badge_outlined,
            title: 'Government ID',
            detail: 'BVN, NIN, passport, or Ghana Card where supported.',
          ),
          _CheckRow(
            icon: Icons.face_retouching_natural_rounded,
            title: 'Selfie and liveness',
            detail: 'Confirms a real person is completing the check.',
          ),
          _CheckRow(
            icon: Icons.manage_search_rounded,
            title: 'Name and document match',
            detail: 'Compares the identity result with your TRUSTPAY profile.',
          ),
          _CheckRow(
            icon: Icons.rule_rounded,
            title: 'Risk review',
            detail: 'Some results may go to manual review before approval.',
          ),
        ],
      ),
    );
  }
}

class _UnlocksCard extends StatelessWidget {
  const _UnlocksCard();

  @override
  Widget build(BuildContext context) {
    final items = [
      const _UnlockItem(Icons.near_me_rounded, 'Send money'),
      const _UnlockItem(Icons.account_balance_rounded, 'Virtual accounts'),
      const _UnlockItem(Icons.south_west_rounded, 'Withdrawals'),
      const _UnlockItem(Icons.trending_up_rounded, 'Higher limits'),
    ];

    return _KycPanel(
      title: 'Access after Tier 2',
      child: GridView.builder(
        itemCount: items.length,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisExtent: 72,
          crossAxisSpacing: AppSpacing.sm,
          mainAxisSpacing: AppSpacing.sm,
        ),
        itemBuilder: (context, index) {
          final item = items[index];
          return Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: AppColors.inputFill,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                _KycIconBadge(icon: item.icon, color: AppColors.primary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    item.label,
                    style: AppTextStyles.labelS.copyWith(
                      color: AppColors.textPrimary,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _DocumentsCard extends StatelessWidget {
  final List<KycDocumentSummary> documents;
  final VoidCallback onRefresh;

  const _DocumentsCard({
    required this.documents,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return _KycPanel(
      title: 'Verification history',
      trailing: IconButton(
        tooltip: 'Refresh',
        onPressed: onRefresh,
        icon: Icon(Icons.refresh_rounded, color: AppColors.textSecondary),
      ),
      child: documents.isEmpty
          ? Row(
              children: [
                _KycIconBadge(
                  icon: Icons.history_rounded,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'No submitted identity checks yet.',
                    style: AppTextStyles.bodyM,
                  ),
                ),
              ],
            )
          : Column(
              children: documents.map((document) {
                final tone = _toneForStatus(document.status);
                return Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: Row(
                    children: [
                      _KycIconBadge(icon: tone.icon, color: tone.color),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _titleCase(document.type),
                              style: AppTextStyles.labelM,
                            ),
                            Text(
                              document.updatedAt == null
                                  ? _titleCase(document.status)
                                  : '${_titleCase(document.status)}. ${_formatDate(document.updatedAt!)}',
                              style: AppTextStyles.bodyS,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }
}

class _PrivacyCard extends StatelessWidget {
  const _PrivacyCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.lock_outline_rounded, color: AppColors.primary, size: 22),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              'TRUSTPAY never displays full ID numbers on this device. '
              'Provider tokens and KYC payloads stay behind the secure API.',
              style: AppTextStyles.bodyS.copyWith(color: AppColors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}

class _KycLoadingView extends StatelessWidget {
  const _KycLoadingView();

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        _SkeletonBlock(height: 228),
        SizedBox(height: AppSpacing.md),
        _SkeletonBlock(height: 196),
        SizedBox(height: AppSpacing.md),
        _SkeletonBlock(height: 132),
      ],
    );
  }
}

class _KycErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _KycErrorView({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return _KycPanel(
      title: 'Could not load KYC',
      child: Column(
        children: [
          TpIllustration(
            variant: TpIllustrationVariant.connectionLost,
            size: 140,
            semanticLabel: 'Could not load KYC',
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            message,
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.lg),
          ElevatedButton.icon(
            onPressed: () {
              Haptics.selection();
              onRetry();
            },
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _KycPanel extends StatelessWidget {
  final String title;
  final Widget child;
  final Widget? trailing;

  const _KycPanel({
    required this.title,
    required this.child,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(title, style: AppTextStyles.headingM)),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          child,
        ],
      ),
    );
  }
}

class _CheckRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String detail;

  const _CheckRow({
    required this.icon,
    required this.title,
    required this.detail,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _KycIconBadge(icon: icon, color: AppColors.primary),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTextStyles.labelM),
                const SizedBox(height: 2),
                Text(detail, style: AppTextStyles.bodyS),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _KycIconBadge extends StatelessWidget {
  final IconData icon;
  final Color color;

  const _KycIconBadge({
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Icon(icon, color: color, size: 22),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  final IconData icon;
  final String message;

  const _InlineNotice({
    required this.icon,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white, size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTextStyles.bodyS.copyWith(color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}

class _TierPill extends StatelessWidget {
  final String label;

  const _TierPill({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: Colors.white.withValues(alpha: 0.20)),
      ),
      child: Text(
        label,
        style: AppTextStyles.labelS.copyWith(color: Colors.white),
      ),
    );
  }
}

class _SkeletonBlock extends StatelessWidget {
  final double height;

  const _SkeletonBlock({required this.height});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Center(
        child: CircularProgressIndicator(
          color: AppColors.primary,
          strokeWidth: 2,
        ),
      ),
    );
  }
}

class _StatusTone {
  final IconData icon;
  final Color color;

  const _StatusTone({
    required this.icon,
    required this.color,
  });
}

class _UnlockItem {
  final IconData icon;
  final String label;

  const _UnlockItem(this.icon, this.label);
}

_StatusTone _toneForStatus(String status) {
  switch (status.toUpperCase()) {
    case 'VERIFIED':
      return _StatusTone(
        icon: Icons.verified_user_rounded,
        color: AppColors.success,
      );
    case 'REJECTED':
    case 'FAILED':
      return _StatusTone(
        icon: Icons.error_outline_rounded,
        color: AppColors.error,
      );
    case 'SUBMITTED':
    case 'PENDING_REVIEW':
    case 'REVIEW_REQUIRED':
      return _StatusTone(
        icon: Icons.hourglass_top_rounded,
        color: AppColors.warning,
      );
    default:
      return _StatusTone(
        icon: Icons.verified_user_outlined,
        color: AppColors.warning,
      );
  }
}

String _statusCopy(KycOverview overview) {
  if (overview.isVerified) {
    return 'Your identity is verified. Tier 2 money movement features can now '
        'be enabled by TRUSTPAY risk controls.';
  }

  if (overview.isRejected) {
    return 'Smile ID could not complete the last check. You can try again with '
        'clearer details or wait for manual review if required.';
  }

  if (overview.isSubmitted) {
    return 'Your check is in progress. Most results update automatically after '
        'Smile ID sends the verification result.';
  }

  return 'Start a secure Smile ID check. You will need your identity document '
      'and a clear selfie for liveness.';
}

String _maskReference(String value) {
  final trimmed = value.trim();
  if (trimmed.length <= 10) return trimmed;
  return '${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)}';
}

String _formatDate(DateTime date) {
  return DateFormat('MMM d, y').format(date.toLocal());
}

String _titleCase(String value) {
  final normalized = value.replaceAll('_', ' ').toLowerCase();
  return normalized
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}
