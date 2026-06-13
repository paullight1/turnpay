import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../../core/router/app_router.dart';
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
    required this.createdAt,
    required this.updatedAt,
    required this.providerCreatedAt,
  });
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

  @override
  void initState() {
    super.initState();
    _loadWithdrawal();
  }

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  void _loadWithdrawal() {
    _withdrawalFuture = _fetchWithdrawal();
  }

  Future<Map<String, dynamic>> _fetchWithdrawal() async {
    final response = await _apiClient.client.get(
      '/api/payments/withdrawals/${Uri.encodeComponent(widget.reference)}',
    );

    return Map<String, dynamic>.from(response.data as Map);
  }

  WithdrawalCompletionDetails _completionDetails(
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
      message:
          overrideMessage ?? _asString(withdrawal['message'], fallback: ''),
      amount: amount,
      currency: currency,
      bankName: bankName,
      accountName: accountName,
      accountNumberMasked: accountNumberMasked,
      providerStatus: providerStatus,
      providerReference: providerReference,
      createdAt: _asDateTime(withdrawal['createdAt']),
      updatedAt: _asDateTime(withdrawal['updatedAt']),
      providerCreatedAt: _asDateTime(latestAttempt['createdAt']),
    );
  }

  Future<void> _authorizeWithdrawal(Map<String, dynamic> withdrawal) async {
    if (_isSubmitting) return;

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
      final details = _completionDetails(
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
    return FutureBuilder<Map<String, dynamic>>(
      future: _withdrawalFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Scaffold(
            backgroundColor: AppColors.background,
            body: Center(
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

        final withdrawal = snapshot.data!;
        final details = _completionDetails(withdrawal);
        final providerStatus = _asString(
          _latestProviderStatus(withdrawal),
          fallback: 'PENDING_AUTHORIZATION',
        );

        if (providerStatus != 'PENDING_AUTHORIZATION') {
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
                      SizedBox(height: AppSpacing.lg),
                      Text(
                        'Enter the authorization code sent to your email to finish this withdrawal.',
                        style: AppTextStyles.bodyL,
                      ),
                      SizedBox(height: AppSpacing.md),
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
                      SizedBox(height: AppSpacing.md),
                      if (_otpRecipients.isNotEmpty) ...[
                        _InfoPanel(
                          text:
                              'Authorization code sent to ${_formatRecipients(_otpRecipients)}. Check that inbox before authorizing.',
                        ),
                        SizedBox(height: AppSpacing.md),
                      ],
                      _WithdrawalActions(
                        isSubmitting: _isSubmitting,
                        isResending: _isResending,
                        onResend: () => _resendCode(withdrawal),
                        onAuthorize: () => _authorizeWithdrawal(withdrawal),
                      ),
                      SizedBox(height: AppSpacing.lg),
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
}

class WithdrawalCompletionScreen extends StatelessWidget {
  final WithdrawalCompletionDetails? details;

  const WithdrawalCompletionScreen({super.key, this.details});

  @override
  Widget build(BuildContext context) {
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
            : 'Your withdrawal is with Monnify for final confirmation.';

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
                      SizedBox(height: AppSpacing.md),
                      Text(
                        title,
                        style: AppTextStyles.headingL.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      SizedBox(height: AppSpacing.xs),
                      Text(
                        subtitle,
                        style: AppTextStyles.bodyM.copyWith(
                          color: AppColors.textSecondary,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      if (details != null) ...[
                        SizedBox(height: AppSpacing.lg),
                        _StatusLine(
                          label: 'Reference',
                          value: details!.reference,
                        ),
                        SizedBox(height: AppSpacing.sm),
                        _StatusLine(
                          label: 'Amount',
                          value:
                              '${details!.currency} ${NumberFormat('#,##0.00').format(double.tryParse(details!.amount) ?? 0)}',
                        ),
                        SizedBox(height: AppSpacing.sm),
                        _StatusLine(
                          label: 'Bank',
                          value: details!.bankName,
                        ),
                        SizedBox(height: AppSpacing.sm),
                        _StatusLine(
                          label: 'Account',
                          value:
                              '${details!.accountName} • ${details!.accountNumberMasked}',
                        ),
                      ],
                    ],
                  ),
                ),
                SizedBox(height: AppSpacing.lg),
                _CompletionActions(
                  onViewReceipt: () {
                    if (details == null) return;
                    context.push(
                      AppRoutes.withdrawReceiptFor(details!.reference),
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
              SizedBox(width: AppSpacing.md),
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
                    SizedBox(height: 2),
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
          SizedBox(height: AppSpacing.md),
          _StatusLine(label: 'Reference', value: details.reference),
          SizedBox(height: AppSpacing.sm),
          _StatusLine(
            label: 'Amount',
            value: '${details.currency} $amount',
          ),
          SizedBox(height: AppSpacing.sm),
          _StatusLine(label: 'Account', value: details.accountName),
          SizedBox(height: AppSpacing.sm),
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
    final resendButton = OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
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
        minimumSize: const Size.fromHeight(54),
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
              SizedBox(height: AppSpacing.sm),
              authorizeButton,
            ],
          );
        }

        return Row(
          children: [
            Expanded(child: resendButton),
            SizedBox(width: AppSpacing.sm),
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
    final receiptButton = FilledButton.icon(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
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
        minimumSize: const Size.fromHeight(54),
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
              SizedBox(height: AppSpacing.sm),
              homeButton,
            ],
          );
        }

        return Row(
          children: [
            Expanded(child: receiptButton),
            SizedBox(width: AppSpacing.sm),
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
            SizedBox(height: AppSpacing.md),
            Text(
              'Could not load this withdrawal',
              style: AppTextStyles.labelL,
              textAlign: TextAlign.center,
            ),
            SizedBox(height: AppSpacing.xs),
            Text(
              'Refresh the page and try again.',
              style: AppTextStyles.bodyM.copyWith(
                color: AppColors.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: AppSpacing.lg),
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
