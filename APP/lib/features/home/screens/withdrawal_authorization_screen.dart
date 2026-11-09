import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../../core/router/app_router.dart';
import '../../../core/state/wallet_refresh_signal.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/auth_service.dart';
import '../../../services/api_client.dart';

class WithdrawalCompletionDetails {
  final String reference;
  final String status;
  final String message;
  final String amount;
  final String currency;
  final String bankName;
  final String accountName;
  final String accountNumberMasked;
  final String providerStatus;
  final String providerReference;
  final String provider;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? providerCreatedAt;

  const WithdrawalCompletionDetails({
    required this.reference,
    required this.status,
    required this.message,
    required this.amount,
    required this.currency,
    required this.bankName,
    required this.accountName,
    required this.accountNumberMasked,
    required this.providerStatus,
    required this.providerReference,
    this.provider = 'PAYSTACK',
    required this.createdAt,
    required this.updatedAt,
    required this.providerCreatedAt,
  });
}

const _terminalWithdrawalStatuses = {'SUCCESS', 'FAILED', 'REVERSED'};

WithdrawalCompletionDetails _completionDetailsFromWithdrawal(
  Map<String, dynamic> withdrawal, {
  String? overrideMessage,
  String? overrideStatus,
}) {
  final metadata = _asMap(withdrawal['metadata']);
  final attempts = _asList(withdrawal['transferAttempts']);
  final latestAttempt = attempts.isNotEmpty ? _asMap(attempts.first) : {};
  final attemptMetadata = _asMap(latestAttempt['metadata']);
  final status =
      overrideStatus ?? _asString(withdrawal['status'], fallback: 'PENDING');
  final amount = _asString(withdrawal['amount'], fallback: '0.00');
  final currency = _asString(withdrawal['currency'], fallback: 'NGN');
  final bankName = _asString(
    attemptMetadata['bankName'],
    fallback: _asString(metadata['bankName'], fallback: 'Bank'),
  );
  final accountName = _asString(
    attemptMetadata['accountName'],
    fallback: _asString(metadata['accountName'], fallback: 'Account'),
  );
  final accountNumberMasked = _asString(
    attemptMetadata['accountNumberMasked'],
    fallback: _asString(
      metadata['accountNumberMasked'],
      fallback: '******',
    ),
  );
  final providerStatus = _asString(
    latestAttempt['providerStatus'],
    fallback: status,
  );
  final provider = _asString(
    latestAttempt['provider'],
    fallback: _asString(
      withdrawal['provider'],
      fallback: _asString(metadata['provider'], fallback: 'PAYSTACK'),
    ),
  ).toUpperCase();
  final providerReference = _asString(
    latestAttempt['providerReference'],
    fallback: _asString(
      metadata['providerTransactionReference'],
      fallback: _asString(withdrawal['reference']),
    ),
  );

  return WithdrawalCompletionDetails(
    reference: _asString(withdrawal['reference']),
    status: status,
    message: overrideMessage ?? _asString(withdrawal['message'], fallback: ''),
    amount: amount,
    currency: currency,
    bankName: bankName,
    accountName: accountName,
    accountNumberMasked: accountNumberMasked,
    providerStatus: providerStatus,
    providerReference: providerReference,
    provider: provider,
    createdAt: _asDateTime(withdrawal['createdAt']),
    updatedAt: _asDateTime(withdrawal['updatedAt']),
    providerCreatedAt: _asDateTime(latestAttempt['createdAt']),
  );
}

class WithdrawalAuthorizationScreen extends StatefulWidget {
  final String reference;

  const WithdrawalAuthorizationScreen({
    super.key,
    required this.reference,
  });

  @override
  State<WithdrawalAuthorizationScreen> createState() =>
      _WithdrawalAuthorizationScreenState();
}

class _WithdrawalAuthorizationScreenState
    extends State<WithdrawalAuthorizationScreen> {
  static const _uuid = Uuid();
  final _apiClient = ApiClient();
  final _codeController = TextEditingController();

  late Future<Map<String, dynamic>> _withdrawalFuture;
  bool _isSubmitting = false;
  bool _isResending = false;
  List<String> _otpRecipients = const [];
  Timer? _statusPollTimer;
  int _statusPollAttempts = 0;
  Map<String, dynamic>? _polledWithdrawal;

  @override
  void initState() {
    super.initState();
    _loadWithdrawal();
  }

  @override
  void dispose() {
    _statusPollTimer?.cancel();
    _codeController.dispose();
    super.dispose();
  }

  void _loadWithdrawal() {
    _statusPollTimer?.cancel();
    _statusPollAttempts = 0;
    _polledWithdrawal = null;
    _withdrawalFuture = _fetchWithdrawal().then((withdrawal) {
      if (mounted) {
        _scheduleStatusPoll(withdrawal);
      }
      return withdrawal;
    });
  }

  /// Mirrors the VTU order auto-check: a bounded background poll (4 attempts,
  /// 4s then 7s apart) that keeps this screen fresh while the withdrawal is
  /// still awaiting authorization, without removing pull-to-refresh.
  void _scheduleStatusPoll(Map<String, dynamic> withdrawal) {
    _statusPollTimer?.cancel();
    if (_statusPollAttempts >= 4) return;

    final status =
        _asString(withdrawal['status'], fallback: 'PENDING').toUpperCase();
    if (_terminalWithdrawalStatuses.contains(status)) return;

    // Once authorization is no longer pending the inline completion view
    // takes over with its own status polling.
    final providerStatus = _asString(
      _latestProviderStatus(withdrawal),
      fallback: 'PENDING_AUTHORIZATION',
    );
    if (providerStatus != 'PENDING_AUTHORIZATION') return;

    final delay = Duration(seconds: _statusPollAttempts == 0 ? 4 : 7);
    _statusPollTimer = Timer(delay, () async {
      if (!mounted) return;
      _statusPollAttempts++;
      try {
        final refreshed = await _fetchWithdrawal();
        if (!mounted) return;
        setState(() => _polledWithdrawal = refreshed);
        _scheduleStatusPoll(refreshed);
      } catch (_) {
        // Background refresh only; pull-to-refresh stays available.
        if (mounted) {
          _scheduleStatusPoll(withdrawal);
        }
      }
    });
  }

  Future<Map<String, dynamic>> _fetchWithdrawal() async {
    final response = await _apiClient.client.get(
      '/api/payments/withdrawals/${Uri.encodeComponent(widget.reference)}',
    );

    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<void> _authorizeWithdrawal(Map<String, dynamic> withdrawal) async {
    if (_isSubmitting) return;

    if (!_isLegacyMonnifyWithdrawal(withdrawal)) {
      showTpSnackbar(
        context,
        'This Paystack withdrawal is processed securely by TRUSTPAY. No merchant code is required.',
        type: TpSnackbarType.info,
      );
      return;
    }

    final code = _codeController.text.trim();
    if (code.length < 6) {
      showTpSnackbar(
        context,
        'Enter the 6-digit authorization code.',
        type: TpSnackbarType.warning,
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final response = await _apiClient.client.post(
        '/api/payments/withdrawals/${Uri.encodeComponent(widget.reference)}/authorize',
        options: Options(
          headers: {'Idempotency-Key': _uuid.v4()},
        ),
        data: {'authorizationCode': code},
      );

      final data = Map<String, dynamic>.from(response.data as Map);
      final details = _completionDetailsFromWithdrawal(
        withdrawal,
        overrideMessage: _asString(
          data['message'],
          fallback: 'Withdrawal authorization submitted',
        ),
        overrideStatus: _asString(data['status'], fallback: 'PENDING'),
      );

      if (!mounted) return;
      context.pushReplacement(
        AppRoutes.withdrawSuccess,
        extra: details,
      );
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(
          error,
          'Could not authorize this withdrawal. Check the code and try again.',
        ),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _resendCode(Map<String, dynamic> withdrawal) async {
    if (_isResending) return;

    if (!_isLegacyMonnifyWithdrawal(withdrawal)) {
      showTpSnackbar(
        context,
        'Paystack withdrawals do not require a merchant authorization code.',
        type: TpSnackbarType.info,
      );
      return;
    }

    setState(() => _isResending = true);

    try {
      final response = await _apiClient.client.post(
        '/api/payments/withdrawals/${Uri.encodeComponent(widget.reference)}/resend-otp',
        options: Options(
          headers: {'Idempotency-Key': _uuid.v4()},
        ),
      );

      if (!mounted) return;
      final payload = Map<String, dynamic>.from(response.data as Map);
      final recipients = _asStringList(payload['emailRecipients']);
      if (mounted) {
        setState(() => _otpRecipients = recipients);
      }
      showTpSnackbar(
        context,
        recipients.isNotEmpty
            ? 'Authorization code sent to ${_formatRecipients(recipients)}.'
            : _asString(
                payload['message'],
                fallback: 'Authorization code resent successfully.',
              ),
        type: TpSnackbarType.success,
      );
    } catch (error) {
      if (!mounted) return;
      showTpSnackbar(
        context,
        authErrorMessage(
          error,
          'Could not resend the authorization code.',
        ),
        type: TpSnackbarType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isResending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return FutureBuilder<Map<String, dynamic>>(
      future: _withdrawalFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Scaffold(
            backgroundColor: AppColors.background,
            body: const Center(
              child: CircularProgressIndicator(),
            ),
          );
        }

        if (snapshot.hasError || !snapshot.hasData) {
          return Scaffold(
            backgroundColor: AppColors.background,
            appBar: TpAppHeader(
              label: 'Authorize withdrawal',
              menuActions: [
                TpPageMenuAction(
                  label: 'View history',
                  icon: Icons.receipt_long_rounded,
                  onTap: () => context.go(AppRoutes.activity),
                ),
                TpPageMenuAction(
                  label: 'Back home',
                  icon: Icons.home_rounded,
                  onTap: () => context.go(AppRoutes.home),
                ),
              ],
            ),
            body: _WithdrawalErrorState(
              onRetry: () => setState(_loadWithdrawal),
            ),
          );
        }

        final withdrawal = _polledWithdrawal ?? snapshot.data!;
        final details = _completionDetailsFromWithdrawal(withdrawal);
        final providerStatus = _asString(
          _latestProviderStatus(withdrawal),
          fallback: 'PENDING_AUTHORIZATION',
        );
        final requiresUserAuthorization =
            _isLegacyMonnifyWithdrawal(withdrawal);

        if (providerStatus != 'PENDING_AUTHORIZATION' ||
            !requiresUserAuthorization) {
          return WithdrawalCompletionScreen(details: details);
        }

        return Scaffold(
          backgroundColor: AppColors.background,
          appBar: TpAppHeader(
            label: 'Authorize withdrawal',
            menuActions: [
              TpPageMenuAction(
                label: 'View history',
                icon: Icons.receipt_long_rounded,
                onTap: () => context.go(AppRoutes.activity),
              ),
              TpPageMenuAction(
                label: 'Back home',
                icon: Icons.home_rounded,
                onTap: () => context.go(AppRoutes.home),
              ),
            ],
          ),
          body: RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: () async => setState(_loadWithdrawal),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
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
                      _SummaryCard(
                          details: details, providerStatus: providerStatus),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        'Enter the authorization code sent to your email to finish this withdrawal.',
                        style: AppTextStyles.bodyL,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextField(
                        controller: _codeController,
                        keyboardType: TextInputType.number,
                        textInputAction: TextInputAction.done,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(6),
                        ],
                        decoration: InputDecoration(
                          labelText: 'Authorization code',
                          helperText: 'Usually 6 digits',
                          filled: true,
                          fillColor: AppColors.surfaceVariant,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            borderSide: BorderSide(color: AppColors.border),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            borderSide: BorderSide(color: AppColors.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            borderSide: BorderSide(color: AppColors.primary),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (_otpRecipients.isNotEmpty) ...[
                        _InfoPanel(
                          text:
                              'Authorization code sent to ${_formatRecipients(_otpRecipients)}. Check that inbox before authorizing.',
                        ),
                        const SizedBox(height: AppSpacing.md),
                      ],
                      _WithdrawalActions(
                        isSubmitting: _isSubmitting,
                        isResending: _isResending,
                        onResend: () => _resendCode(withdrawal),
                        onAuthorize: () => _authorizeWithdrawal(withdrawal),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      const _InfoPanel(
                        text:
                            'Keep this code private. If the transfer is approved, we will take you to a success screen immediately.',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  String? _latestProviderStatus(Map<String, dynamic> withdrawal) {
    final attempts = _asList(withdrawal['transferAttempts']);
    if (attempts.isEmpty) return null;
    final latest = _asMap(attempts.first);
    return latest['providerStatus']?.toString();
  }

  bool _isLegacyMonnifyWithdrawal(Map<String, dynamic> withdrawal) {
    final metadata = _asMap(withdrawal['metadata']);
    final attempts = _asList(withdrawal['transferAttempts']);
    final latestAttempt = attempts.isNotEmpty ? _asMap(attempts.first) : {};
    final provider = _asString(
      latestAttempt['provider'],
      fallback: _asString(
        withdrawal['provider'],
        fallback: _asString(metadata['provider'], fallback: 'PAYSTACK'),
      ),
    );
    return provider.toUpperCase() == 'MONNIFY';
  }
}

class WithdrawalCompletionScreen extends StatefulWidget {
  final WithdrawalCompletionDetails? details;

  const WithdrawalCompletionScreen({super.key, this.details});

  @override
  State<WithdrawalCompletionScreen> createState() =>
      _WithdrawalCompletionScreenState();
}

class _WithdrawalCompletionScreenState
    extends State<WithdrawalCompletionScreen> {
  final _apiClient = ApiClient();
  WithdrawalCompletionDetails? _details;
  Timer? _statusPollTimer;
  int _statusPollAttempts = 0;
  bool _hasBumpedWalletRefresh = false;

  @override
  void initState() {
    super.initState();
    _adoptDetails(widget.details);
  }

  @override
  void didUpdateWidget(covariant WithdrawalCompletionScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.details, widget.details)) {
      _adoptDetails(widget.details);
    }
  }

  @override
  void dispose() {
    _statusPollTimer?.cancel();
    super.dispose();
  }

  void _adoptDetails(WithdrawalCompletionDetails? details) {
    _details = details;
    if (details != null && details.status.toUpperCase() == 'SUCCESS') {
      _bumpWalletRefreshOnce();
    }
    _scheduleStatusPoll();
  }

  void _bumpWalletRefreshOnce() {
    if (_hasBumpedWalletRefresh) return;
    _hasBumpedWalletRefresh = true;
    walletRefreshSignal.bump();
  }

  /// Bounded background poll (mirrors the VTU order auto-check) so a
  /// processing withdrawal resolves on screen without a manual refresh.
  void _scheduleStatusPoll() {
    _statusPollTimer?.cancel();
    final details = _details;
    if (details == null ||
        details.reference.isEmpty ||
        _statusPollAttempts >= 4 ||
        _terminalWithdrawalStatuses.contains(details.status.toUpperCase())) {
      return;
    }

    final delay = Duration(seconds: _statusPollAttempts == 0 ? 4 : 7);
    _statusPollTimer = Timer(delay, () async {
      final reference = _details?.reference;
      if (!mounted || reference == null || reference.isEmpty) return;
      _statusPollAttempts++;
      try {
        final response = await _apiClient.client.get(
          '/api/payments/withdrawals/${Uri.encodeComponent(reference)}',
        );
        if (!mounted) return;
        final withdrawal = Map<String, dynamic>.from(response.data as Map);
        final refreshed = _completionDetailsFromWithdrawal(withdrawal);
        setState(() => _details = refreshed);
        if (refreshed.status.toUpperCase() == 'SUCCESS') {
          _bumpWalletRefreshOnce();
        }
      } catch (_) {
        // Background refresh only; the user can still navigate away.
      }
      _scheduleStatusPoll();
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final details = _details;
    final status = details?.status.toUpperCase() ?? 'PENDING';
    final isSuccess = status == 'SUCCESS';
    final isFailed = status == 'FAILED' || status == 'REVERSED';
    final title = isSuccess
        ? 'Withdrawal complete'
        : isFailed
            ? 'Withdrawal expired'
            : 'Withdrawal processing';
    final subtitle = isSuccess
        ? 'Your withdrawal finished successfully.'
        : isFailed
            ? 'This withdrawal expired before authorization could be completed.'
            : details?.provider.toUpperCase() == 'MONNIFY'
                ? 'Your withdrawal is with Monnify for final confirmation.'
                : 'Your Paystack withdrawal is being processed securely. We will update this status after confirmation.';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'Withdrawal status',
        menuActions: [
          TpPageMenuAction(
            label: 'View history',
            icon: Icons.receipt_long_rounded,
            onTap: () => context.go(AppRoutes.activity),
          ),
          TpPageMenuAction(
            label: 'Home',
            icon: Icons.home_rounded,
            onTap: () => context.go(AppRoutes.home),
          ),
        ],
      ),
      body: CustomScrollView(
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
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppSpacing.xl),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: isSuccess
                          ? AppColors.success.withValues(alpha: 0.18)
                          : isFailed
                              ? AppColors.error.withValues(alpha: 0.18)
                              : AppColors.warning.withValues(alpha: 0.18),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.overlayLight,
                        blurRadius: 20,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          color: (isSuccess
                                  ? AppColors.success
                                  : isFailed
                                      ? AppColors.error
                                      : AppColors.warning)
                              .withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          isSuccess
                              ? Icons.check_rounded
                              : isFailed
                                  ? Icons.error_outline_rounded
                                  : Icons.sync_rounded,
                          color: isSuccess
                              ? AppColors.success
                              : isFailed
                                  ? AppColors.error
                                  : AppColors.warning,
                          size: 42,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        title,
                        style: AppTextStyles.headingL.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        subtitle,
                        style: AppTextStyles.bodyM.copyWith(
                          color: AppColors.textSecondary,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      if (details != null) ...[
                        const SizedBox(height: AppSpacing.lg),
                        _StatusLine(
                          label: 'Reference',
                          value: details.reference,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        _StatusLine(
                          label: 'Amount',
                          value:
                              '${details.currency} ${NumberFormat('#,##0.00').format(double.tryParse(details.amount) ?? 0)}',
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        _StatusLine(
                          label: 'Bank',
                          value: details.bankName,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        _StatusLine(
                          label: 'Account',
                          value:
                              '${details.accountName} • ${details.accountNumberMasked}',
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                _CompletionActions(
                  onViewReceipt: () {
                    if (details == null) return;
                    context.push(
                      AppRoutes.withdrawReceiptFor(details.reference),
                      extra: details,
                    );
                  },
                  onHome: () => context.go(AppRoutes.home),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final WithdrawalCompletionDetails details;
  final String providerStatus;

  const _SummaryCard({
    required this.details,
    required this.providerStatus,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final amount = NumberFormat('#,##0.00').format(
      double.tryParse(details.amount) ?? 0,
    );

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
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.account_balance_rounded,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      details.bankName,
                      style: AppTextStyles.labelL.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      providerStatus.replaceAll('_', ' '),
                      style: AppTextStyles.bodyS.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _StatusLine(label: 'Reference', value: details.reference),
          const SizedBox(height: AppSpacing.sm),
          _StatusLine(
            label: 'Amount',
            value: '${details.currency} $amount',
          ),
          const SizedBox(height: AppSpacing.sm),
          _StatusLine(label: 'Account', value: details.accountName),
          const SizedBox(height: AppSpacing.sm),
          _StatusLine(
            label: 'Masked',
            value: details.accountNumberMasked,
          ),
        ],
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  final String label;
  final String value;

  const _StatusLine({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 88,
          child: Text(
            label,
            style: AppTextStyles.bodyS.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: AppTextStyles.labelM.copyWith(
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoPanel extends StatelessWidget {
  final String text;

  const _InfoPanel({required this.text});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        text,
        style: AppTextStyles.bodyS.copyWith(color: AppColors.textSecondary),
      ),
    );
  }
}

class _WithdrawalActions extends StatelessWidget {
  final bool isSubmitting;
  final bool isResending;
  final VoidCallback onResend;
  final VoidCallback onAuthorize;

  const _WithdrawalActions({
    required this.isSubmitting,
    required this.isResending,
    required this.onResend,
    required this.onAuthorize,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final resendButton = OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: isResending ? null : onResend,
      icon: isResending
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
              ),
            )
          : const Icon(Icons.refresh_rounded, size: 18),
      label: const Text(
        'Resend code',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    final authorizeButton = FilledButton.icon(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: isSubmitting ? null : onAuthorize,
      icon: isSubmitting
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
              ),
            )
          : const Icon(Icons.verified_rounded, size: 18),
      label: const Text(
        'Authorize',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 420;

        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              resendButton,
              const SizedBox(height: AppSpacing.sm),
              authorizeButton,
            ],
          );
        }

        return Row(
          children: [
            Expanded(child: resendButton),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: authorizeButton),
          ],
        );
      },
    );
  }
}

class _CompletionActions extends StatelessWidget {
  final VoidCallback onViewReceipt;
  final VoidCallback onHome;

  const _CompletionActions({
    required this.onViewReceipt,
    required this.onHome,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final receiptButton = FilledButton.icon(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: onViewReceipt,
      icon: const Icon(Icons.receipt_long_rounded, size: 18),
      label: const Text(
        'View receipt',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    final homeButton = OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: onHome,
      icon: const Icon(Icons.home_rounded, size: 18),
      label: const Text(
        'Home',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 420;

        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              receiptButton,
              const SizedBox(height: AppSpacing.sm),
              homeButton,
            ],
          );
        }

        return Row(
          children: [
            Expanded(child: receiptButton),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: homeButton),
          ],
        );
      },
    );
  }
}

class _WithdrawalErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _WithdrawalErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline_rounded,
              color: AppColors.error,
              size: 48,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'Could not load this withdrawal',
              style: AppTextStyles.labelL,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Refresh the page and try again.',
              style: AppTextStyles.bodyM.copyWith(
                color: AppColors.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

List<dynamic> _asList(dynamic value) {
  if (value is List) return value;
  return const [];
}

String _asString(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}

DateTime? _asDateTime(dynamic value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value);
  }
  return null;
}

List<String> _asStringList(dynamic value) {
  if (value is List) {
    return value
        .map((item) => _asString(item))
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }
  return const [];
}

String _formatRecipients(List<String> recipients) {
  if (recipients.isEmpty) return '';
  if (recipients.length == 1) return recipients.first;
  return recipients.join(', ');
}
