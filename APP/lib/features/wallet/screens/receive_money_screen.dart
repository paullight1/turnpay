import '../../ghana/ghana_money_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';

import '../../../core/config/launch_capabilities.dart';
import '../../../core/router/app_router.dart';
import '../../../core/state/wallet_refresh_signal.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_empty_state.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/widgets/tp_snackbar.dart';
import '../../../services/home_data_service.dart';
import '../../../services/api_client.dart';
import '../../../services/kyc_service.dart';
import '../../../services/wallet_service.dart';
import '../widgets/account_setup_presenter.dart';
import '../../home/screens/dashboard_detail_screen.dart';

class ReceiveMoneyScreen extends StatefulWidget {
  final WalletService walletService;
  final HomeDataService homeDataService;

  ReceiveMoneyScreen({
    super.key,
    WalletService? walletService,
    HomeDataService? homeDataService,
  })  : walletService = walletService ?? WalletService(),
        homeDataService = homeDataService ?? HomeDataService();

  @override
  State<ReceiveMoneyScreen> createState() => _ReceiveMoneyScreenState();
}

class _ReceiveMoneyScreenState extends State<ReceiveMoneyScreen> {
  late Future<List<VirtualAccountData>> _accountsFuture;
  late Future<HomeVirtualAccountProvisioning> _provisioningFuture;
  late Future<KycOverview?> _kycFuture;
  late Future<List<DepositRecord>> _depositsFuture;
  final _setupAttempt = MoneyAttemptIdempotency();
  bool _retryingSetup = false;
  String? _setupError;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    _accountsFuture = widget.walletService.fetchVirtualAccounts();
    _provisioningFuture =
        widget.homeDataService.fetchVirtualAccountProvisioning();
    _kycFuture = _fetchKycOverview();
    _depositsFuture = widget.walletService.fetchRecentDeposits(limit: 20);
    // Provisioning status is supplementary when an active account is already
    // available. Observe a fast failure so legacy/default test doubles and
    // older deployments do not surface an unhandled Future error.
    _provisioningFuture.catchError((Object _, StackTrace __) {
      return const HomeVirtualAccountProvisioning(
        provider: 'PAYSTACK',
        status: 'NOT_REQUESTED',
      );
    });
    // The deposit FutureBuilder is mounted only after accounts load. Observe
    // failures immediately so a fast failed request is not unhandled before
    // that nested builder can render its unavailable state.
    _depositsFuture.catchError((Object _, StackTrace __) {
      return <DepositRecord>[];
    });
  }

  Future<KycOverview?> _fetchKycOverview() async {
    try {
      return await widget.homeDataService.fetchKycOverview();
    } catch (_) {
      // KYC is supplementary here. The account/provisioning state remains
      // authoritative if this optional status read is unavailable.
      return null;
    }
  }

  Future<void> _openAccountSetup() async {
    await Navigator.of(context).push<void>(MaterialPageRoute(
      builder: (_) => DashboardDetailScreen(
        kind: DashboardDetailKind.virtualAccount,
        homeDataService: widget.homeDataService,
      ),
    ));
    if (mounted) _refresh();
  }

  Future<void> _openKyc() async {
    await context.push(AppRoutes.kyc);
    if (mounted) _refresh();
  }

  Future<void> _retryAccountSetup() async {
    if (_retryingSetup) return;
    setState(() {
      _retryingSetup = true;
      _setupError = null;
    });
    try {
      // This action is offered only for an existing, consented setup request
      // with verified BVN. New requests retain their explicit consent flow.
      final account = await widget.homeDataService.provisionVirtualAccount(
        consentAccepted: true,
        idempotencyKey: _setupAttempt.keyFor('paystack-receiving-account|NGN'),
      );
      _setupAttempt.markFinalOutcome();
      if (account.status.toUpperCase() == 'ACTIVE') {
        walletRefreshSignal.bump();
      }
    } catch (error) {
      if (error is DioException &&
          const [400, 401, 403, 404, 422]
              .contains(error.response?.statusCode)) {
        _setupAttempt.markFinalOutcome();
      }
      if (mounted) {
        _setupError =
            'Could not confirm your account setup. Refresh status or try again.';
      }
    } finally {
      if (mounted) {
        setState(() {
          _retryingSetup = false;
          // Reconcile uncertain outcomes and reveal only server-issued details.
          _loadData();
        });
      }
    }
  }

  void _refresh() {
    if (_retryingSetup) return;
    setState(() {
      _setupError = null;
      _loadData();
    });
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'Receive Money',
        menuActions: [
          if (LaunchCapabilities.ghanaCedisWalletEnabled)
            TpPageMenuAction(
                label: 'Receive cedis',
                icon: Icons.payments_outlined,
                onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => const GhanaMoneyScreen()))),
          TpPageMenuAction(
            label: 'Refresh',
            icon: Icons.refresh_rounded,
            onTap: _refresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.surface,
        onRefresh: () async {
          _refresh();
          try {
            await Future.wait([_accountsFuture, _provisioningFuture]);
          } catch (_) {
            // Individual builders display retry states.
          }
        },
        child: FutureBuilder<List<VirtualAccountData>>(
          future: _accountsFuture,
          builder: (context, accountsSnapshot) {
            // Loading: no account data has arrived yet. Never fall through to
            // the "No receiving account yet" empty state while a fetch is pending.
            if (accountsSnapshot.connectionState == ConnectionState.waiting &&
                !accountsSnapshot.hasData) {
              return const _ReceiveMoneyLoadingState();
            }

            // Error: the request failed and we have no data to show. Surface a
            // retry instead of masking the failure as "you have no account".
            if (accountsSnapshot.hasError && !accountsSnapshot.hasData) {
              return _ReceiveMoneyErrorState(
                message: 'Could not load your receiving account',
                onRetry: _refresh,
              );
            }

            final accounts = (accountsSnapshot.data ?? [])
                .where(
                  (account) =>
                      account.provider.toUpperCase() == 'PAYSTACK' &&
                      account.currency.toUpperCase() == 'NGN',
                )
                .toList(growable: false);
            final hasPendingAccount = accounts.any(
              (account) =>
                  account.status.toUpperCase() == 'PENDING' &&
                  account.accountNumber.trim().isEmpty,
            );
            final hasAccount = accounts.any(
              (account) => account.status.toUpperCase() == 'ACTIVE',
            );
            final hasShareableAccount = accounts.any(
              (account) =>
                  account.status.toUpperCase() == 'ACTIVE' &&
                  account.accountNumber.trim().isNotEmpty,
            );

            // Until a receiving account exists, keep this screen focused on
            // the one action available: requesting the account. Deposit
            // history is only meaningful after an account can receive funds.
            if (!hasAccount) {
              return FutureBuilder<HomeVirtualAccountProvisioning>(
                future: _provisioningFuture,
                builder: (context, provisioningSnapshot) {
                  if (provisioningSnapshot.connectionState ==
                      ConnectionState.waiting) {
                    return const _ReceiveMoneyLoadingState();
                  }
                  if (provisioningSnapshot.hasError) {
                    return _ReceiveMoneyErrorState(
                      message: 'Could not check account setup status',
                      onRetry: _refresh,
                    );
                  }
                  final provisioning = provisioningSnapshot.data;
                  final actionRequired = provisioning?.isActionRequired == true;
                  if (hasPendingAccount ||
                      provisioning?.isPending == true ||
                      provisioning?.isWaitingForKyc == true ||
                      actionRequired) {
                    return FutureBuilder<KycOverview?>(
                      future: _kycFuture,
                      builder: (context, kycSnapshot) {
                        final overview = kycSnapshot.data;
                        final providerStatus = overview
                            ?.providerValidationStatus
                            ?.trim()
                            .toUpperCase();
                        final bvnVerified = providerStatus == 'VERIFIED' ||
                            (providerStatus == null &&
                                overview?.status.toUpperCase() == 'VERIFIED');
                        return _ReceiveMoneyStateScroll(
                          centered: true,
                          child: _PaystackProvisioningCard(
                            waitingForKyc:
                                provisioning?.isWaitingForKyc == true,
                            bvnVerified: bvnVerified,
                            actionRequired: actionRequired,
                            isRetrying: _retryingSetup,
                            error: _setupError,
                            onRefresh: _refresh,
                            onRetry: bvnVerified
                                ? _retryAccountSetup
                                : _openAccountSetup,
                          ),
                        );
                      },
                    );
                  }
                  return FutureBuilder<KycOverview?>(
                    future: _kycFuture,
                    builder: (context, kycSnapshot) {
                      final overview = kycSnapshot.data;
                      final providerStatus = overview?.providerValidationStatus
                          ?.trim()
                          .toUpperCase();
                      final bvnVerified = providerStatus == 'VERIFIED' ||
                          (providerStatus == null &&
                              overview?.status.toUpperCase() == 'VERIFIED');
                      return _ReceiveMoneyStateScroll(
                        centered: true,
                        child: _NoVirtualAccountCard(
                          isRequesting: false,
                          bvnVerified: bvnVerified,
                          onRequest: _openAccountSetup,
                        ),
                      );
                    },
                  );
                },
              );
            }

            if (!hasShareableAccount) {
              return _ReceiveMoneyStateScroll(
                child: TpEmptyState(
                  variant: TpIllustrationVariant.kyc,
                  illustrationAsset:
                      'assets/images/empty_states/receive-account.svg',
                  title: 'Verify your identity',
                  message:
                      'Complete KYC to get your receiving account details.',
                  primaryActionLabel: 'Complete KYC',
                  onPrimaryAction: _openKyc,
                  illustrationSize: 176,
                  compact: true,
                ),
              );
            }

            return FutureBuilder<List<DepositRecord>>(
              future: _depositsFuture,
              builder: (context, depositsSnapshot) {
                return CustomScrollView(
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
                          // Virtual account card
                          if (hasAccount)
                            ...accounts.map((account) {
                              return Padding(
                                padding: const EdgeInsets.only(
                                  bottom: AppSpacing.md,
                                ),
                                child: _VirtualAccountCard(
                                  account: account,
                                  onCompleteKyc: _openKyc,
                                ),
                              );
                            })
                          else
                            _NoVirtualAccountCard(
                              isRequesting: false,
                              bvnVerified: null,
                              onRequest: _openAccountSetup,
                            ),

                          // "How to receive money" refers to the account number
                          // shown above, so only render it once the user has an
                          // account to share.
                          if (hasShareableAccount) ...[
                            const SizedBox(height: AppSpacing.md),

                            // Deposit instructions
                            Container(
                              padding: const EdgeInsets.all(AppSpacing.md),
                              decoration: BoxDecoration(
                                color: AppColors.surfaceVariant,
                                borderRadius:
                                    BorderRadius.circular(AppRadius.sm),
                                border: Border.all(
                                  color: AppColors.border,
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Icon(
                                        Icons.info_outline_rounded,
                                        color: AppColors.primary,
                                        size: 20,
                                      ),
                                      const SizedBox(width: AppSpacing.sm),
                                      Text(
                                        'How to receive money',
                                        style: AppTextStyles.labelM,
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: AppSpacing.md),
                                  const _InstructionStep(
                                    number: '1',
                                    text:
                                        'Share your TrustPay NGN account number above with the sender',
                                  ),
                                  const SizedBox(height: AppSpacing.sm),
                                  const _InstructionStep(
                                    number: '2',
                                    text:
                                        'The sender transfers money to this account number from any Nigerian bank or mobile app',
                                  ),
                                  const SizedBox(height: AppSpacing.sm),
                                  const _InstructionStep(
                                    number: '3',
                                    text:
                                        'Once the transfer is confirmed, your TrustPay wallet is credited automatically',
                                  ),
                                  const SizedBox(height: AppSpacing.sm),
                                  const _InstructionStep(
                                    number: '4',
                                    text:
                                        'Bank transfers usually arrive within 5–30 minutes during business hours',
                                  ),
                                ],
                              ),
                            ),
                          ],

                          if (depositsSnapshot.data?.isNotEmpty ?? false) ...[
                            const SizedBox(height: AppSpacing.lg),
                            Text('Recent Deposits',
                                style: AppTextStyles.headingM),
                            const SizedBox(height: AppSpacing.md),
                          ],
                        ],
                      ),
                    ),

                    // Deposits section (loading / error / empty / list)
                    if (depositsSnapshot.hasError ||
                        (depositsSnapshot.data?.isNotEmpty ?? false))
                      _buildDepositsSliver(depositsSnapshot),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }

  Widget _buildDepositsSliver(AsyncSnapshot<List<DepositRecord>> snapshot) {
    // Loading: history is still being fetched and nothing has arrived yet.
    if (snapshot.connectionState == ConnectionState.waiting &&
        !snapshot.hasData) {
      return SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        sliver: SliverList.separated(
          itemCount: 4,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) => ShimmerBlock(
            width: double.infinity,
            height: 68,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
        ),
      );
    }

    // Error: the fetch failed and we have no cached history. Show a retry
    // affordance instead of a misleading "no deposits yet" empty state.
    if (snapshot.hasError || !snapshot.hasData) {
      return SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        sliver: SliverToBoxAdapter(
          child: _DepositsErrorCard(onRetry: _refresh),
        ),
      );
    }

    final deposits = snapshot.data!;

    // Genuinely empty history.
    if (deposits.isEmpty) {
      return SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        sliver: SliverToBoxAdapter(
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Column(
              children: [
                const TpIllustration(
                  variant: TpIllustrationVariant.emptyTransactions,
                  size: 128,
                  semanticLabel: 'No deposits yet',
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'No deposits yet',
                  style: AppTextStyles.labelM,
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Deposits will appear here once someone sends money to your TrustPay account',
                  style: AppTextStyles.bodyS,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      );
    }

    // History available.
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      sliver: SliverList.separated(
        itemCount: deposits.length,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (context, index) {
          final deposit = deposits[index];
          return _DepositRow(deposit: deposit);
        },
      ),
    );
  }
}

class _VirtualAccountCard extends StatelessWidget {
  final VirtualAccountData account;
  final VoidCallback onCompleteKyc;

  const _VirtualAccountCard({
    required this.account,
    required this.onCompleteKyc,
  });

  String get _displayAccountNumber {
    return account.accountNumber.trim();
  }

  Future<void> _copyAccountNumber(BuildContext context) async {
    final value = _displayAccountNumber;
    if (value.isEmpty) return;

    await Clipboard.setData(ClipboardData(text: value));
    if (!context.mounted) return;
    showTpSnackbar(
      context,
      'Account number copied',
      type: TpSnackbarType.success,
    );
    // showTpSnackbar already fires a success haptic.
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final isActive = account.status.toUpperCase() == 'ACTIVE';
    final accountNumber = _displayAccountNumber;

    if (accountNumber.isEmpty) {
      return _KycAccountNumberNotice(onCompleteKyc: onCompleteKyc);
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(
                  Icons.account_balance_rounded,
                  color: AppColors.primary,
                  size: 20,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      account.bankName.isEmpty
                          ? 'TrustPay NGN account'
                          : account.bankName,
                      style: AppTextStyles.labelM.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: isActive
                                ? AppColors.success
                                : AppColors.warning,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        Flexible(
                          child: Text(
                            isActive
                                ? 'Active receiving account'
                                : account.status,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.caption.copyWith(
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  border: Border.all(color: AppColors.border),
                ),
                child: Text(
                  account.currency,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              )
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _AccountDetailRow(
            label: 'Account name',
            value: account.accountName.isEmpty
                ? 'TrustPay user'
                : account.accountName,
          ),
          const SizedBox(height: AppSpacing.sm),
          if (accountNumber.isEmpty)
            _KycAccountNumberNotice(onCompleteKyc: onCompleteKyc)
          else ...[
            TapScale(
              onTap: () => _copyAccountNumber(context),
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: _AccountDetailRow(
                        label: 'Account number',
                        value: accountNumber,
                        isLarge: true,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Icon(
                      Icons.copy_rounded,
                      color: AppColors.primary,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _copyAccountNumber(context),
                icon: const Icon(Icons.copy_rounded, size: 18),
                label: const Text('Copy account number'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  side: BorderSide(
                    color: AppColors.primary.withValues(alpha: 0.35),
                  ),
                  minimumSize: const Size.fromHeight(56),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.button),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _KycAccountNumberNotice extends StatelessWidget {
  final VoidCallback onCompleteKyc;

  const _KycAccountNumberNotice({required this.onCompleteKyc});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.lock_outline_rounded, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Verify your identity',
                  style: AppTextStyles.labelM,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Complete KYC to get your receiving account details.',
            style: AppTextStyles.bodyS.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: onCompleteKyc,
              icon: const Icon(Icons.verified_user_rounded, size: 18),
              label: const Text('Complete KYC'),
            ),
          ),
        ],
      ),
    );
  }
}

class _AccountDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isLarge;

  const _AccountDetailRow({
    required this.label,
    required this.value,
    this.isLarge = false,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.caption.copyWith(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          maxLines: isLarge ? 1 : 2,
          overflow: TextOverflow.ellipsis,
          style: (isLarge ? AppTextStyles.headingL : AppTextStyles.labelM)
              .copyWith(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w900,
            letterSpacing: 0,
          ),
        ),
      ],
    );
  }
}

class _NoVirtualAccountCard extends StatelessWidget {
  final bool isRequesting;
  final bool? bvnVerified;
  final VoidCallback onRequest;

  const _NoVirtualAccountCard(
      {required this.isRequesting,
      required this.bvnVerified,
      required this.onRequest});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 560),
      child: SizedBox(
        width: double.infinity,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
                child: Container(
              width: 104,
              height: 104,
              decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: .10),
                  shape: BoxShape.circle),
              child: Icon(Icons.account_balance_rounded,
                  color: AppColors.primary, size: 52),
            )),
            const SizedBox(height: 32),
            Text('Your money,\nyour TrustPay account',
                textAlign: TextAlign.center,
                style: AppTextStyles.headingL.copyWith(
                    fontSize: 32, fontWeight: FontWeight.w800, height: 1.15)),
            const SizedBox(height: 16),
            Text(
                'Receive bank transfers straight into your wallet with a personal NGN account.',
                textAlign: TextAlign.center,
                style: AppTextStyles.bodyL),
            const SizedBox(height: 32),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                  minimumSize: const Size(double.infinity, 56)),
              onPressed: isRequesting
                  ? null
                  : () {
                      Haptics.medium();
                      onRequest();
                    },
              icon: isRequesting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.add_rounded, size: 22),
              label: Text(
                  isRequesting
                      ? 'Creating account…'
                      : 'Create TrustPay account',
                  style: const TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 16),
            Text(
                bvnVerified == true
                    ? 'Authorize setup now. Your bank details will appear here once ready.'
                    : 'Start setup now. Your account activates after identity verification.',
                textAlign: TextAlign.center,
                style: AppTextStyles.bodyS),
          ],
        ),
      ),
    );
  }
}

/// Empty states fill the available viewport and remain scrollable on small
/// screens or with larger text. Progress panels retain their natural height.
class _ReceiveMoneyStateScroll extends StatelessWidget {
  final Widget child;
  final bool centered;

  const _ReceiveMoneyStateScroll({required this.child, this.centered = false});

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
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
          sliver: centered
              ? SliverFillRemaining(
                  hasScrollBody: false, child: Center(child: child))
              : SliverToBoxAdapter(
                  child: Align(alignment: Alignment.topCenter, child: child)),
        ),
      ],
    );
  }
}

class _PaystackProvisioningCard extends StatelessWidget {
  final bool actionRequired;
  final bool waitingForKyc;
  final bool? bvnVerified;
  final bool isRetrying;
  final String? error;
  final VoidCallback onRefresh;
  final VoidCallback onRetry;

  const _PaystackProvisioningCard({
    required this.actionRequired,
    this.waitingForKyc = false,
    this.bvnVerified,
    this.isRetrying = false,
    this.error,
    required this.onRefresh,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 560),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              actionRequired
                  ? Icons.warning_amber_rounded
                  : Icons.schedule_rounded,
              size: 52,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              actionRequired
                  ? AccountSetupCopy.actionRequiredTitle
                  : waitingForKyc
                      ? 'Account request saved'
                      : 'TrustPay is preparing your NGN account',
              style: AppTextStyles.headingL,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              actionRequired
                  ? AccountSetupCopy.actionRequiredBody(
                      bvnVerified: bvnVerified)
                  : waitingForKyc
                      ? bvnVerified == true
                          ? AccountSetupCopy.stepTwoDetail(
                              identityVerified: true,
                              identityPending: false,
                              requestSaved: true,
                              accountPending: false,
                              actionRequired: false,
                            )
                          : AccountSetupCopy.waitingForKycBody
                      : AccountSetupCopy.pendingBody,
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.lg),
            if (error != null) ...[
              Text(error!,
                  style: AppTextStyles.bodyS.copyWith(color: AppColors.error),
                  textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.md),
            ],
            Wrap(
              alignment: WrapAlignment.center,
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                OutlinedButton.icon(
                  onPressed: isRetrying ? null : onRefresh,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Refresh status'),
                ),
                if (waitingForKyc)
                  FilledButton.icon(
                    onPressed: isRetrying ? null : onRetry,
                    icon: const Icon(Icons.arrow_forward_rounded),
                    label: Text(isRetrying
                        ? 'Preparing account…'
                        : bvnVerified == true
                            ? 'Continue setup'
                            : 'View account setup'),
                  ),
                if (actionRequired)
                  FilledButton.icon(
                    onPressed: isRetrying ? null : onRetry,
                    icon: isRetrying
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.refresh_rounded),
                    label: Text(isRetrying
                        ? 'Preparing account…'
                        : 'Try account setup again'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ReceiveMoneyLoadingState extends StatelessWidget {
  const _ReceiveMoneyLoadingState();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xxl,
      ),
      children: [
        // Virtual account card skeleton
        ShimmerBlock(
          width: double.infinity,
          height: 220,
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        const SizedBox(height: AppSpacing.xl),
        // "Recent Deposits" header skeleton
        ShimmerBlock(
          width: 160,
          height: 20,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        const SizedBox(height: AppSpacing.md),
        ...List.generate(4, (_) {
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ShimmerBlock(
              width: double.infinity,
              height: 68,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
          );
        }),
      ],
    );
  }
}

class _ReceiveMoneyErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ReceiveMoneyErrorState({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    // Scrollable so pull-to-refresh still works even in the error state.
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.xxl,
      ),
      children: [
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_rounded,
              color: AppColors.primary,
              size: 48,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              message,
              style: AppTextStyles.labelM,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Check your connection and try again.',
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      ],
    );
  }
}

class _DepositsErrorCard extends StatelessWidget {
  final VoidCallback onRetry;

  const _DepositsErrorCard({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        children: [
          Icon(
            Icons.cloud_off_rounded,
            color: AppColors.primary,
            size: 40,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Deposit history unavailable',
            style: AppTextStyles.labelM,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'We could not load your deposit history. Try again when you are online.',
            style: AppTextStyles.bodyS,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Retry'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: BorderSide(
                color: AppColors.primary.withValues(alpha: 0.35),
              ),
              minimumSize: const Size.fromHeight(56),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.button),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InstructionStep extends StatelessWidget {
  final String number;
  final String text;

  const _InstructionStep({
    required this.number,
    required this.text,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          alignment: Alignment.center,
          child: Text(
            number,
            style: AppTextStyles.caption.copyWith(
              color: AppColors.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Text(text, style: AppTextStyles.bodyM),
        ),
      ],
    );
  }
}

class _DepositRow extends StatelessWidget {
  final DepositRecord deposit;

  const _DepositRow({required this.deposit});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final symbol = deposit.currency == 'NGN' ? '₦' : 'GH₵';
    final formatted = _formatExactAmount(deposit.amountDecimalString);
    final dateFormatted = deposit.createdAt != null
        ? DateFormat('MMM d, HH:mm').format(deposit.createdAt!.toLocal())
        : 'recently';

    final statusColor = deposit.status.toUpperCase() == 'SUCCESS'
        ? AppColors.success
        : deposit.status.toUpperCase() == 'FAILED'
            ? AppColors.error
            : AppColors.warning;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(
              Icons.arrow_downward_rounded,
              color: statusColor,
              size: 20,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Bank Transfer', style: AppTextStyles.labelM),
                const SizedBox(height: 2),
                Text(dateFormatted, style: AppTextStyles.bodyS),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '$symbol$formatted',
                style: AppTextStyles.labelM.copyWith(
                  color: AppColors.success,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                deposit.status.toUpperCase(),
                style: AppTextStyles.caption.copyWith(
                  color: statusColor,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String _formatExactAmount(String decimalString) {
  final parts = decimalString.split('.');
  final rawWhole = parts.first;
  final isNegative = rawWhole.startsWith('-');
  var whole = isNegative ? rawWhole.substring(1) : rawWhole;
  while (whole.length > 1 && whole.startsWith('0')) {
    whole = whole.substring(1);
  }

  final grouped = StringBuffer();
  for (var index = 0; index < whole.length; index++) {
    if (index > 0 && (whole.length - index) % 3 == 0) {
      grouped.write(',');
    }
    grouped.write(whole[index]);
  }

  final fraction = parts.length > 1 ? parts[1].padRight(2, '0') : '00';
  return '${isNegative ? '-' : ''}$grouped.${fraction.substring(0, 2)}';
}
