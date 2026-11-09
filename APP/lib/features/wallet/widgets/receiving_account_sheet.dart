import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/wallet_service.dart';
import '../../auth/widgets/tp_button.dart';
import 'account_setup_presenter.dart';

/// Read-only account details. Provisioning retains the existing consent flow.
class ReceivingAccountSheet extends StatefulWidget {
  final WalletService? walletService;
  final bool funding;
  const ReceivingAccountSheet(
      {super.key, this.walletService, this.funding = false});

  @override
  State<ReceivingAccountSheet> createState() => _ReceivingAccountSheetState();
}

class _ReceivingAccountSheetState extends State<ReceivingAccountSheet> {
  late final _service = widget.walletService ?? WalletService();
  late Future<List<VirtualAccountData>> _accounts =
      _service.fetchVirtualAccounts();
  bool _copied = false;

  void _reload() => setState(() {
        _copied = false;
        _accounts = _service.fetchVirtualAccounts();
      });

  Future<void> _copy(String number) async {
    try {
      await Clipboard.setData(ClipboardData(text: number.trim()));
      if (!mounted) return;
      setState(() => _copied = true);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('Account number copied')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(
            content: Text('Could not copy the account number. Try again.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      color: AppColors.surface,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      clipBehavior: Clip.antiAlias,
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 12, 0),
              child: Row(children: [
                const SizedBox(width: 36),
                Expanded(
                    child: Center(
                        child: Container(
                            width: 40,
                            height: 4,
                            decoration: BoxDecoration(
                                color: AppColors.border,
                                borderRadius: BorderRadius.circular(4))))),
                IconButton(
                    tooltip: 'Close account details',
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded)),
              ]),
            ),
            Flexible(
                child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                        child: Container(
                            width: 64,
                            height: 64,
                            decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: .09),
                                shape: BoxShape.circle),
                            child: Icon(Icons.account_balance_wallet_outlined,
                                color: AppColors.primary, size: 30))),
                    const SizedBox(height: 20),
                    Text(
                        widget.funding
                            ? 'Fund your wallet'
                            : 'Your NGN account',
                        style: AppTextStyles.headingL
                            .copyWith(fontWeight: FontWeight.w800),
                        textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    Text('Transfer naira to your personal receiving account.',
                        style: AppTextStyles.bodyM,
                        textAlign: TextAlign.center),
                    const SizedBox(height: 28),
                    FutureBuilder<List<VirtualAccountData>>(
                      future: _accounts,
                      builder: (context, snapshot) {
                        if (snapshot.connectionState != ConnectionState.done) {
                          return const Padding(
                              padding: EdgeInsets.all(32),
                              child: Center(
                                  child: CircularProgressIndicator(
                                      semanticsLabel:
                                          'Loading account details')));
                        }
                        if (snapshot.hasError) {
                          return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                    'Your account details could not load. Check your connection and try again.',
                                    style: AppTextStyles.bodyM,
                                    textAlign: TextAlign.center),
                                const SizedBox(height: 20),
                                TpButton(label: 'Try again', onTap: _reload),
                              ]);
                        }
                        final accounts =
                            (snapshot.data ?? const <VirtualAccountData>[])
                                .where((a) =>
                                    a.provider.toUpperCase() == 'PAYSTACK' &&
                                    a.currency.toUpperCase() == 'NGN' &&
                                    a.status.toUpperCase() == 'ACTIVE' &&
                                    a.accountNumber.trim().isNotEmpty);
                        if (accounts.isEmpty) {
                          return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Icon(Icons.account_balance_outlined,
                                    color: AppColors.textHint, size: 36),
                                const SizedBox(height: 12),
                                Text(
                                    'Your receiving account is not available yet.',
                                    style: AppTextStyles.labelL,
                                    textAlign: TextAlign.center),
                                const SizedBox(height: 8),
                                Text(
                                    'View your setup status or complete verification to request your account.',
                                    style: AppTextStyles.bodyM,
                                    textAlign: TextAlign.center),
                                const SizedBox(height: 16),
                                TpButton(
                                    label: 'View account setup',
                                    onTap: () => context
                                        .push(AppRoutes.receivingAccountSetup)),
                              ]);
                        }
                        final account = accounts.first;
                        return Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Container(
                                  padding: const EdgeInsets.all(16),
                                  decoration: BoxDecoration(
                                      color: AppColors.primary
                                          .withValues(alpha: .07),
                                      borderRadius: BorderRadius.circular(12)),
                                  child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Icon(Icons.info_outline_rounded,
                                            color: AppColors.primary, size: 22),
                                        const SizedBox(width: 12),
                                        Expanded(
                                            child: Text(
                                                AccountSetupCopy
                                                    .walletFundingPurpose,
                                                style: AppTextStyles.bodyS)),
                                      ])),
                              const SizedBox(height: 16),
                              _AccountLine(
                                  icon: Icons.credit_card_outlined,
                                  label: 'Account number',
                                  value: account.accountNumber,
                                  prominent: true,
                                  trailing: IconButton(
                                    style: IconButton.styleFrom(
                                      minimumSize: const Size.square(48),
                                    ),
                                    tooltip: _copied
                                        ? 'Account number copied'
                                        : 'Copy account number',
                                    icon: Icon(_copied
                                        ? Icons.check_rounded
                                        : Icons.copy_rounded),
                                    onPressed: () =>
                                        _copy(account.accountNumber),
                                  )),
                              const SizedBox(height: 16),
                              _AccountLine(
                                  icon: Icons.account_balance_outlined,
                                  label: 'Bank name',
                                  value: account.bankName),
                              const SizedBox(height: 16),
                              _AccountLine(
                                  icon: Icons.person_outline_rounded,
                                  label: 'Account name',
                                  value: account.accountName),
                              const SizedBox(height: 28),
                              OutlinedButton(
                                  onPressed: () => context
                                      .push(AppRoutes.receivingAccountSetup),
                                  child: const Text(
                                      'View deposits & account status')),
                            ]);
                      },
                    ),
                    if (widget.funding) ...[
                      const SizedBox(height: 12),
                      OutlinedButton(
                          onPressed: () => context.push(AppRoutes.fundCheckout),
                          child: const Text('More funding options')),
                    ],
                  ]),
            )),
          ],
        ),
      ),
    );
  }
}

class _AccountLine extends StatelessWidget {
  final IconData icon;
  final String label, value;
  final bool prominent;
  final Widget? trailing;
  const _AccountLine(
      {required this.icon,
      required this.label,
      required this.value,
      this.prominent = false,
      this.trailing});
  @override
  Widget build(BuildContext context) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (!prominent) ...[
          Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: .08),
                  borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, color: AppColors.primary, size: 22)),
          const SizedBox(width: 16),
        ],
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: AppTextStyles.bodyS),
          const SizedBox(height: 4),
          SelectableText(value.isEmpty ? 'Unavailable' : value,
              style: prominent
                  ? AppTextStyles.headingL
                      .copyWith(fontWeight: FontWeight.w800, letterSpacing: .5)
                  : AppTextStyles.labelL),
        ])),
        if (trailing != null) trailing!,
      ]);
}

/// A route-backed modal keeps deep links and back navigation working normally.
class AccountSheetPage extends Page<void> {
  final Widget child;
  const AccountSheetPage({required this.child, super.key});

  @override
  Route<void> createRoute(BuildContext context) => ModalBottomSheetRoute<void>(
        settings: this,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        barrierLabel:
            MaterialLocalizations.of(context).modalBarrierDismissLabel,
        modalBarrierColor: Colors.black54,
        constraints: const BoxConstraints(maxWidth: 600),
        builder: (_) => FractionallySizedBox(heightFactor: .64, child: child),
      );
}
