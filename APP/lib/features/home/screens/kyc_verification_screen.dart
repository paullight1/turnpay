import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
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
  final _idNumberController = TextEditingController();
  final _dateOfBirthController = TextEditingController();
  late Future<KycOverview> _future;
  bool _isSubmitting = false;
  bool _consentAccepted = false;
  bool _typeSelectedByUser = false;
  String _documentType = 'BVN';

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? KycService();
    _future = widget.initialOverview == null
        ? _service.fetchOverview()
        : Future.value(widget.initialOverview);
  }

  @override
  void dispose() {
    _idNumberController.dispose();
    _dateOfBirthController.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() => _future = _service.fetchOverview());
  }

  String _effectiveType(KycOverview overview) {
    if (_typeSelectedByUser) return _documentType;
    final verified = overview.documents
        .where((document) => document.status == 'VERIFIED')
        .map((document) => document.type)
        .toSet();
    if (verified.contains('BVN') && !verified.contains('NIN')) return 'NIN';
    return 'BVN';
  }

  Future<void> _verify(KycOverview overview) async {
    if (_isSubmitting || _tierRank(overview.tier) >= 2) return;
    final documentType = _effectiveType(overview);
    final idNumber = _idNumberController.text.trim();
    final dateOfBirth = _dateOfBirthController.text.trim();
    if (!RegExp(r'^\d{11}$').hasMatch(idNumber)) {
      _showMessage('Enter the 11-digit $documentType number.');
      return;
    }
    final parsedDateOfBirth = DateTime.tryParse(dateOfBirth);
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dateOfBirth) ||
        parsedDateOfBirth == null ||
        parsedDateOfBirth.isAfter(DateTime.now())) {
      _showMessage('Enter a valid date of birth in YYYY-MM-DD format.');
      return;
    }
    if (!_consentAccepted) {
      _showMessage('Confirm consent before verification.');
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final result = await _service.verifyIdentity(
        country: 'NG',
        type: documentType,
        idNumber: idNumber,
        dateOfBirth: dateOfBirth,
        consentAccepted: _consentAccepted,
        idempotencyKey: _attemptIdempotency.keyFor(
          'kyc-ninja|NG|$documentType',
        ),
      );
      _attemptIdempotency.markFinalOutcome();
      if (!mounted) return;
      _showMessage(
        result.status == 'VERIFIED'
            ? 'Identity verified successfully.'
            : 'Identity check submitted. We will refresh the result shortly.',
      );
      setState(() {
        _idNumberController.clear();
        _dateOfBirthController.clear();
        _consentAccepted = false;
        _typeSelectedByUser = false;
        _future = _service.fetchOverview();
      });
    } catch (error) {
      if (!mounted) return;
      _showMessage(authErrorMessage(error, 'Unable to verify identity'));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
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
        child: FutureBuilder<KycOverview>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const _LoadingView();
            }
            if (snapshot.hasError || !snapshot.hasData) {
              return _ErrorView(
                message: authErrorMessage(
                  snapshot.error ?? 'Could not load KYC status',
                  'Could not load KYC status',
                ),
                onRetry: _reload,
              );
            }

            final overview = snapshot.data!;
            final documentType = _effectiveType(overview);
            final tierTwo = _tierRank(overview.tier) >= 2;
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                Text(
                  'Verify your Nigerian identity details. No document upload is required.',
                  style: AppTextStyles.bodyM,
                ),
                const SizedBox(height: AppSpacing.md),
                _StatusPanel(overview: overview),
                if (_showVerificationState(overview)) ...[
                  const SizedBox(height: AppSpacing.md),
                  _VerificationState(overview: overview),
                ],
                if (!tierTwo) ...[
                  const SizedBox(height: AppSpacing.md),
                  _VerificationForm(
                    documentType: documentType,
                    idNumberController: _idNumberController,
                    dateOfBirthController: _dateOfBirthController,
                    consentAccepted: _consentAccepted,
                    isSubmitting: _isSubmitting,
                    onDocumentTypeChanged: (type) {
                      setState(() {
                        _documentType = type;
                        _typeSelectedByUser = true;
                        _idNumberController.clear();
                      });
                    },
                    onConsentChanged: (accepted) {
                      setState(() => _consentAccepted = accepted);
                    },
                    onSubmit: () {
                      Haptics.medium();
                      _verify(overview);
                    },
                  ),
                ],
                const SizedBox(height: AppSpacing.md),
                _HistoryPanel(documents: overview.documents),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _StatusPanel extends StatelessWidget {
  final KycOverview overview;

  const _StatusPanel({required this.overview});

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: _StatusValue(label: 'Country', value: 'Nigeria'),
              ),
              Expanded(
                child: _StatusValue(
                  label: 'Current access',
                  value: overview.displayTier,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.md),
          Text(
            _nextStep(overview),
            style: AppTextStyles.bodyS,
          ),
          if (overview.failureReason.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              overview.failureReason,
              style: AppTextStyles.bodyS.copyWith(color: AppColors.error),
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusValue extends StatelessWidget {
  final String label;
  final String value;

  const _StatusValue({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.caption),
        const SizedBox(height: 4),
        Text(value, style: AppTextStyles.labelM),
      ],
    );
  }
}

class _VerificationState extends StatelessWidget {
  final KycOverview overview;

  const _VerificationState({required this.overview});

  @override
  Widget build(BuildContext context) {
    if (_tierRank(overview.tier) >= 2) {
      return _StatePanel(
        icon: Icons.verified_outlined,
        color: AppColors.success,
        title: 'Identity verification complete',
        message:
            'Your BVN and NIN checks are complete. You do not need to submit anything else here.',
      );
    }
    if (overview.status == 'REVIEW_REQUIRED' || overview.isSubmitted) {
      return _StatePanel(
        icon: Icons.schedule_rounded,
        color: AppColors.warning,
        title: 'Your identity check needs a manual review.',
        message:
            'Retry if any detail was entered incorrectly. Otherwise, we will update this page after review.',
      );
    }
    if (overview.status == 'REJECTED') {
      return _StatePanel(
        icon: Icons.error_outline_rounded,
        color: AppColors.error,
        title: 'We could not match those identity details.',
        message:
            'Check the number, your TRUSTPAY profile name, and date of birth, then try again.',
      );
    }
    return _StatePanel(
      icon: Icons.sync_problem_rounded,
      color: AppColors.error,
      title: 'The identity service could not complete your check.',
      message: 'No verification was completed. Wait a moment and try again.',
    );
  }
}

class _StatePanel extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String message;

  const _StatePanel({
    required this.icon,
    required this.color,
    required this.title,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 22, color: color),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTextStyles.labelM),
                const SizedBox(height: AppSpacing.xs),
                Text(message, style: AppTextStyles.bodyS),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VerificationForm extends StatelessWidget {
  final String documentType;
  final TextEditingController idNumberController;
  final TextEditingController dateOfBirthController;
  final bool consentAccepted;
  final bool isSubmitting;
  final ValueChanged<String> onDocumentTypeChanged;
  final ValueChanged<bool> onConsentChanged;
  final VoidCallback onSubmit;

  const _VerificationForm({
    required this.documentType,
    required this.idNumberController,
    required this.dateOfBirthController,
    required this.consentAccepted,
    required this.isSubmitting,
    required this.onDocumentTypeChanged,
    required this.onConsentChanged,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    const options = [
      _IdentityOption('BVN', 'BVN'),
      _IdentityOption('NIN', 'NIN'),
    ];

    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Verify an identity', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Choose the identity record you want to check.',
            style: AppTextStyles.bodyS,
          ),
          const SizedBox(height: AppSpacing.md),
          Text('Identity type', style: AppTextStyles.labelM),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: options
                .map(
                  (option) => Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(
                        right: option == options.last ? 0 : AppSpacing.sm,
                      ),
                      child: _ChoiceButton(
                        label: option.label,
                        selected: documentType == option.value,
                        enabled: !isSubmitting,
                        onTap: () => onDocumentTypeChanged(option.value),
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: AppSpacing.md),
          Text('$documentType number', style: AppTextStyles.labelM),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: const ValueKey('kyc-identity-number'),
            controller: idNumberController,
            enabled: !isSubmitting,
            obscureText: true,
            enableSuggestions: false,
            autocorrect: false,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(11),
            ],
            decoration: const InputDecoration(hintText: '11 digits'),
          ),
          const SizedBox(height: AppSpacing.md),
          Text('Date of birth', style: AppTextStyles.labelM),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: const ValueKey('kyc-date-of-birth'),
            controller: dateOfBirthController,
            enabled: !isSubmitting,
            keyboardType: TextInputType.datetime,
            textInputAction: TextInputAction.done,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9-]')),
              LengthLimitingTextInputFormatter(10),
            ],
            decoration: const InputDecoration(
              hintText: 'YYYY-MM-DD',
              helperText: 'It must match the identity record.',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Material(
            color: Colors.transparent,
            child: CheckboxListTile(
              value: consentAccepted,
              onChanged: isSubmitting
                  ? null
                  : (value) => onConsentChanged(value ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'I agree that my identity details will be shared securely with Ninja for this verification.',
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: isSubmitting ? null : onSubmit,
              child: isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text('Verify $documentType'),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Your full identity number is never shown in history.',
            style: AppTextStyles.caption,
          ),
        ],
      ),
    );
  }
}

class _HistoryPanel extends StatelessWidget {
  final List<KycDocumentSummary> documents;

  const _HistoryPanel({required this.documents});

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Verification history', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.sm),
          if (documents.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Center(
                child: Column(
                  children: [
                    Icon(
                      Icons.verified_user_outlined,
                      size: 24,
                      color: AppColors.textHint,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text('No identity checks yet.',
                        style: AppTextStyles.labelM),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'Choose BVN or NIN above to begin.',
                      style: AppTextStyles.bodyS,
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            )
          else
            ...documents.map(
              (document) => Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(document.type, style: AppTextStyles.labelM),
                          if (document.updatedAt != null)
                            Text(
                              DateFormat.yMMMd().format(document.updatedAt!),
                              style: AppTextStyles.caption,
                            ),
                        ],
                      ),
                    ),
                    Text(_displayStatus(document.status),
                        style: AppTextStyles.labelS),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ChoiceButton extends StatelessWidget {
  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _ChoiceButton({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: enabled ? onTap : null,
      style: OutlinedButton.styleFrom(
        backgroundColor:
            selected ? AppColors.primary.withValues(alpha: 0.08) : null,
        side: BorderSide(
          color: selected ? AppColors.primary : AppColors.border,
        ),
      ),
      child: Text(label),
    );
  }
}

class _Panel extends StatelessWidget {
  final Widget child;

  const _Panel({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _LoadingView extends StatelessWidget {
  const _LoadingView();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: const [
        LinearProgressIndicator(),
        SizedBox(height: AppSpacing.md),
        Text('Loading verification status…'),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(message, style: AppTextStyles.bodyM),
              const SizedBox(height: AppSpacing.md),
              OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          ),
        ),
      ],
    );
  }
}

class _IdentityOption {
  final String value;
  final String label;

  const _IdentityOption(this.value, this.label);
}

int _tierRank(String tier) {
  final match = RegExp(r'(\d+)').firstMatch(tier);
  return int.tryParse(match?.group(1) ?? '0') ?? 0;
}

bool _showVerificationState(KycOverview overview) {
  return _tierRank(overview.tier) >= 2 ||
      overview.status == 'REVIEW_REQUIRED' ||
      overview.status == 'SUBMITTED' ||
      overview.status == 'PENDING_REVIEW' ||
      overview.status == 'REJECTED' ||
      overview.status == 'FAILED';
}

String _nextStep(KycOverview overview) {
  if (_tierRank(overview.tier) >= 2) {
    return 'Identity verification is complete for transfers and withdrawals.';
  }
  final verified = overview.documents
      .where((document) => document.status == 'VERIFIED')
      .map((document) => document.type)
      .toSet();
  if (verified.contains('BVN')) {
    return 'Verify your NIN to reach Tier 2.';
  }
  if (verified.contains('NIN')) {
    return 'Verify your BVN to reach Tier 2.';
  }
  return 'Start with either one. You will need both BVN and NIN for Tier 2.';
}

String _displayStatus(String status) {
  switch (status) {
    case 'VERIFIED':
      return 'Verified';
    case 'REJECTED':
    case 'FAILED':
      return 'Needs attention';
    case 'SUBMITTED':
    case 'PENDING_REVIEW':
    case 'REVIEW_REQUIRED':
      return 'Under review';
    default:
      return 'Pending';
  }
}
