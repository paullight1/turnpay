import 'dart:async';

import 'package:flutter/cupertino.dart';
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
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  late Future<KycOverview> _future;
  bool _isSubmitting = false;
  bool _consentAccepted = false;
  int _stepIndex = 0;
  bool _showHistory = false;
  bool _namePrefilled = false;
  Timer? _statusTimer;
  int _statusGeneration = 0;

  Future<KycOverview> _loadStatus([KycOverview? initial]) async {
    final generation = ++_statusGeneration;
    _statusTimer?.cancel();
    final overview = initial ?? await _service.fetchOverview();
    if (mounted && generation == _statusGeneration && overview.isSubmitted) {
      _scheduleStatusCheck(generation);
    }
    return overview;
  }

  void _scheduleStatusCheck(int generation) {
    _statusTimer = Timer(const Duration(seconds: 15), () async {
      try {
        final overview = await _service.fetchOverview();
        if (!mounted || generation != _statusGeneration) return;
        setState(() {
          _future = Future.value(overview);
        });
        if (overview.isSubmitted) _scheduleStatusCheck(generation);
      } catch (_) {
        // Preserve the pending result if a status refresh loses connectivity.
        if (mounted && generation == _statusGeneration) {
          _scheduleStatusCheck(generation);
        }
      }
    });
  }

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? KycService();
    _future = _loadStatus(widget.initialOverview);
  }

  @override
  void dispose() {
    _statusTimer?.cancel();
    _idNumberController.dispose();
    _dateOfBirthController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _future = _loadStatus();
    });
  }

  String _effectiveType(KycOverview overview) {
    final verified = overview.documents
        .where((document) => document.status == 'VERIFIED')
        .map((document) => document.type)
        .toSet();
    if (verified.contains('NIN')) return 'BVN';
    return 'NIN';
  }

  Future<void> _verify(KycOverview overview) async {
    if (_isSubmitting ||
        overview.isSubmitted ||
        _tierRank(overview.tier) >= 2) {
      return;
    }
    final documentType = _effectiveType(overview);
    final idNumber = _idNumberController.text.trim();
    final dateOfBirth = _dateOfBirthController.text.trim();
    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();
    if (firstName.isEmpty || lastName.isEmpty) {
      _showMessage('Enter your legal first and last name.');
      return;
    }
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
        firstName: firstName,
        lastName: lastName,
        idempotencyKey: _attemptIdempotency.keyFor(
          'kyc-ninja|NG|$documentType',
        ),
      );
      _attemptIdempotency.markFinalOutcome();
      if (!mounted) return;
      _showMessage(
        result.status == 'VERIFIED'
            ? 'Identity verified successfully.'
            : result.status == 'REJECTED'
                ? 'Identity check not approved. Please review your details.'
                : result.status == 'FAILED'
                    ? 'The check could not be completed. Please try again.'
                    : 'Identity check submitted. Waiting for a decision.',
      );
      setState(() {
        _idNumberController.clear();
        _dateOfBirthController.clear();
        _consentAccepted = false;
        _stepIndex = 0;
        _future = _loadStatus();
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

  void _continueToNextStep(KycOverview overview) {
    final documentType = _effectiveType(overview);
    if (_stepIndex == 0 &&
        (_firstNameController.text.trim().isEmpty ||
            _lastNameController.text.trim().isEmpty)) {
      _showMessage('Enter your legal first and last name.');
      return;
    }
    if (_stepIndex == 2 &&
        !RegExp(r'^\d{11}$').hasMatch(_idNumberController.text.trim())) {
      _showMessage('Enter the 11-digit $documentType number.');
      return;
    }
    if (_stepIndex == 3) {
      final value = _dateOfBirthController.text.trim();
      final parsed = DateTime.tryParse(value);
      if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ||
          parsed == null ||
          parsed.isAfter(DateTime.now())) {
        _showMessage('Enter a valid date of birth in YYYY-MM-DD format.');
        return;
      }
    }
    if (_stepIndex < 4) {
      setState(() => _stepIndex += 1);
    } else {
      _verify(overview);
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
            if (!_namePrefilled) {
              _namePrefilled = true;
              if (_firstNameController.text.isEmpty &&
                  overview.firstName != null) {
                _firstNameController.text = overview.firstName!;
              }
              if (_lastNameController.text.isEmpty &&
                  overview.lastName != null) {
                _lastNameController.text = overview.lastName!;
              }
            }
            final documentType = _effectiveType(overview);
            final tierTwo = _tierRank(overview.tier) >= 2;
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                Text(
                  'Two quick checks: NIN first, then BVN. No document upload is required.',
                  style: AppTextStyles.bodyM,
                ),
                const SizedBox(height: AppSpacing.md),
                _KycTierProgress(currentTier: overview.tier),
                if (_showVerificationState(overview)) ...[
                  const SizedBox(height: AppSpacing.md),
                  _VerificationState(overview: overview),
                ],
                if (overview.isSubmitted) ...[
                  const SizedBox(height: AppSpacing.md),
                  OutlinedButton.icon(
                    onPressed: _reload,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Check status'),
                  ),
                ],
                if (!tierTwo && !overview.isSubmitted) ...[
                  const SizedBox(height: AppSpacing.md),
                  _KycProgressIndicator(currentStep: _stepIndex),
                  const SizedBox(height: AppSpacing.sm),
                  _VerificationForm(
                    stepIndex: _stepIndex,
                    firstNameController: _firstNameController,
                    lastNameController: _lastNameController,
                    documentType: documentType,
                    idNumberController: _idNumberController,
                    dateOfBirthController: _dateOfBirthController,
                    consentAccepted: _consentAccepted,
                    isSubmitting: _isSubmitting,
                    onConsentChanged: (accepted) {
                      setState(() => _consentAccepted = accepted);
                    },
                    onDateSelected: (date) {
                      setState(() {
                        _dateOfBirthController.text =
                            DateFormat('yyyy-MM-dd').format(date);
                      });
                    },
                    onBack: () => setState(() => _stepIndex -= 1),
                    onNext: () => _continueToNextStep(overview),
                    onSubmit: () {
                      Haptics.medium();
                      _continueToNextStep(overview);
                    },
                  ),
                ],
                if (overview.isSubmitted || overview.documents.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  OutlinedButton.icon(
                    onPressed: () =>
                        setState(() => _showHistory = !_showHistory),
                    icon: Icon(_showHistory
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.history_rounded),
                    label: Text(_showHistory
                        ? 'Hide verification history'
                        : 'View verification history'),
                  ),
                  if (_showHistory) ...[
                    const SizedBox(height: AppSpacing.sm),
                    _HistoryPanel(documents: overview.documents),
                  ],
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _KycTierProgress extends StatelessWidget {
  final String currentTier;

  const _KycTierProgress({required this.currentTier});

  @override
  Widget build(BuildContext context) {
    final rank = _tierRank(currentTier);
    return _Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
              child:
                  Text('Identity verification', style: AppTextStyles.labelM)),
          Text(rank >= 2 ? 'Complete' : 'Step ${rank == 0 ? 1 : 2} of 2',
              style: AppTextStyles.caption),
        ]),
        const SizedBox(height: AppSpacing.sm),
        Row(children: [
          Expanded(
              child: _TierItem(
                  label: '1  NIN', detail: 'First check', complete: rank >= 1)),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
              child: _TierItem(
                  label: '2  BVN', detail: 'Final check', complete: rank >= 2)),
        ]),
        if (rank == 0 || rank == 1) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(
            rank == 0
                ? 'Start with your NIN. We will request your BVN next.'
                : 'NIN verified. Verify your BVN to finish.',
            style: AppTextStyles.caption,
          ),
        ],
      ]),
    );
  }
}

class _TierItem extends StatelessWidget {
  final String label;
  final String detail;
  final bool complete;
  const _TierItem(
      {required this.label, required this.detail, required this.complete});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: complete
              ? AppColors.primary.withValues(alpha: .12)
              : AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(
              color: complete ? AppColors.primary : AppColors.border),
        ),
        child: Row(children: [
          Icon(
              complete
                  ? Icons.check_circle_rounded
                  : Icons.lock_outline_rounded,
              size: 18,
              color: complete ? AppColors.primary : AppColors.textSecondary),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(label, style: AppTextStyles.labelS),
                Text(detail, style: AppTextStyles.caption)
              ])),
        ]),
      );
}

class _VerificationState extends StatelessWidget {
  final KycOverview overview;

  const _VerificationState({required this.overview});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
        title: 'Waiting for approval',
        message:
            'Your details are being reviewed. This page checks for updates automatically. You can leave and return later.',
      );
    }
    if (overview.isVerified) {
      return _StatePanel(
        icon: Icons.verified_outlined,
        color: AppColors.success,
        title: 'Identity check approved',
        message:
            'Complete your remaining identity check to finish verification.',
      );
    }
    if (overview.status == 'REJECTED') {
      return _StatePanel(
        icon: Icons.error_outline_rounded,
        color: AppColors.error,
        title: 'Identity check not approved',
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
    AppColors.watch(context);
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
  final int stepIndex;
  final String documentType;
  final TextEditingController idNumberController;
  final TextEditingController dateOfBirthController;
  final TextEditingController firstNameController;
  final TextEditingController lastNameController;
  final bool consentAccepted;
  final bool isSubmitting;
  final ValueChanged<bool> onConsentChanged;
  final ValueChanged<DateTime> onDateSelected;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final VoidCallback onSubmit;

  const _VerificationForm({
    required this.stepIndex,
    required this.documentType,
    required this.idNumberController,
    required this.dateOfBirthController,
    required this.firstNameController,
    required this.lastNameController,
    required this.consentAccepted,
    required this.isSubmitting,
    required this.onConsentChanged,
    required this.onDateSelected,
    required this.onBack,
    required this.onNext,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final titles = [
      'Confirm your legal name',
      'Your first identity check',
      'Enter your $documentType number',
      'Confirm your date of birth',
      'Review and consent',
    ];
    final descriptions = [
      'Use the name shown on your identity record.',
      documentType == 'NIN'
          ? 'Step 1 of 2. We start with your NIN.'
          : 'Step 2 of 2. Your NIN is verified; now verify your BVN.',
      'Use the 11-digit number linked to your profile.',
      'This must match the identity record exactly.',
      'Your details are shared securely with Ninja for this check.',
    ];

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      child: _Panel(
        key: ValueKey(stepIndex),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titles[stepIndex], style: AppTextStyles.headingM),
            const SizedBox(height: AppSpacing.xs),
            Text(descriptions[stepIndex], style: AppTextStyles.bodyS),
            const SizedBox(height: AppSpacing.lg),
            if (stepIndex == 0) ...[
              Text('Legal name', style: AppTextStyles.labelM),
              const SizedBox(height: AppSpacing.sm),
              Row(children: [
                Expanded(
                    child: TextField(
                        controller: firstNameController,
                        enabled: !isSubmitting,
                        textInputAction: TextInputAction.next,
                        decoration:
                            const InputDecoration(hintText: 'First name'))),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                    child: TextField(
                        controller: lastNameController,
                        enabled: !isSubmitting,
                        textInputAction: TextInputAction.next,
                        decoration:
                            const InputDecoration(hintText: 'Last name'))),
              ]),
            ] else if (stepIndex == 1) ...[
              _Panel(
                child: Row(
                  children: [
                    Icon(Icons.verified_user_outlined,
                        color: AppColors.primary),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        documentType == 'NIN'
                            ? 'Step 1 of 2  ·  Verify NIN'
                            : 'Step 2 of 2  ·  Verify BVN',
                        style: AppTextStyles.labelM,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                documentType == 'NIN'
                    ? 'After this check, we will ask for your BVN.'
                    : 'This is the final identity check for your account.',
                style: AppTextStyles.bodyS,
              ),
            ] else if (stepIndex == 2) ...[
              Text('$documentType number', style: AppTextStyles.labelM),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                key: const ValueKey('kyc-identity-number'),
                controller: idNumberController,
                enabled: !isSubmitting,
                obscureText: documentType != 'NIN',
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
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Your full identity number is never shown in history.',
                style: AppTextStyles.caption,
              ),
            ] else if (stepIndex == 3) ...[
              Text('Date of birth', style: AppTextStyles.labelM),
              const SizedBox(height: AppSpacing.sm),
              _DateOfBirthPickerField(
                controller: dateOfBirthController,
                enabled: !isSubmitting,
                onDateSelected: onDateSelected,
              ),
            ] else ...[
              _ReviewRow(
                  label: 'Legal name',
                  value:
                      '${firstNameController.text.trim()} ${lastNameController.text.trim()}'
                          .trim()),
              const SizedBox(height: AppSpacing.sm),
              _ReviewRow(label: 'Identity type', value: documentType),
              const SizedBox(height: AppSpacing.sm),
              _ReviewRow(
                label: 'Identity number',
                value: '11-digit $documentType securely entered',
              ),
              const SizedBox(height: AppSpacing.sm),
              _ReviewRow(
                label: 'Date of birth',
                value: dateOfBirthController.text,
              ),
              const SizedBox(height: AppSpacing.md),
              Material(
                color: Colors.transparent,
                child: CheckboxListTile(
                  key: const ValueKey('kyc-consent'),
                  value: consentAccepted,
                  onChanged: isSubmitting
                      ? null
                      : (value) => onConsentChanged(value ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  visualDensity: VisualDensity.compact,
                  title: Text(
                    'I agree to share my identity details securely with Ninja.',
                    style: AppTextStyles.bodyS,
                  ),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                if (stepIndex > 0)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: isSubmitting ? null : onBack,
                      child: const Text('Back'),
                    ),
                  ),
                if (stepIndex > 0) const SizedBox(width: AppSpacing.sm),
                Expanded(
                  flex: stepIndex > 0 ? 2 : 1,
                  child: ElevatedButton(
                    onPressed: isSubmitting
                        ? null
                        : stepIndex == 4
                            ? onSubmit
                            : onNext,
                    child: isSubmitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(stepIndex == 4
                            ? 'Verify $documentType'
                            : 'Continue'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DateOfBirthPickerField extends StatelessWidget {
  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<DateTime> onDateSelected;

  const _DateOfBirthPickerField({
    required this.controller,
    required this.enabled,
    required this.onDateSelected,
  });

  DateTime _initialDate() {
    final parsed = DateTime.tryParse(controller.text.trim());
    if (parsed != null && !parsed.isAfter(DateTime.now())) return parsed;
    return DateTime(1990, 1, 1);
  }

  Future<void> _openPicker(BuildContext context) async {
    if (!enabled) return;
    var selected = _initialDate();
    final picked = await showCupertinoModalPopup<DateTime>(
      context: context,
      builder: (context) {
        return Container(
          height: 340,
          color: AppColors.surface,
          child: SafeArea(
            top: false,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                  child: Row(
                    children: [
                      CupertinoButton(
                        key: const ValueKey('kyc-date-picker-cancel'),
                        padding: EdgeInsets.zero,
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Cancel'),
                      ),
                      const Spacer(),
                      Text('Date of birth', style: AppTextStyles.labelM),
                      const Spacer(),
                      CupertinoButton(
                        key: const ValueKey('kyc-date-picker-done'),
                        padding: EdgeInsets.zero,
                        onPressed: () => Navigator.of(context).pop(selected),
                        child: const Text('Done'),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: CupertinoDatePicker(
                    mode: CupertinoDatePickerMode.date,
                    initialDateTime: selected,
                    minimumDate: DateTime(1900),
                    maximumDate: DateTime.now(),
                    onDateTimeChanged: (value) {
                      selected = value;
                      Haptics.selection();
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (picked != null) onDateSelected(picked);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final value = DateTime.tryParse(controller.text.trim());
    return Semantics(
      button: true,
      enabled: enabled,
      label: value == null
          ? 'Select your date of birth'
          : 'Date of birth ${DateFormat('d MMMM y').format(value)}',
      child: GestureDetector(
        key: const ValueKey('kyc-date-of-birth-picker'),
        onTap: enabled ? () => _openPicker(context) : null,
        child: InputDecorator(
          decoration: const InputDecoration(
            hintText: 'Select your date of birth',
            suffixIcon: Icon(Icons.calendar_today_rounded),
          ),
          child: Text(
            value == null ? 'Select your date of birth' : controller.text,
            style: value == null
                ? AppTextStyles.bodyM.copyWith(color: AppColors.textHint)
                : AppTextStyles.bodyM,
          ),
        ),
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  final String label;
  final String value;

  const _ReviewRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label, style: AppTextStyles.caption)),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: AppTextStyles.labelS,
          ),
        ),
      ],
    );
  }
}

class _KycProgressIndicator extends StatelessWidget {
  final int currentStep;

  const _KycProgressIndicator({required this.currentStep});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      children: List.generate(4, (index) {
        final active = index <= currentStep;
        return Expanded(
          child: Container(
            height: 4,
            margin: EdgeInsets.only(right: index == 3 ? 0 : AppSpacing.xs),
            decoration: BoxDecoration(
              color: active ? AppColors.primary : AppColors.border,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
          ),
        );
      }),
    );
  }
}

class _HistoryPanel extends StatelessWidget {
  final List<KycDocumentSummary> documents;

  const _HistoryPanel({required this.documents});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
                    Text('No verification submissions yet.',
                        style: AppTextStyles.labelM),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'Your verification history will appear after you submit a check.',
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

class _Panel extends StatelessWidget {
  final Widget child;

  const _Panel({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
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
    AppColors.watch(context);
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
    AppColors.watch(context);
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

int _tierRank(String tier) {
  final match = RegExp(r'(\d+)').firstMatch(tier);
  return int.tryParse(match?.group(1) ?? '0') ?? 0;
}

bool _showVerificationState(KycOverview overview) {
  return overview.isVerified ||
      _tierRank(overview.tier) >= 2 ||
      overview.status == 'REVIEW_REQUIRED' ||
      overview.status == 'SUBMITTED' ||
      overview.status == 'PENDING_REVIEW' ||
      overview.status == 'REJECTED' ||
      overview.status == 'FAILED';
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
