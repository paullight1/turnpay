import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

String transferMoneyLabel(String amount, String currency) {
  final parts = amount.split('.');
  final whole = parts.first
      .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
  return '${currency == 'NGN' ? '₦' : 'GH₵'}$whole.${parts.length > 1 ? parts[1].padRight(2, '0') : '00'}';
}

class TransferBankChoice {
  const TransferBankChoice(
      {required this.code, required this.name, this.slug = ''});
  final String code, name, slug;
}

class TransferHeader extends StatelessWidget {
  const TransferHeader(
      {super.key,
      required this.bank,
      required this.onBack,
      required this.locked,
      this.showBack = true});
  final bool bank, locked, showBack;
  final VoidCallback onBack;
  @override
  Widget build(BuildContext context) => Row(children: [
        if (showBack) ...[
          IconButton(
              onPressed: locked ? null : onBack,
              tooltip: 'Back',
              style: IconButton.styleFrom(
                  backgroundColor: AppColors.surface,
                  minimumSize: const Size(48, 48)),
              icon: const Icon(Icons.arrow_back_rounded)),
          const SizedBox(width: 14),
        ],
        Expanded(
            child: Text(bank ? 'Bank transfer' : 'Send money',
                style: AppTextStyles.headingL)),
      ]);
}

class TransferSection extends StatelessWidget {
  const TransferSection(
      {super.key, required this.title, this.subtitle, required this.children});
  final String title;
  final String? subtitle;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.border)),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: AppTextStyles.headingM),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: AppTextStyles.bodyS)
          ],
          const SizedBox(height: 20),
          ...children,
        ]),
      );
}

class TransferRecipientCard extends StatelessWidget {
  const TransferRecipientCard(
      {super.key,
      this.name,
      this.detail,
      this.error,
      required this.loading,
      required this.idleText,
      required this.onRetry,
      required this.canRetry,
      required this.bank});
  final String? name, detail, error;
  final bool loading, canRetry, bank;
  final String idleText;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final verified =
        name != null && name!.isNotEmpty && !loading && error == null;
    final title = loading ? 'Checking recipient…' : error ?? name ?? idleText;
    return Semantics(
        liveRegion: true,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
              color: verified
                  ? AppColors.success.withValues(alpha: .06)
                  : AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                  color: error != null
                      ? AppColors.error
                      : verified
                          ? AppColors.success.withValues(alpha: .5)
                          : AppColors.border)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (loading)
              const Padding(
                  padding: EdgeInsets.only(top: 3),
                  child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2)))
            else
              Icon(
                  verified
                      ? Icons.verified_rounded
                      : error != null
                          ? Icons.error_outline_rounded
                          : bank
                              ? Icons.account_circle_outlined
                              : Icons.person_search_outlined,
                  color: verified ? AppColors.success : AppColors.textSecondary,
                  size: 24),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  if (verified) ...[
                    Text('Recipient confirmed', style: AppTextStyles.bodyS),
                    const SizedBox(height: 4)
                  ],
                  Text(title,
                      style: verified
                          ? AppTextStyles.labelL
                          : AppTextStyles.bodyM),
                  if (verified && detail != null && detail!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(detail!, style: AppTextStyles.bodyS)
                  ],
                  if (error != null && canRetry)
                    TextButton.icon(
                        onPressed: onRetry,
                        icon: const Icon(Icons.refresh_rounded, size: 18),
                        label: const Text('Retry lookup')),
                ])),
          ]),
        ));
  }
}

class TransferBankPicker extends StatelessWidget {
  const TransferBankPicker(
      {super.key,
      required this.banks,
      this.selectedCode,
      required this.loading,
      required this.enabled,
      required this.onSelect,
      required this.onRetry});
  final List<TransferBankChoice> banks;
  final String? selectedCode;
  final bool loading, enabled;
  final ValueChanged<String> onSelect;
  final VoidCallback onRetry;

  Future<void> _open(BuildContext context) async {
    FocusScope.of(context).unfocus();
    final code = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        backgroundColor: AppColors.surface,
        builder: (_) => _BankSheet(banks: banks, selectedCode: selectedCode));
    if (code != null) onSelect(code);
  }

  @override
  Widget build(BuildContext context) {
    final selected = banks.where((b) => b.code == selectedCode);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      OutlinedButton(
          onPressed: enabled && !loading && banks.isNotEmpty
              ? () => _open(context)
              : null,
          style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.all(16),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14))),
          child: Row(children: [
            const Icon(Icons.account_balance_outlined, size: 22),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('Bank', style: AppTextStyles.bodyS),
                  const SizedBox(height: 3),
                  Text(
                      loading
                          ? 'Loading banks…'
                          : selected.isEmpty
                              ? 'Choose bank'
                              : selected.first.name,
                      style: AppTextStyles.labelM),
                ])),
            const Icon(Icons.keyboard_arrow_down_rounded),
          ])),
      if (!loading && banks.isEmpty)
        Padding(
            padding: const EdgeInsets.only(top: 8),
            child: TextButton.icon(
                onPressed: enabled ? onRetry : null,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Reload bank list'))),
    ]);
  }
}

class _BankSheet extends StatefulWidget {
  const _BankSheet({required this.banks, required this.selectedCode});
  final List<TransferBankChoice> banks;
  final String? selectedCode;
  @override
  State<_BankSheet> createState() => _BankSheetState();
}

class _BankSheetState extends State<_BankSheet> {
  String _query = '';
  @override
  Widget build(BuildContext context) {
    final rows = widget.banks
        .where((b) =>
            '${b.name} ${b.slug} ${b.code}'.toLowerCase().contains(_query))
        .toList();
    final media = MediaQuery.of(context);
    final available =
        (media.size.height - media.viewInsets.bottom - media.padding.top - 64)
            .clamp(0.0, media.size.height * .68)
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
                        padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
                        child:
                            Text('Choose bank', style: AppTextStyles.headingL)),
                    Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: TextField(
                            autofocus: false,
                            decoration: const InputDecoration(
                                labelText: 'Search banks',
                                hintText: 'Bank name or code',
                                prefixIcon: Icon(Icons.search_rounded)),
                            onChanged: (value) => setState(
                                () => _query = value.trim().toLowerCase()))),
                    const SizedBox(height: 12),
                    if (rows.isEmpty)
                      Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text('No banks match. Try another name.',
                              style: AppTextStyles.bodyM)),
                    Expanded(
                        child: Material(
                            color: AppColors.surface,
                            child: ListView.separated(
                              itemCount: rows.length,
                              separatorBuilder: (_, __) =>
                                  Divider(height: 1, color: AppColors.divider),
                              itemBuilder: (context, index) {
                                final bank = rows[index];
                                return ListTile(
                                    contentPadding: const EdgeInsets.symmetric(
                                        horizontal: 24, vertical: 8),
                                    leading: CircleAvatar(
                                        backgroundColor:
                                            AppColors.surfaceVariant,
                                        child: Icon(
                                            Icons.account_balance_outlined,
                                            color: AppColors.textSecondary)),
                                    title: Text(bank.name,
                                        style: AppTextStyles.labelM),
                                    trailing: bank.code == widget.selectedCode
                                        ? Icon(Icons.check_circle_rounded,
                                            color: AppColors.primary)
                                        : null,
                                    onTap: () =>
                                        Navigator.pop(context, bank.code));
                              },
                            ))),
                  ]),
            )));
  }
}

/// Availability is checked before asking the customer for transfer details.
/// An explicitly disabled service is different from a failed network read.
class TransferAvailabilityView extends StatelessWidget {
  const TransferAvailabilityView(
      {super.key,
      required this.bank,
      required this.loading,
      required this.failed,
      required this.title,
      required this.message,
      required this.onBack,
      required this.onRetry,
      required this.onSupport,
      this.recovery,
      this.outcome});
  final bool bank, loading, failed;
  final String title, message;
  final VoidCallback onBack, onRetry, onSupport;
  final Widget? recovery, outcome;
  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
          title: Text(bank ? 'Bank transfer' : 'Send money',
              style: AppTextStyles.headingM),
          automaticallyImplyLeading: false,
          leading: IconButton(
              tooltip: 'Back',
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded))),
      body: SafeArea(
          child: LayoutBuilder(
              builder: (context, viewport) => SingleChildScrollView(
                  child: Center(
                      child: ConstrainedBox(
                          constraints: BoxConstraints(
                              maxWidth: 552, minHeight: viewport.maxHeight),
                          child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    Center(
                                        child: Container(
                                            width: 88,
                                            height: 88,
                                            decoration: BoxDecoration(
                                                color: AppColors.primary
                                                    .withValues(alpha: .09),
                                                shape: BoxShape.circle),
                                            child: loading
                                                ? const Padding(
                                                    padding: EdgeInsets.all(28),
                                                    child:
                                                        CircularProgressIndicator())
                                                : Icon(
                                                    failed
                                                        ? Icons.wifi_off_rounded
                                                        : Icons
                                                            .account_balance_outlined,
                                                    color: AppColors.primary,
                                                    size: 38))),
                                    const SizedBox(height: 28),
                                    Semantics(
                                        liveRegion: true,
                                        child: Text(title,
                                            textAlign: TextAlign.center,
                                            style: AppTextStyles.headingL)),
                                    const SizedBox(height: 12),
                                    Text(message,
                                        textAlign: TextAlign.center,
                                        style: AppTextStyles.bodyM),
                                    const SizedBox(height: 32),
                                    if (!loading) ...[
                                      FilledButton.icon(
                                          onPressed:
                                              failed ? onRetry : onSupport,
                                          style: FilledButton.styleFrom(
                                              minimumSize:
                                                  const Size.fromHeight(56)),
                                          icon: Icon(failed
                                              ? Icons.refresh_rounded
                                              : Icons.support_agent_rounded),
                                          label: Text(failed
                                              ? 'Retry'
                                              : 'Contact support')),
                                      const SizedBox(height: 12),
                                      OutlinedButton(
                                          onPressed: onBack,
                                          style: OutlinedButton.styleFrom(
                                              minimumSize:
                                                  const Size.fromHeight(56)),
                                          child: const Text('Go back')),
                                    ],
                                    if (recovery != null) ...[
                                      const SizedBox(height: 24),
                                      recovery!
                                    ],
                                    if (outcome != null) ...[
                                      const SizedBox(height: 16),
                                      outcome!
                                    ],
                                  ]))))))),
    );
  }
}
