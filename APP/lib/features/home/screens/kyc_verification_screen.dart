import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../services/api_client.dart';
import '../../../services/auth_service.dart';
import '../../../services/kyc_service.dart';
import '../widgets/kyc_status_presenter.dart';
import '../widgets/kyc_status_widgets.dart';
import '../widgets/kyc_evidence_preview.dart';

const double _kycInputMinHeight = 64;

TextStyle _kycInputTextStyle() => AppTextStyles.bodyL.copyWith(
      color: AppColors.textPrimary,
      fontWeight: FontWeight.w700,
    );

InputDecoration _kycInputDecoration({
  required String labelText,
  String? hintText,
  String? helperText,
  int? helperMaxLines,
  Widget? prefixIcon,
  Widget? suffixIcon,
}) {
  final labelStyle = AppTextStyles.labelM.copyWith(
    color: AppColors.textSecondary,
    fontWeight: FontWeight.w700,
  );
  return InputDecoration(
    labelText: labelText,
    hintText: hintText,
    helperText: helperText,
    helperMaxLines: helperMaxLines,
    prefixIcon: prefixIcon,
    suffixIcon: suffixIcon,
    // Keep the field's purpose visible even after a value is entered. This is
    // especially useful when users review a long, scrollable KYC step.
    floatingLabelBehavior: FloatingLabelBehavior.always,
    constraints: const BoxConstraints(minHeight: _kycInputMinHeight),
    labelStyle: labelStyle,
    floatingLabelStyle: labelStyle.copyWith(color: AppColors.primary),
    helperStyle: AppTextStyles.bodyS,
  );
}

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
  late final ManualNinSubmission _manualNinSubmission;
  final _attemptIdempotency = MoneyAttemptIdempotency();
  final _profileIdempotency = MoneyAttemptIdempotency();
  final _idNumberController = TextEditingController();
  final _dateOfBirthController = TextEditingController();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _phoneController = TextEditingController();
  String? _detailsError;
  bool _detailsRequireSupport = false;
  bool _profileDetailsConfirmed = false;
  final _bankCodeController = TextEditingController();
  final _accountNumberController = TextEditingController();
  late Future<KycOverview> _future;
  bool _isSubmitting = false;
  bool _isManualNinSubmitting = false;
  bool _consentAccepted = false;
  bool _accountSetupConsent = false;
  int _stepIndex = 0;
  String _bankName = '';
  bool _namePrefilled = false;
  Timer? _statusTimer;
  int _statusGeneration = 0;
  KycOverview? _lastOverview;
  final _locallyAccepted = <String>{};

  Future<KycOverview> _loadStatus([KycOverview? initial]) async {
    final generation = ++_statusGeneration;
    _statusTimer?.cancel();
    final raw =
        initial ?? await _service.fetchOverview(includeIdentityProfile: true);
    final overview = generation == _statusGeneration
        ? _rememberOverview(raw, acknowledge: initial == null)
        : raw;
    if (mounted &&
        generation == _statusGeneration &&
        _needsStatusPolling(overview)) {
      _scheduleStatusCheck(generation);
    }
    return overview;
  }

  KycOverview _rememberOverview(KycOverview incoming,
      {bool acknowledge = true}) {
    if (acknowledge) {
      _locallyAccepted.removeWhere((type) {
        final state = kycCheckStatus(incoming, type);
        final legacy =
            type == 'BVN' && state == 'VERIFIED' && !kycPaystackReady(incoming);
        return state != 'INCOMPLETE' && !legacy;
      });
    }
    final previous = _lastOverview;
    final updated = previous == null
        ? incoming
        : kycReconcileOverview(previous, incoming,
            locallyAccepted: _locallyAccepted);
    _lastOverview = updated;
    return updated;
  }

  KycOverview _submissionOverview(KycOverview previous, KycOverview? fresh,
      KycVerificationResult result, String type) {
    final state = fresh == null ? 'INCOMPLETE' : kycCheckStatus(fresh, type);
    final legacy = fresh != null &&
        type == 'BVN' &&
        state == 'VERIFIED' &&
        !kycPaystackReady(fresh);
    if (fresh != null && state != 'INCOMPLETE' && !legacy) {
      return _rememberOverview(fresh);
    }
    if (result.status == 'VERIFIED' || kycCheckPending(result.status)) {
      _locallyAccepted.add(type);
    }
    return _rememberOverview(
        kycOverviewAfterSubmission(fresh ?? previous, result, type),
        acknowledge: false);
  }

  void _scheduleStatusCheck(int generation) {
    _statusTimer = Timer(const Duration(seconds: 15), () async {
      try {
        final raw = await _service.fetchOverview(includeIdentityProfile: true);
        if (!mounted || generation != _statusGeneration) return;
        final overview = _rememberOverview(raw);
        setState(() {
          _future = Future.value(overview);
        });
        if (_needsStatusPolling(overview)) {
          _scheduleStatusCheck(generation);
        }
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
    _manualNinSubmission = ManualNinSubmission(service: _service);
    _future = _loadStatus(widget.initialOverview);
  }

  @override
  void dispose() {
    _statusTimer?.cancel();
    _idNumberController.dispose();
    _dateOfBirthController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    _bankCodeController.dispose();
    _accountNumberController.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _future = _loadStatus();
    });
  }

  void _prefetchBankOptions() {
    // Warm the service cache while the first step is on screen. The picker
    // deliberately calls the service again when it mounts, so a failed or
    // empty warm-up can never poison its retry path.
    unawaited(_service.fetchBanks().catchError((Object _) {
      return const <KycBankOption>[];
    }));
  }

  String? _manualDocumentContentType(PlatformFile file) {
    switch (file.extension?.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'pdf':
        return 'application/pdf';
      default:
        return null;
    }
  }

  Future<void> _openNinUpgrade(KycOverview overview) async {
    if (!kycCanStartNin(overview) || _isSubmitting) return;
    if (!overview.ninVerificationAvailable) {
      await _openManualNinDialog(overview);
      return;
    }
    final number = TextEditingController();
    final birth = TextEditingController();
    var consent = false;
    var busy = false;
    String? error;
    KycVerificationResult? submitted;
    await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
            builder: (context, update) => PopScope(
                  canPop: !busy,
                  child: AlertDialog(
                    backgroundColor: AppColors.surface,
                    title: Text('Upgrade to Tier 2',
                        style: AppTextStyles.headingM),
                    content: SingleChildScrollView(
                        child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                          Text(
                              'Your Tier 1 account stays active while we check your NIN.',
                              style: AppTextStyles.bodyM),
                          const SizedBox(height: 24),
                          TextField(
                              controller: number,
                              enabled: !busy,
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                                LengthLimitingTextInputFormatter(11)
                              ],
                              decoration: const InputDecoration(
                                  labelText: 'NIN', hintText: '11-digit NIN'),
                              onChanged: (_) => update(() {})),
                          const SizedBox(height: 20),
                          TextField(
                              controller: birth,
                              enabled: !busy,
                              readOnly: true,
                              decoration: const InputDecoration(
                                  labelText: 'Date of birth',
                                  suffixIcon: Icon(
                                      Icons.calendar_today_outlined,
                                      size: 18)),
                              onTap: () async {
                                final picked = await showDatePicker(
                                    context: context,
                                    initialDate: DateTime(1995),
                                    firstDate: DateTime(1900),
                                    lastDate: DateTime.now());
                                if (picked != null && context.mounted) {
                                  update(() => birth.text =
                                      DateFormat('yyyy-MM-dd').format(picked));
                                }
                              }),
                          const SizedBox(height: 20),
                          CheckboxListTile(
                              contentPadding: EdgeInsets.zero,
                              value: consent,
                              controlAffinity: ListTileControlAffinity.leading,
                              onChanged: busy
                                  ? null
                                  : (value) =>
                                      update(() => consent = value == true),
                              title: Text(
                                  'I agree to share my NIN, legal name and date of birth securely with Ninja for verification.',
                                  style: AppTextStyles.bodyS)),
                          if (error != null)
                            Padding(
                                padding: const EdgeInsets.only(top: 12),
                                child: Text(error!,
                                    style: AppTextStyles.bodyS
                                        .copyWith(color: AppColors.error))),
                        ])),
                    actions: [
                      TextButton(
                          onPressed: busy
                              ? null
                              : () => Navigator.of(dialogContext).pop(),
                          child: const Text('Not now')),
                      FilledButton(
                          onPressed: busy ||
                                  !consent ||
                                  number.text.length != 11 ||
                                  birth.text.isEmpty
                              ? null
                              : () async {
                                  update(() {
                                    busy = true;
                                    error = null;
                                  });
                                  try {
                                    final result = await _service.verifyIdentity(
                                        type: 'NIN',
                                        idNumber: number.text,
                                        dateOfBirth: birth.text,
                                        consentAccepted: true,
                                        idempotencyKey:
                                            _attemptIdempotency.keyFor(sha256
                                                .convert(utf8.encode(
                                                    'nin|${number.text}|${birth.text}'))
                                                .toString()));
                                    _attemptIdempotency.markFinalOutcome();
                                    submitted = result;
                                    if (dialogContext.mounted) {
                                      Navigator.of(dialogContext).pop();
                                    }
                                  } catch (failure) {
                                    if (dialogContext.mounted) {
                                      update(() {
                                        busy = false;
                                        error = authErrorMessage(failure,
                                            'Could not complete your NIN check. Try again.');
                                      });
                                    }
                                  }
                                },
                          child: Text(busy ? 'Checking…' : 'Verify NIN')),
                    ],
                  ),
                )));
    number.dispose();
    birth.dispose();
    if (submitted != null && mounted) {
      _reload();
      _showMessage(submitted!.status == 'VERIFIED'
          ? 'NIN verified. Refreshing your account tier.'
          : ['REJECTED', 'FAILED'].contains(submitted!.status)
              ? 'Your NIN check needs attention. View its status to review your details or contact support. Tier 1 stays active.'
              : 'Your NIN check is under review. Tier 1 stays active.');
    }
  }

  Future<void> _openManualNinDialog(KycOverview overview) async {
    if (_isSubmitting ||
        _isManualNinSubmitting ||
        !kycCanStartNin(overview) ||
        _isDocumentPending(_documentStatus(overview, 'NIN')) ||
        _documentStatus(overview, 'NIN') == 'VERIFIED') {
      return;
    }

    _idNumberController.clear();
    PlatformFile? selectedFile;
    var consentAccepted = false;
    final submit = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => Dialog.fullscreen(
        child: StatefulBuilder(
          builder: (pageContext, setDialogState) => Scaffold(
            backgroundColor: AppColors.background,
            resizeToAvoidBottomInset: true,
            appBar: _pageHeader(
              title: 'Submit NIN for review',
              onBack: () => Navigator.of(dialogContext).pop(false),
            ),
            body: SafeArea(
              top: false,
              child: ListView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.lg,
                  AppSpacing.lg,
                  AppSpacing.xl,
                ),
                children: [
                  const _KycPageIntro(
                    eyebrow: 'MANUAL REVIEW',
                    title: 'Submit your NIN evidence',
                    description:
                        'Upload your NIN slip or card. Our team will review your evidence and update your verification status.',
                    icon: Icons.upload_file_rounded,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  _Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('NIN details', style: AppTextStyles.headingM),
                        const SizedBox(height: AppSpacing.sm),
                        TextField(
                          key: const ValueKey('kyc-nin-number'),
                          controller: _idNumberController,
                          enableSuggestions: false,
                          autocorrect: false,
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(11),
                          ],
                          decoration: const InputDecoration(
                            labelText: 'NIN number',
                            hintText: '11 digits',
                          ),
                          onChanged: (_) => setDialogState(() {}),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Text('Identity evidence', style: AppTextStyles.labelM),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Upload a clear JPG, PNG, WEBP, or PDF file. Maximum size: 8 MiB.',
                          style: AppTextStyles.bodyS,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        OutlinedButton.icon(
                          onPressed: () async {
                            final result = await FilePicker.pickFiles(
                              type: FileType.custom,
                              allowedExtensions: const [
                                'jpg',
                                'jpeg',
                                'png',
                                'webp',
                                'pdf',
                              ],
                              allowMultiple: false,
                              withData: true,
                            );
                            if (!pageContext.mounted ||
                                result == null ||
                                result.files.isEmpty) {
                              return;
                            }
                            setDialogState(
                                () => selectedFile = result.files.single);
                          },
                          icon: const Icon(Icons.upload_file_rounded),
                          label: const Text('Upload NIN'),
                        ),
                        if (selectedFile != null) ...[
                          const SizedBox(height: AppSpacing.sm),
                          KycEvidencePreview(
                            key: ObjectKey(selectedFile),
                            file: selectedFile!,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _Panel(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    child: _KycConsentTile(
                      tileKey: const ValueKey('kyc-nin-consent'),
                      value: consentAccepted,
                      enabled: true,
                      title:
                          'I consent to secure storage and manual review of this NIN evidence.',
                      onChanged: (value) =>
                          setDialogState(() => consentAccepted = value),
                    ),
                  ),
                ],
              ),
            ),
            bottomNavigationBar: SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.viewInsetsOf(pageContext).bottom,
                ),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.sm,
                    AppSpacing.lg,
                    AppSpacing.md,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    border: Border(top: BorderSide(color: AppColors.border)),
                  ),
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final cancelButton = OutlinedButton(
                        onPressed: () => Navigator.of(dialogContext).pop(false),
                        child: const Text('Cancel'),
                      );
                      final submitButton = ElevatedButton(
                        onPressed: selectedFile != null &&
                                consentAccepted &&
                                RegExp(r'^\d{11}$')
                                    .hasMatch(_idNumberController.text.trim())
                            ? () => Navigator.of(dialogContext).pop(true)
                            : null,
                        child: const Text('Submit for review'),
                      );
                      final textScale =
                          MediaQuery.textScalerOf(context).scale(18) / 18;
                      if (constraints.maxWidth < 260 * textScale) {
                        return Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            submitButton,
                            const SizedBox(height: AppSpacing.sm),
                            cancelButton,
                          ],
                        );
                      }
                      return Row(
                        children: [
                          Expanded(child: cancelButton),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(flex: 2, child: submitButton),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    if (submit == true && selectedFile != null) {
      await _submitManualNin(selectedFile!, overview);
    }
    if (mounted) _idNumberController.clear();
  }

  Future<void> _submitManualNin(PlatformFile file, KycOverview overview) async {
    final idNumber = _idNumberController.text.trim();
    final bytes = file.bytes;
    final contentType = _manualDocumentContentType(file);
    if (!RegExp(r'^\d{11}$').hasMatch(idNumber)) {
      _showMessage('Enter the 11-digit NIN before submitting.');
      return;
    }
    if (contentType == null || bytes == null || bytes.isEmpty) {
      _showMessage('Choose a readable JPG, PNG, WEBP, or PDF document.');
      return;
    }
    if (bytes.length > 8 * 1024 * 1024) {
      _showMessage('NIN evidence must be 8 MiB or smaller.');
      return;
    }

    setState(() => _isManualNinSubmitting = true);
    try {
      final result = await _manualNinSubmission.submit(
        idNumber: idNumber,
        fileName: file.name,
        contentType: contentType,
        bytes: bytes,
      );
      if (!mounted) return;
      KycOverview? refreshed;
      try {
        refreshed = await _service.fetchOverview(includeIdentityProfile: true);
      } catch (_) {
        // The accepted submission remains visible while the status endpoint recovers.
      }
      if (!mounted) return;
      final updated = _submissionOverview(overview, refreshed, result, 'NIN');
      setState(() {
        _future = _loadStatus(updated);
      });
      await _showSubmissionConfirmation(updated, 'NIN', result);
    } catch (error) {
      if (mounted) {
        _showMessage(
            authErrorMessage(error, 'Could not submit NIN for review'));
      }
    } finally {
      if (mounted) setState(() => _isManualNinSubmitting = false);
    }
  }

  String _effectiveType(KycOverview overview) {
    return 'BVN';
  }

  String? _paystackValidationStatus(KycOverview overview) {
    final explicit = overview.providerValidationStatus?.trim().toUpperCase();
    if (explicit != null && explicit.isNotEmpty) return explicit;
    final hasPaystackBvn = overview.provider.toUpperCase() == 'PAYSTACK' &&
        overview.documents.any(
          (document) =>
              document.type.toUpperCase() == 'BVN' &&
              document.status == 'VERIFIED',
        );
    return hasPaystackBvn ? 'VERIFIED' : null;
  }

  bool _isPaystackValidated(KycOverview overview) {
    return _paystackValidationStatus(overview) == 'VERIFIED';
  }

  bool _isPaystackValidationPending(KycOverview overview) {
    return _paystackValidationStatus(overview) == 'PENDING';
  }

  bool _needsStatusPolling(KycOverview overview) =>
      _isDocumentPending(_documentStatus(overview, 'BVN')) ||
      _isDocumentPending(_documentStatus(overview, 'NIN'));

  String _documentStatus(KycOverview overview, String type) =>
      kycCheckStatus(overview, type);

  Future<KycOverview> _checkStatus(KycOverview previous) async {
    final generation = ++_statusGeneration;
    _statusTimer?.cancel();
    try {
      final raw = await _service.fetchOverview(includeIdentityProfile: true);
      final updated =
          generation == _statusGeneration ? _rememberOverview(raw) : raw;
      if (mounted && generation == _statusGeneration) {
        setState(() {
          _future = Future.value(updated);
        });
        if (_needsStatusPolling(updated)) _scheduleStatusCheck(generation);
      }
      return updated;
    } catch (_) {
      if (mounted &&
          generation == _statusGeneration &&
          _needsStatusPolling(previous)) {
        _scheduleStatusCheck(generation);
      }
      rethrow;
    }
  }

  Future<void> _openCheckDetails(KycOverview overview, String type) async {
    await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: AppColors.surface,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
        builder: (sheetContext) => KycCheckDetailsSheet(
            overview: overview,
            type: type,
            onCheckStatus: () => _checkStatus(overview),
            onReconcile: type == 'BVN' &&
                    (overview.providerValidationStatus != null ||
                        overview.provider.toUpperCase() == 'PAYSTACK') &&
                    kycCheckPending(kycCheckStatus(overview, type))
                ? _service.reconcilePaystack
                : null,
            onContinue: (latest) {
              Navigator.of(sheetContext).pop();
              if (type == 'NIN') {
                _openNinUpgrade(latest);
              } else {
                _openVerificationDialog(latest);
              }
            }));
  }

  void _openHistory(KycOverview overview) {
    showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: AppColors.surface,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
        builder: (_) => KycHistorySheet(documents: overview.documents));
  }

  Future<void> _showSubmissionConfirmation(
      KycOverview overview, String type, KycVerificationResult result) async {
    final status = _documentStatus(overview, type);
    if (status != 'VERIFIED' && !_isDocumentPending(status)) {
      _showMessage(
          'Your $type check needs attention. Open its status to review the next steps.');
      return;
    }
    final verified = status == 'VERIFIED';
    final continueNin = type == 'BVN' && kycCanStartNin(overview);
    final next = await Navigator.of(context).push<bool>(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (dialogContext) => KycSubmissionConfirmation(
        type: type,
        verified: verified,
        message: verified &&
                type == 'BVN' &&
                result.accountProvisioningStatus == 'READY'
            ? 'Identity confirmed. Your NGN account is ready.'
            : verified
                ? 'Your $type check is complete.'
                : type == 'BVN'
                    ? 'We’ve received your BVN and linked bank details.'
                    : 'Your NIN document is with our review team.',
        onStatus: () => Navigator.of(dialogContext).pop(false),
        onContinueNin:
            continueNin ? () => Navigator.of(dialogContext).pop(true) : null,
      ),
    ));
    if (next == true && mounted) await _openNinUpgrade(overview);
  }

  Future<void> _openVerificationDialog(
    KycOverview overview, {
    String? documentTypeOverride,
  }) async {
    if (_isSubmitting ||
        _isPaystackValidated(overview) ||
        (_isPaystackValidationPending(overview) &&
            kycRecoveryFor(overview, 'BVN')?.retryAllowed != true)) {
      return;
    }
    setState(() {
      _stepIndex = 0;
      _idNumberController.clear();
      _dateOfBirthController.clear();
      _consentAccepted = false;
      _accountSetupConsent = false;
      _bankCodeController.clear();
      _accountNumberController.clear();
    });
    _prefetchBankOptions();
    final documentType = documentTypeOverride ?? _effectiveType(overview);
    final dialogMessengerKey = GlobalKey<ScaffoldMessengerState>();

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => Dialog.fullscreen(
        child: ScaffoldMessenger(
          key: dialogMessengerKey,
          child: StatefulBuilder(
            builder: (pageContext, setDialogState) => PopScope(
              canPop: _stepIndex == 0 && !_isSubmitting,
              onPopInvokedWithResult: (didPop, result) {
                if (_isSubmitting) return;
                if (didPop) {
                  _resetVerificationForm();
                  return;
                }
                _handleVerificationBack(
                  pageContext: pageContext,
                  dialogContext: dialogContext,
                  setDialogState: setDialogState,
                );
              },
              child: Scaffold(
                backgroundColor: AppColors.background,
                resizeToAvoidBottomInset: true,
                appBar: _pageHeader(
                  title: 'TrustPay KYC',
                  enabled: !_isSubmitting,
                  onBack: () => _handleVerificationBack(
                    pageContext: pageContext,
                    dialogContext: dialogContext,
                    setDialogState: setDialogState,
                  ),
                ),
                body: SafeArea(
                  top: false,
                  child: _VerificationForm(
                    stepIndex: _stepIndex,
                    firstNameController: _firstNameController,
                    lastNameController: _lastNameController,
                    phoneController: _phoneController,
                    detailsError: _detailsError,
                    profileIdentityLocked: overview.profileIdentityLocked ||
                        _profileDetailsConfirmed,
                    onDetailsChanged: () {
                      _detailsError = null;
                      _consentAccepted = false;
                      _accountSetupConsent = false;
                      setDialogState(() {});
                    },
                    onEditDetails: () => setDialogState(() => _stepIndex = 0),
                    onSupport: overview.profileIdentityLocked ||
                            _profileDetailsConfirmed ||
                            _detailsRequireSupport
                        ? () {
                            Navigator.of(dialogContext).pop();
                            context.push(AppRoutes.profileSupport);
                          }
                        : null,
                    bankName: _bankName,
                    bankCodeController: _bankCodeController,
                    accountNumberController: _accountNumberController,
                    documentType: documentType,
                    service: _service,
                    idNumberController: _idNumberController,
                    dateOfBirthController: _dateOfBirthController,
                    consentAccepted: _consentAccepted,
                    accountSetupConsent: _accountSetupConsent,
                    onAccountSetupConsentChanged: (accepted) {
                      setState(() => _accountSetupConsent = accepted);
                      setDialogState(() {});
                    },
                    isSubmitting: _isSubmitting,
                    onConsentChanged: (accepted) {
                      setState(() => _consentAccepted = accepted);
                      setDialogState(() {});
                    },
                    onDateSelected: (date) {
                      setState(() {
                        _dateOfBirthController.text =
                            DateFormat('yyyy-MM-dd').format(date);
                      });
                      setDialogState(() {});
                    },
                    onBankSelected: (bank) {
                      setState(() {
                        _bankCodeController.text = bank.code;
                        _bankName = bank.name;
                      });
                      setDialogState(() {});
                    },
                  ),
                ),
                bottomNavigationBar: Padding(
                  padding: EdgeInsets.only(
                    bottom: MediaQuery.viewInsetsOf(pageContext).bottom,
                  ),
                  child: _VerificationNavigation(
                    stepIndex: _stepIndex,
                    isSubmitting: _isSubmitting,
                    onBack: () => _handleVerificationBack(
                      pageContext: pageContext,
                      dialogContext: dialogContext,
                      setDialogState: setDialogState,
                    ),
                    onNext: () {
                      FocusScope.of(pageContext).unfocus();
                      _continueToNextStep(
                        overview,
                        documentType,
                        setDialogState,
                        dialogContext,
                        dialogMessengerKey.currentState,
                      );
                    },
                    onSubmit: () {
                      FocusScope.of(pageContext).unfocus();
                      Haptics.medium();
                      _continueToNextStep(
                        overview,
                        documentType,
                        setDialogState,
                        dialogContext,
                        dialogMessengerKey.currentState,
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _resetVerificationForm() {
    _idNumberController.clear();
    _dateOfBirthController.clear();
    _consentAccepted = false;
    _accountSetupConsent = false;
    _bankCodeController.clear();
    _accountNumberController.clear();
    _stepIndex = 0;
  }

  void _handleVerificationBack({
    required BuildContext pageContext,
    required BuildContext dialogContext,
    required StateSetter setDialogState,
  }) {
    if (_isSubmitting) return;
    FocusScope.of(pageContext).unfocus();
    if (_stepIndex > 0) {
      setDialogState(() => _stepIndex -= 1);
      return;
    }
    _resetVerificationForm();
    if (dialogContext.mounted) Navigator.of(dialogContext).pop();
  }

  Future<void> _verify(
    KycOverview overview,
    String documentType,
    StateSetter setDialogState,
    BuildContext dialogContext,
    ScaffoldMessengerState? messenger,
  ) async {
    if (_isSubmitting ||
        _isPaystackValidated(overview) ||
        (_isPaystackValidationPending(overview) &&
            kycRecoveryFor(overview, 'BVN')?.retryAllowed != true)) {
      return;
    }
    final idNumber = _idNumberController.text.trim();
    final dateOfBirth = _dateOfBirthController.text.trim();
    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();
    final bankCode = _bankCodeController.text.trim();
    final accountNumber = _accountNumberController.text.trim();
    final personalError = _personalDetailsError(overview);
    if (personalError != null) {
      setDialogState(() {
        _stepIndex = 0;
        _detailsError = personalError;
      });
      return;
    }
    if (!RegExp(r'^\d{11}$').hasMatch(idNumber)) {
      _showMessage('Enter the 11-digit $documentType number.',
          messenger: messenger);
      return;
    }
    if (!RegExp(r'^\d{3,6}$').hasMatch(bankCode) ||
        !RegExp(r'^\d{10}$').hasMatch(accountNumber)) {
      _showMessage(
        'Choose your bank and enter the 10-digit account linked to your BVN.',
        messenger: messenger,
      );
      return;
    }
    final parsedDateOfBirth = DateTime.tryParse(dateOfBirth);
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dateOfBirth) ||
        parsedDateOfBirth == null ||
        parsedDateOfBirth.isAfter(DateTime.now())) {
      _showMessage(
        'Enter a valid date of birth in YYYY-MM-DD format.',
        messenger: messenger,
      );
      return;
    }
    if (!_consentAccepted) {
      _showMessage('Confirm consent before verification.',
          messenger: messenger);
      return;
    }

    setState(() => _isSubmitting = true);
    setDialogState(() {});
    var dialogClosed = false;
    var profileReady = false;
    try {
      final phone = normalizeNigerianKycPhone(_phoneController.text)!;
      final profileLocked = await _service.ensureIdentityProfile(
        firstName: firstName,
        lastName: lastName,
        phone: phone,
        yearOfBirth: parsedDateOfBirth.year,
        idempotencyKey: _profileIdempotency.keyFor(sha256
            .convert(utf8.encode(
              jsonEncode([
                'kyc-profile',
                firstName,
                lastName,
                phone,
                parsedDateOfBirth.year
              ]),
            ))
            .toString()),
      );
      _profileIdempotency.markFinalOutcome();
      profileReady = true;
      _profileDetailsConfirmed = profileLocked;
      if (!mounted || !dialogContext.mounted) return;
      final result = await _service.verifyIdentity(
        country: 'NG',
        type: documentType,
        idNumber: idNumber,
        dateOfBirth: dateOfBirth,
        consentAccepted: _consentAccepted,
        firstName: firstName,
        lastName: lastName,
        bankCode: bankCode,
        accountNumber: accountNumber,
        accountSetupConsent: _accountSetupConsent,
        retryPending: _isPaystackValidationPending(overview),
        idempotencyKey: _attemptIdempotency.keyFor(
          sha256
              .convert(utf8.encode(jsonEncode([
                'kyc-paystack',
                'NG',
                documentType,
                idNumber,
                dateOfBirth,
                firstName,
                lastName,
                phone,
                bankCode,
                accountNumber,
                _accountSetupConsent,
              ])))
              .toString(),
        ),
      );
      _attemptIdempotency.markFinalOutcome();
      if (!mounted) return;
      KycOverview? refreshed;
      try {
        refreshed = await _service.fetchOverview(includeIdentityProfile: true);
      } catch (_) {
        // The verification response remains authoritative if status refresh
        // is temporarily unavailable.
      }
      if (!mounted) return;
      final updated =
          _submissionOverview(overview, refreshed, result, documentType);
      setState(() {
        _idNumberController.clear();
        _dateOfBirthController.clear();
        _consentAccepted = false;
        _accountSetupConsent = false;
        _bankCodeController.clear();
        _accountNumberController.clear();
        _stepIndex = 0;
        _future = _loadStatus(updated);
      });
      if (dialogContext.mounted) Navigator.of(dialogContext).pop();
      dialogClosed = true;
      setState(() => _isSubmitting = false);
      await _showSubmissionConfirmation(updated, documentType, result);
    } catch (error) {
      if (!mounted) return;
      if (profileReady && error is DioException) {
        final status = error.response?.statusCode ?? 0;
        if (status >= 400 && status < 500) {
          _attemptIdempotency.markFinalOutcome();
        }
      }
      if (!profileReady) {
        setDialogState(() {
          _stepIndex = 0;
          _detailsError = error is KycProfileException
              ? error.message
              : authErrorMessage(error,
                  'Could not save your legal name and phone number. Check your connection and try again.');
          _detailsRequireSupport =
              error is KycProfileException && error.requiresSupport ||
                  error is DioException && error.response?.statusCode == 409;
          if (_detailsRequireSupport) {
            _profileDetailsConfirmed = true;
          }
        });
      } else {
        _showMessage(
          authErrorMessage(error, 'Unable to verify identity'),
          messenger: messenger,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
        if (!dialogClosed) setDialogState(() {});
      }
    }
  }

  void _showMessage(String message, {ScaffoldMessengerState? messenger}) {
    final target = messenger ?? ScaffoldMessenger.maybeOf(context);
    target
      ?..removeCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  String? _personalDetailsError(KycOverview overview) {
    final nameError = validateKycLegalName(
        _firstNameController.text, _lastNameController.text);
    final phone = normalizeNigerianKycPhone(_phoneController.text);
    if (_profileDetailsConfirmed && (nameError != null || phone == null)) {
      return kycLockedProfileMessage;
    }
    if (overview.profileIdentityLocked) {
      final savedName = '${overview.firstName ?? ''} ${overview.lastName ?? ''}'
          .trim()
          .toLowerCase();
      final enteredName =
          '${_firstNameController.text.trim()} ${_lastNameController.text.trim()}'
              .trim()
              .toLowerCase();
      if (nameError != null ||
          phone == null ||
          savedName != enteredName ||
          phone != normalizeNigerianKycPhone(overview.phone ?? '')) {
        return kycLockedProfileMessage;
      }
    }
    return nameError ?? (phone == null ? kycPhoneValidationMessage : null);
  }

  void _continueToNextStep(
    KycOverview overview,
    String documentType,
    StateSetter setDialogState,
    BuildContext dialogContext,
    ScaffoldMessengerState? messenger,
  ) {
    if (_stepIndex == 0) {
      final error = _personalDetailsError(overview);
      if (error != null) {
        setDialogState(() => _detailsError = error);
        return;
      }
      _detailsError = null;
    }
    if (_stepIndex == 1 &&
        (!RegExp(r'^\d{3,6}$').hasMatch(_bankCodeController.text.trim()) ||
            !RegExp(r'^\d{10}$')
                .hasMatch(_accountNumberController.text.trim()))) {
      _showMessage(
        'Choose your bank and enter the 10-digit account linked to your BVN.',
        messenger: messenger,
      );
      return;
    }
    if (_stepIndex == 2 &&
        !RegExp(r'^\d{11}$').hasMatch(_idNumberController.text.trim())) {
      _showMessage(
        'Enter the 11-digit $documentType number.',
        messenger: messenger,
      );
      return;
    }
    if (_stepIndex == 3) {
      final value = _dateOfBirthController.text.trim();
      final parsed = DateTime.tryParse(value);
      if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ||
          parsed == null ||
          parsed.isAfter(DateTime.now()) ||
          parsed.year < 1900 ||
          parsed.year > DateTime.now().year - 13) {
        _showMessage(
          'Choose your correct date of birth (1900–${DateTime.now().year - 13}).',
          messenger: messenger,
        );
        return;
      }
    }
    if (_stepIndex < 4) {
      setDialogState(() => _stepIndex += 1);
    } else {
      _verify(
        overview,
        documentType,
        setDialogState,
        dialogContext,
        messenger,
      );
    }
  }

  PreferredSizeWidget _pageHeader({
    required String title,
    required VoidCallback onBack,
    bool enabled = true,
    List<Widget> actions = const [],
  }) =>
      AppBar(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        leading: IconButton(
            tooltip: 'Back',
            onPressed: enabled ? onBack : null,
            icon: const Icon(Icons.arrow_back_rounded)),
        title: Text(title, style: AppTextStyles.headingM),
        actions: actions,
      );

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: _pageHeader(
        title: 'KYC verification',
        onBack: () {
          if (context.canPop()) {
            context.pop();
          } else {
            context.go(AppRoutes.home);
          }
        },
        actions: [
          IconButton(
              tooltip: 'Refresh verification status',
              onPressed: _reload,
              icon: const Icon(Icons.refresh_rounded))
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async {
          _reload();
          try {
            await _future;
          } catch (_) {
            // The FutureBuilder owns the visible error and retry action.
          }
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
              if (_phoneController.text.isEmpty && overview.phone != null) {
                _phoneController.text = overview.phone!;
              }
            }
            return KycStatusOverview(
              overview: overview,
              busy: _isSubmitting || _isManualNinSubmitting,
              onDetails: (type) => _openCheckDetails(overview, type),
              onSupport: () => context.push(AppRoutes.profileSupport),
              onStartBvn: () => _openVerificationDialog(overview),
              onStartNin: () => _openNinUpgrade(overview),
              onHistory: () => _openHistory(overview),
              onAccount: () async {
                await context.push(AppRoutes.virtualAccount);
                if (mounted) _reload();
              },
            );
          },
        ),
      ),
    );
  }
}

class _KycPageIntro extends StatelessWidget {
  final String eyebrow;
  final String title;
  final String description;
  final IconData icon;

  const _KycPageIntro({
    required this.eyebrow,
    required this.title,
    required this.description,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Icon(icon, color: AppColors.primary),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: AppTextStyles.caption.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.7,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(title, style: AppTextStyles.headingL),
              const SizedBox(height: AppSpacing.xs),
              Text(description, style: AppTextStyles.bodyS),
            ],
          ),
        ),
      ],
    );
  }
}

class _KycBankPicker extends StatefulWidget {
  final KycService service;
  final String selectedCode;
  final bool enabled;
  final ValueChanged<KycBankOption> onSelected;

  const _KycBankPicker({
    required this.service,
    required this.selectedCode,
    required this.enabled,
    required this.onSelected,
  });

  @override
  State<_KycBankPicker> createState() => _KycBankPickerState();
}

class _KycBankPickerState extends State<_KycBankPicker> {
  List<KycBankOption> _banks = const [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadBanks();
  }

  Future<void> _loadBanks() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _error = null;
      });
    }
    try {
      final banks = await widget.service.fetchBanks();
      if (!mounted) return;
      setState(() {
        _banks = banks;
        _isLoading = false;
        _error = banks.isEmpty ? 'No banks are available right now.' : null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _banks = const [];
        _isLoading = false;
        _error = authErrorMessage(
          error,
          'Could not load the bank list. Check your connection and retry.',
        );
      });
    }
  }

  Future<void> _openPicker() async {
    if (!widget.enabled || _isLoading || _banks.isEmpty) return;
    FocusScope.of(context).unfocus();
    final selected = await showModalBottomSheet<KycBankOption>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _KycBankSheet(
        banks: _banks,
        selectedCode: widget.selectedCode,
      ),
    );
    if (selected != null && mounted) widget.onSelected(selected);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final selected = _banks.where((bank) => bank.code == widget.selectedCode);
    final selectedName = selected.isEmpty ? null : selected.first.name;

    if (_isLoading) {
      return const _KycBankStatePanel(
        icon: Icons.account_balance_outlined,
        message: 'Loading the secure bank list…',
        action: null,
      );
    }

    if (_banks.isEmpty) {
      return _KycBankStatePanel(
        icon: Icons.cloud_off_rounded,
        message: _error ?? 'The secure bank list is unavailable.',
        action: TextButton.icon(
          onPressed: widget.enabled ? _loadBanks : null,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Retry'),
        ),
      );
    }

    return OutlinedButton(
      key: const ValueKey('kyc-bank-picker'),
      onPressed: widget.enabled ? _openPicker : null,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, _kycInputMinHeight),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        alignment: Alignment.centerLeft,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.account_balance_outlined, color: AppColors.primary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Bank',
                  style: AppTextStyles.labelM.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  selectedName ?? 'Choose your bank',
                  style: AppTextStyles.labelL,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const Icon(Icons.keyboard_arrow_down_rounded),
        ],
      ),
    );
  }
}

class _KycBankStatePanel extends StatelessWidget {
  final IconData icon;
  final String message;
  final Widget? action;

  const _KycBankStatePanel({
    required this.icon,
    required this.message,
    required this.action,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(message, style: AppTextStyles.bodyS)),
          if (action != null) ...[
            const SizedBox(width: AppSpacing.xs),
            action!,
          ],
        ],
      ),
    );
  }
}

class _KycBankSheet extends StatefulWidget {
  final List<KycBankOption> banks;
  final String selectedCode;

  const _KycBankSheet({
    required this.banks,
    required this.selectedCode,
  });

  @override
  State<_KycBankSheet> createState() => _KycBankSheetState();
}

class _KycBankSheetState extends State<_KycBankSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final rows = widget.banks
        .where((bank) =>
            '${bank.name} ${bank.slug} ${bank.code}'.toLowerCase().contains(
                  _query,
                ))
        .toList(growable: false);
    final media = MediaQuery.of(context);
    final available =
        (media.size.height - media.viewInsets.bottom - media.padding.top - 64)
            .clamp(220.0, media.size.height * 0.72)
            .toDouble();

    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: available,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.sm,
                  AppSpacing.lg,
                  AppSpacing.md,
                ),
                child: Text('Choose your bank', style: AppTextStyles.headingL),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: TextField(
                  autofocus: false,
                  decoration: const InputDecoration(
                    labelText: 'Search banks',
                    hintText: 'Bank name or code',
                    prefixIcon: Icon(Icons.search_rounded),
                  ),
                  onChanged: (value) => setState(
                    () => _query = value.trim().toLowerCase(),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              if (rows.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Text(
                    'No banks match. Try another name or code.',
                    style: AppTextStyles.bodyM,
                  ),
                ),
              Expanded(
                child: ListView.separated(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  itemCount: rows.length,
                  separatorBuilder: (_, __) =>
                      Divider(height: 1, color: AppColors.divider),
                  itemBuilder: (context, index) {
                    final bank = rows[index];
                    return ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg,
                        vertical: AppSpacing.xs,
                      ),
                      leading: CircleAvatar(
                        backgroundColor: AppColors.surfaceVariant,
                        child: Icon(
                          Icons.account_balance_outlined,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      title: Text(bank.name, style: AppTextStyles.labelM),
                      subtitle: Text(bank.code, style: AppTextStyles.caption),
                      trailing: bank.code == widget.selectedCode
                          ? Icon(Icons.check_circle_rounded,
                              color: AppColors.primary)
                          : null,
                      onTap: () => Navigator.of(context).pop(bank),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KycConsentTile extends StatelessWidget {
  final Key? tileKey;
  final bool value;
  final bool enabled;
  final String title;
  final ValueChanged<bool> onChanged;

  const _KycConsentTile({
    this.tileKey,
    required this.value,
    required this.enabled,
    required this.title,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      color: Colors.transparent,
      child: CheckboxListTile(
        key: tileKey,
        value: value,
        onChanged: enabled ? (next) => onChanged(next ?? false) : null,
        controlAffinity: ListTileControlAffinity.leading,
        contentPadding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
        title: Text(
          title,
          style: AppTextStyles.bodyM.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

class _VerificationForm extends StatelessWidget {
  final int stepIndex;
  final String bankName;
  final String documentType;
  final KycService service;
  final TextEditingController idNumberController;
  final TextEditingController dateOfBirthController;
  final TextEditingController firstNameController;
  final TextEditingController lastNameController;
  final TextEditingController phoneController;
  final String? detailsError;
  final bool profileIdentityLocked;
  final VoidCallback onDetailsChanged, onEditDetails;
  final VoidCallback? onSupport;
  final TextEditingController bankCodeController;
  final TextEditingController accountNumberController;
  final bool consentAccepted;
  final bool accountSetupConsent;
  final bool isSubmitting;
  final ValueChanged<bool> onConsentChanged;
  final ValueChanged<bool> onAccountSetupConsentChanged;
  final ValueChanged<DateTime> onDateSelected;
  final ValueChanged<KycBankOption> onBankSelected;

  const _VerificationForm({
    required this.stepIndex,
    required this.bankName,
    required this.documentType,
    required this.service,
    required this.idNumberController,
    required this.dateOfBirthController,
    required this.firstNameController,
    required this.lastNameController,
    required this.phoneController,
    required this.detailsError,
    required this.profileIdentityLocked,
    required this.onDetailsChanged,
    required this.onEditDetails,
    required this.onSupport,
    required this.bankCodeController,
    required this.accountNumberController,
    required this.consentAccepted,
    required this.accountSetupConsent,
    required this.onAccountSetupConsentChanged,
    required this.isSubmitting,
    required this.onConsentChanged,
    required this.onDateSelected,
    required this.onBankSelected,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final reviewedPhone = normalizeNigerianKycPhone(phoneController.text);
    final titles = [
      'Confirm your legal name',
      'Your linked bank account',
      'Enter your $documentType number',
      'Confirm your date of birth',
      'Review and consent',
    ];
    final descriptions = [
      'Use your BVN name and Nigerian phone number so TrustPay can match your details.',
      'We check the bank account connected to your BVN.',
      'Use the 11-digit number linked to your profile.',
      'This must match the identity record exactly.',
      'We use your details to complete your identity check securely.',
    ];

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      child: SingleChildScrollView(
        key: ValueKey(stepIndex),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.xl,
          AppSpacing.lg,
          AppSpacing.xxl,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _KycPageIntro(
              eyebrow:
                  '$documentType VERIFICATION · STEP ${stepIndex + 1} OF 5',
              title: titles[stepIndex],
              description: descriptions[stepIndex],
              icon: stepIndex == 4
                  ? Icons.fact_check_outlined
                  : Icons.verified_user_outlined,
            ),
            const SizedBox(height: AppSpacing.xl),
            _KycProgressIndicator(currentStep: stepIndex),
            const SizedBox(height: AppSpacing.xl),
            _Panel(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.xl,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (stepIndex == 0) ...[
                    Text('Legal name and phone', style: AppTextStyles.headingM),
                    const SizedBox(height: AppSpacing.md),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final fields = [
                          TextField(
                            key: const ValueKey('kyc-first-name'),
                            controller: firstNameController,
                            readOnly: profileIdentityLocked,
                            onChanged: (_) => onDetailsChanged(),
                            autofillHints: const [AutofillHints.givenName],
                            enabled: !isSubmitting,
                            textInputAction: TextInputAction.next,
                            textCapitalization: TextCapitalization.words,
                            style: _kycInputTextStyle(),
                            decoration: _kycInputDecoration(
                              labelText: 'First name',
                              hintText: 'e.g. Ada',
                            ),
                          ),
                          TextField(
                            key: const ValueKey('kyc-last-name'),
                            controller: lastNameController,
                            readOnly: profileIdentityLocked,
                            onChanged: (_) => onDetailsChanged(),
                            autofillHints: const [AutofillHints.familyName],
                            enabled: !isSubmitting,
                            textInputAction: TextInputAction.done,
                            textCapitalization: TextCapitalization.words,
                            style: _kycInputTextStyle(),
                            decoration: _kycInputDecoration(
                              labelText: 'Last name',
                              hintText: 'e.g. Lovelace',
                            ),
                          ),
                        ];
                        if (constraints.maxWidth < 520) {
                          return Column(
                            children: [
                              fields[0],
                              const SizedBox(height: AppSpacing.md),
                              fields[1],
                            ],
                          );
                        }
                        return Row(
                          children: [
                            Expanded(child: fields[0]),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(child: fields[1]),
                          ],
                        );
                      },
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    TextField(
                      key: const ValueKey('kyc-phone'),
                      controller: phoneController,
                      enabled: !isSubmitting,
                      readOnly: profileIdentityLocked,
                      onChanged: (_) => onDetailsChanged(),
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      style: _kycInputTextStyle(),
                      decoration: _kycInputDecoration(
                        labelText: 'Phone number',
                        hintText: '0801 234 5678',
                        helperText: 'Nigerian number, starting with 0 or +234',
                        helperMaxLines: 2,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                        'Submitting saves your reviewed name, phone and birth year to your profile. Later corrections require support.',
                        style: AppTextStyles.caption),
                    if (detailsError != null) ...[
                      const SizedBox(height: AppSpacing.lg),
                      Semantics(
                          liveRegion: true,
                          child: Text(detailsError!,
                              style: AppTextStyles.bodyS
                                  .copyWith(color: AppColors.error))),
                    ],
                    if (onSupport != null) ...[
                      const SizedBox(height: AppSpacing.md),
                      Text(kycLockedProfileMessage, style: AppTextStyles.bodyS),
                      TextButton.icon(
                          onPressed: isSubmitting ? null : onSupport,
                          icon: const Icon(Icons.support_agent_rounded),
                          label: const Text('Contact support')),
                    ],
                  ] else if (stepIndex == 1) ...[
                    _KycBankPicker(
                      service: service,
                      selectedCode: bankCodeController.text,
                      enabled: !isSubmitting,
                      onSelected: onBankSelected,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    TextField(
                      key: const ValueKey('kyc-account-number'),
                      controller: accountNumberController,
                      enabled: !isSubmitting,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(10),
                      ],
                      style: _kycInputTextStyle(),
                      decoration: _kycInputDecoration(
                        labelText: 'Account number',
                        hintText: '10 digits',
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      'Your account number is sent over the encrypted TrustPay connection and is not shown in history.',
                      style: AppTextStyles.caption,
                    ),
                  ] else if (stepIndex == 2) ...[
                    Text('$documentType number', style: AppTextStyles.headingM),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      key: const ValueKey('kyc-identity-number'),
                      controller: idNumberController,
                      enabled: !isSubmitting,
                      enableSuggestions: false,
                      autocorrect: false,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(11),
                      ],
                      style: _kycInputTextStyle(),
                      decoration: _kycInputDecoration(
                        labelText: '$documentType number',
                        hintText: '11 digits',
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      'Your full identity number is never shown in history.',
                      style: AppTextStyles.caption,
                    ),
                  ] else if (stepIndex == 3) ...[
                    _DateOfBirthPickerField(
                      controller: dateOfBirthController,
                      enabled: !isSubmitting,
                      onDateSelected: onDateSelected,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      'Choose the date linked to your identity record. Future dates are not accepted.',
                      style: AppTextStyles.caption,
                    ),
                  ] else ...[
                    Text('Check your details', style: AppTextStyles.headingM),
                    const SizedBox(height: AppSpacing.md),
                    _ReviewRow(
                      label: 'Legal name',
                      value:
                          '${firstNameController.text.trim()} ${lastNameController.text.trim()}'
                              .trim(),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _ReviewRow(
                        label: 'Phone number',
                        value: reviewedPhone == null
                            ? 'Not provided'
                            : '+234 ••• ••• ${reviewedPhone.substring(reviewedPhone.length - 4)}'),
                    Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                            onPressed: isSubmitting ? null : onEditDetails,
                            icon: const Icon(Icons.edit_outlined, size: 18),
                            label: const Text('Edit personal details'))),
                    const SizedBox(height: AppSpacing.md),
                    _ReviewRow(label: 'Bank', value: bankName),
                    const SizedBox(height: AppSpacing.md),
                    _ReviewRow(
                        label: 'Linked account',
                        value:
                            '••••••${accountNumberController.text.length >= 4 ? accountNumberController.text.substring(accountNumberController.text.length - 4) : ''}'),
                    const SizedBox(height: AppSpacing.md),
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
                    const SizedBox(height: AppSpacing.xl),
                    _KycConsentTile(
                      tileKey: const ValueKey('kyc-consent'),
                      value: consentAccepted,
                      enabled: !isSubmitting,
                      title:
                          'I agree to share my identity and bank details securely with Paystack for verification.',
                      onChanged: onConsentChanged,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _KycConsentTile(
                      tileKey: const ValueKey('kyc-account-setup-consent'),
                      value: accountSetupConsent,
                      enabled: !isSubmitting,
                      title:
                          'I authorize TrustPay to create a dedicated NGN receiving account after verification.',
                      onChanged: onAccountSetupConsentChanged,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VerificationNavigation extends StatelessWidget {
  final int stepIndex;
  final bool isSubmitting;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final VoidCallback onSubmit;

  const _VerificationNavigation({
    required this.stepIndex,
    required this.isSubmitting,
    required this.onBack,
    required this.onNext,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final textScale = MediaQuery.textScalerOf(context).scale(18) / 18;
            final stackActions = constraints.maxWidth < 360 * textScale;
            final action = ElevatedButton(
              onPressed: isSubmitting
                  ? null
                  : stepIndex == 4
                      ? onSubmit
                      : onNext,
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 60),
              ),
              child: isSubmitting
                  ? Semantics(
                      label: 'Submitting verification',
                      child: const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : Text(stepIndex == 4 ? 'Submit verification' : 'Continue'),
            );
            final back = OutlinedButton(
              onPressed: isSubmitting ? null : onBack,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 60),
              ),
              child: const Text('Back'),
            );

            if (stackActions) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  action,
                  if (stepIndex > 0) ...[
                    const SizedBox(height: AppSpacing.sm),
                    back,
                  ],
                ],
              );
            }

            return Row(
              children: [
                if (stepIndex > 0) Expanded(child: back),
                if (stepIndex > 0) const SizedBox(width: AppSpacing.sm),
                Expanded(flex: stepIndex > 0 ? 2 : 1, child: action),
              ],
            );
          },
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
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                          child: Text('Date of birth',
                              style: AppTextStyles.labelM,
                              textAlign: TextAlign.center)),
                      const SizedBox(width: AppSpacing.sm),
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
          decoration: _kycInputDecoration(
            labelText: 'Date of birth',
            hintText: 'Select your date of birth',
            suffixIcon: const Icon(Icons.calendar_today_rounded),
          ),
          child: Text(
            value == null ? 'Select your date of birth' : controller.text,
            style: value == null
                ? _kycInputTextStyle().copyWith(color: AppColors.textHint)
                : _kycInputTextStyle(),
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
        Expanded(
          child: Text(
            label,
            style: AppTextStyles.labelM.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: AppTextStyles.labelL.copyWith(
              fontWeight: FontWeight.w700,
            ),
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
      children: List.generate(5, (index) {
        final active = index <= currentStep;
        return Expanded(
          child: Container(
            height: 4,
            margin: EdgeInsets.only(right: index == 4 ? 0 : AppSpacing.xs),
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

class _Panel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const _Panel({
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return SizedBox(
        width: double.infinity,
        child: Material(
          color: AppColors.surface,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.lg),
              side: BorderSide(color: AppColors.border)),
          child: Padding(padding: padding, child: child),
        ));
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

bool _isDocumentPending(String status) {
  return status == 'SUBMITTED' ||
      status == 'PENDING' ||
      status == 'PENDING_REVIEW' ||
      status == 'REVIEW_REQUIRED';
}
