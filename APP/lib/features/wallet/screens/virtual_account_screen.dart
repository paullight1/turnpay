import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/state/wallet_refresh_signal.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../services/api_client.dart';
import '../../../services/auth_service.dart';
import '../../../services/home_data_service.dart';
import '../../../services/kyc_service.dart';
import '../../home/screens/kyc_verification_screen.dart';

/// The account request entry point. Issued accounts and provisioning requests
/// are separate server-owned states; neither is inferred from a button click.
class VirtualAccountScreen extends StatefulWidget {
  final HomeDataService service;

  const VirtualAccountScreen({super.key, required this.service});

  @override
  State<VirtualAccountScreen> createState() => _VirtualAccountScreenState();
}

class _VirtualAccountScreenState extends State<VirtualAccountScreen>
    with WidgetsBindingObserver {
  final _attempt = MoneyAttemptIdempotency();
  late Future<_AccountState> _future;
  Timer? _timer;
  int _generation = 0;
  bool _submitting = false;
  bool _consentOpen = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _future = _load();
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _timer?.cancel();
    if (state == AppLifecycleState.resumed && !_submitting) _refresh();
  }

  Future<_AccountState> _load() async {
    final generation = ++_generation;
    _timer?.cancel();
    final accounts = await widget.service.fetchVirtualAccounts();
    HomeVirtualAccount? account;
    var accountPending = false;
    for (final candidate in accounts) {
      if (candidate.provider.toUpperCase() == 'PAYSTACK' &&
          candidate.currency.toUpperCase() == 'NGN' &&
          candidate.status.toUpperCase() == 'PENDING') {
        accountPending = true;
      }
      if (candidate.provider.toUpperCase() == 'PAYSTACK' &&
          candidate.currency.toUpperCase() == 'NGN' &&
          candidate.status.toUpperCase() == 'ACTIVE') {
        account = candidate;
        break;
      }
    }
    // An existing account remains usable when an auxiliary status service is
    // unavailable. Full numbers are revealed only by the authenticated server.
    if (account != null) return _AccountState(account: account);
    final results = await Future.wait<Object>([
      widget.service.fetchKycOverview(),
      widget.service.fetchVirtualAccountProvisioning(),
    ]);
    final state = _AccountState(
      accountPending: accountPending,
      identity: results[0] as KycOverview,
      provisioning: results[1] as HomeVirtualAccountProvisioning,
    );
    if (state.pending && mounted && generation == _generation) {
      _timer = Timer(const Duration(seconds: 15), () {
        if (mounted && generation == _generation && !_submitting) _refresh();
      });
    }
    return state;
  }

  Future<void> _refresh() async {
    if (!mounted || _submitting) return;
    setState(() => _future = _load());
    try {
      await _future;
      if (mounted) setState(() => _error = null);
    } catch (_) {
      // The FutureBuilder shows the retry state.
    }
  }

  Future<void> _verifyIdentity() async {
    await Navigator.of(context).push<void>(MaterialPageRoute(
      builder: (_) => const KycVerificationScreen(),
    ));
    if (mounted) await _refresh();
  }

  Future<void> _create() async {
    if (_submitting || _consentOpen) return;
    // Lock before opening consent as well as during the request.
    _consentOpen = true;
    try {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Create your receiving account'),
          content: const Text(
            'I authorize TRUSTPAY to create a dedicated NGN receiving account with Paystack using my verified identity. Incoming transfers are credited after confirmation.',
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Not now')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Authorize setup')),
          ],
        ),
      );
      if (accepted != true || !mounted) return;
      setState(() {
        _submitting = true;
        _error = null;
      });
      final account = await widget.service.provisionVirtualAccount(
        consentAccepted: true,
        idempotencyKey: _attempt.keyFor('paystack-receiving-account|NGN'),
      );
      _attempt.markFinalOutcome();
      if (!mounted) return;
      final ready = account.status.toUpperCase() == 'ACTIVE';
      if (ready) walletRefreshSignal.bump();
      setState(() {
        _future =
            ready ? Future.value(_AccountState(account: account)) : _load();
      });
    } catch (error) {
      if (error is DioException) {
        final status = error.response?.statusCode ?? 0;
        if (status >= 400 && status < 500) _attempt.markFinalOutcome();
      }
      if (mounted) {
        setState(() => _error = authErrorMessage(error,
            'Could not create your receiving account. Check status before retrying.'));
      }
    } finally {
      _consentOpen = false;
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _copy(String value) async {
    try {
      await Clipboard.setData(ClipboardData(text: value));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Account number copied')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Could not copy. Select the account number above.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
          label: 'Receiving account',
          onBack: () {
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            } else {
              context.go(AppRoutes.home);
            }
          },
          menuActions: [
            TpPageMenuAction(
                label: 'Refresh status',
                icon: Icons.refresh_rounded,
                onTap: _refresh),
          ]),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            FutureBuilder<_AccountState>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting &&
                    !snapshot.hasData) {
                  return const Padding(
                      padding: EdgeInsets.all(48),
                      child: Center(child: CircularProgressIndicator()));
                }
                if (snapshot.hasError || !snapshot.hasData) {
                  return _panel(children: [
                    Text('Account status unavailable',
                        style: AppTextStyles.headingM),
                    const SizedBox(height: 12),
                    Text(
                        authErrorMessage(snapshot.error ?? 'Status unavailable',
                            'Check your connection and try again.'),
                        style: AppTextStyles.bodyM),
                    const SizedBox(height: 20),
                    OutlinedButton.icon(
                        onPressed: _refresh,
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Retry')),
                  ]);
                }
                return _content(snapshot.data!);
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(_AccountState state) {
    final account = state.account;
    final ready = account != null;
    final identityPending =
        state.identity?.providerValidationStatus == 'PENDING';
    final identityVerified =
        state.identity?.providerValidationStatus == 'VERIFIED';
    final pending = state.pending;
    final needsReview = state.provisioning?.isActionRequired == true;
    final title = ready
        ? 'Your NGN account is ready'
        : pending
            ? 'We’re preparing your account'
            : identityVerified
                ? 'Receive money into your wallet'
                : 'Your account starts with verification';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
            color: AppColors.surface,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(24)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(
              ready
                  ? Icons.account_balance_rounded
                  : pending
                      ? Icons.schedule_rounded
                      : Icons.account_balance_wallet_outlined,
              size: 36,
              color: AppColors.primary),
          const SizedBox(height: 20),
          Text('NGN · BANK TRANSFER', style: AppTextStyles.caption),
          const SizedBox(height: 8),
          Text(title, style: AppTextStyles.headingL),
          const SizedBox(height: 12),
          Text(
              ready
                  ? 'Transfer naira to these details from any Nigerian bank.'
                  : 'A personal account number for adding naira to your TRUSTPAY wallet.',
              style: AppTextStyles.bodyM),
          if (ready) ...[
            const SizedBox(height: 24),
            Text(account.bankName, style: AppTextStyles.labelM),
            const SizedBox(height: 8),
            SelectableText(account.displayAccountNumber,
                style: AppTextStyles.headingL.copyWith(letterSpacing: 2)),
            const SizedBox(height: 8),
            Text(account.accountName, style: AppTextStyles.bodyM),
            const SizedBox(height: 20),
            if (account.accountNumber.isNotEmpty)
              FilledButton.icon(
                  onPressed: () => _copy(account.accountNumber),
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Copy account number'))
            else
              OutlinedButton(
                  onPressed: _verifyIdentity,
                  child: const Text('Verify identity to reveal details')),
          ],
        ]),
      ),
      const SizedBox(height: 24),
      if (!ready)
        _panel(children: [
          Text('Account setup', style: AppTextStyles.headingM),
          const SizedBox(height: 20),
          _step(
              '1',
              'Verify your identity',
              identityVerified
                  ? 'BVN and linked bank confirmed'
                  : identityPending
                      ? 'Your identity check is under review'
                      : 'Use your BVN and the bank account linked to it',
              identityVerified),
          const SizedBox(height: 20),
          _step(
              '2',
              'Create your receiving account',
              pending
                  ? 'Request received. Checking for your account details.'
                  : 'Authorize setup after your identity is confirmed',
              false),
          const SizedBox(height: 20),
          _step('3', 'Add money by bank transfer',
              'Your balance updates after the transfer is confirmed', false),
          const SizedBox(height: 24),
          if (needsReview) ...[
            Text(
                state.provisioning!.message.isEmpty
                    ? 'Account setup needs attention. Retry or contact support.'
                    : state.provisioning!.message,
                style: AppTextStyles.bodyM),
            const SizedBox(height: 16),
          ],
          if (pending || identityPending)
            OutlinedButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Check status'))
          else if (!identityVerified)
            FilledButton.icon(
                onPressed: _verifyIdentity,
                icon: const Icon(Icons.verified_user_outlined),
                label: const Text('Verify identity'))
          else
            FilledButton.icon(
                onPressed: _submitting ? null : _create,
                icon: _submitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.add_rounded),
                label: Text(_submitting
                    ? 'Creating account…'
                    : needsReview
                        ? 'Retry account setup'
                        : 'Create receiving account')),
        ]),
      if (_error != null) ...[
        const SizedBox(height: 16),
        Semantics(
            liveRegion: true,
            child: Text(_error!,
                style: AppTextStyles.bodyM.copyWith(color: AppColors.error))),
        TextButton(
            onPressed: _refresh, child: const Text('Check account status')),
      ],
      const SizedBox(height: 24),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.shield_outlined, size: 20, color: AppColors.textSecondary),
        const SizedBox(width: 12),
        Expanded(
            child: Text(
                'NGN transfers only. Your wallet is credited after the payment is confirmed. Never share your PIN or OTP to receive money.',
                style: AppTextStyles.bodyS)),
      ]),
    ]);
  }

  Widget _step(String number, String title, String detail, bool complete) =>
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
              radius: 16,
              backgroundColor: complete
                  ? AppColors.success.withValues(alpha: .12)
                  : AppColors.surfaceVariant,
              child: complete
                  ? Icon(Icons.check_rounded,
                      size: 18, color: AppColors.success)
                  : Text(number, style: AppTextStyles.labelS)),
          const SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title, style: AppTextStyles.labelM),
                const SizedBox(height: 4),
                Text(detail, style: AppTextStyles.bodyS)
              ])),
        ],
      );

  Widget _panel({required List<Widget> children}) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
            color: AppColors.surface,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(20)),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );
}

class _AccountState {
  final bool accountPending;
  final HomeVirtualAccount? account;
  final KycOverview? identity;
  final HomeVirtualAccountProvisioning? provisioning;
  const _AccountState(
      {this.account,
      this.identity,
      this.provisioning,
      this.accountPending = false});
  bool get pending =>
      accountPending ||
      provisioning?.isPending == true ||
      identity?.providerValidationStatus == 'PENDING';
}
