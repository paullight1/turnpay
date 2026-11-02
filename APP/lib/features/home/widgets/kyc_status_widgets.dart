import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/kyc/kyc_tier.dart';
import '../../../services/kyc_service.dart';
import 'kyc_illustration.dart';
import 'kyc_status_presenter.dart';

class KycStatusOverview extends StatelessWidget {
  const KycStatusOverview(
      {super.key,
      required this.overview,
      required this.onDetails,
      required this.onStartBvn,
      required this.onStartNin,
      required this.onHistory,
      required this.onAccount,
      this.busy = false,
      this.onSupport});
  final KycOverview overview;
  final ValueChanged<String> onDetails;
  final VoidCallback onStartBvn, onStartNin, onHistory, onAccount;
  final bool busy;
  final VoidCallback? onSupport;

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final bvn = kycCheckStatus(overview, 'BVN');
    final nin = kycCheckStatus(overview, 'NIN');
    final active = !overview.isSuspended &&
        overview.isVerified &&
        kycTierRank(overview.tier) >= 1;
    final ready = kycPaystackReady(overview);
    final complete = active &&
        kycTierRank(overview.tier) >= 2 &&
        nin == 'VERIFIED' &&
        bvn == 'VERIFIED';
    final pending = kycCheckPending(bvn);
    final title = overview.isSuspended
        ? 'Your account is under review'
        : complete
            ? 'You’re fully verified'
            : active
                ? 'Your account is active'
                : pending
                    ? 'We’re checking your BVN'
                    : 'Activate your account';
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 36),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        Center(
            child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                  color:
                                      AppColors.primary.withValues(alpha: .08),
                                  borderRadius: BorderRadius.circular(14)),
                              child: Icon(
                                  complete || active
                                      ? Icons.verified_user_outlined
                                      : Icons.shield_outlined,
                                  color: AppColors.primary,
                                  size: 28))),
                      const SizedBox(height: 24),
                      Text(title, style: AppTextStyles.headingL),
                      const SizedBox(height: 10),
                      Text(
                          overview.isSuspended
                              ? 'Money actions are unavailable while your account is under review. Contact support for help.'
                              : complete
                                  ? 'Your BVN and NIN are verified. You’re on Tier 2.'
                                  : active
                                      ? 'Transact within your Tier 1 limits. Add NIN when you’re ready to upgrade.'
                                      : pending
                                          ? 'Your bank identity check is in progress. We’ll update your status here.'
                                          : 'Verify your BVN to get a bank account and start transacting within Tier 1 limits.',
                          style: AppTextStyles.bodyM),
                      if (overview.isSuspended && onSupport != null) ...[
                        const SizedBox(height: 16),
                        OutlinedButton(
                            onPressed: onSupport,
                            child: const Text('Contact support'))
                      ],
                      const SizedBox(height: 30),
                      _VerificationTier(
                        number: '1',
                        title: 'Bank verification',
                        detail: overview.isSuspended
                            ? 'Your verification history is saved. An identity upgrade will not remove this restriction.'
                            : ready
                                ? 'BVN verified. Your Tier 1 access is active.'
                                : pending
                                    ? 'Your BVN and linked bank details are being checked.'
                                    : 'Your BVN and an existing bank account linked to it.',
                        status: bvn,
                        onDetails: () => onDetails('BVN'),
                        buttonLabel: overview.isSuspended
                            ? null
                            : ready
                                ? null
                                : pending
                                    ? 'View verification status'
                                    : 'Verify BVN',
                        onAction: busy
                            ? null
                            : pending
                                ? () => onDetails('BVN')
                                : onStartBvn,
                        primary: true,
                      ),
                      if (ready && !overview.isSuspended) ...[
                        const SizedBox(height: 12),
                        _AccountPreparation(
                            status: overview.accountPreparationStatus,
                            onTap: onAccount),
                      ],
                      const SizedBox(height: 22),
                      _VerificationTier(
                        number: '2',
                        title: 'NIN verification',
                        detail: nin == 'VERIFIED'
                            ? 'Your NIN upgrade is complete.'
                            : kycCheckPending(nin)
                                ? 'Your NIN is under review. Tier 1 stays active.'
                                : ready
                                    ? 'Add your NIN to upgrade your account limits.'
                                    : 'Available after BVN verification',
                        status: nin,
                        onDetails: () => onDetails('NIN'),
                        buttonLabel: kycCanStartNin(overview)
                            ? 'Upgrade to Tier 2'
                            : null,
                        onAction: busy ? null : onStartNin,
                      ),
                      if (overview.tierOneLimits != null &&
                          active &&
                          !complete) ...[
                        const SizedBox(height: 24),
                        Text('TIER 1 LIMITS',
                            style: AppTextStyles.labelS.copyWith(
                                color: AppColors.textSecondary,
                                letterSpacing: 1)),
                        const SizedBox(height: 10),
                        for (final entry in {
                          'Per transaction': 'perTransaction',
                          'Daily spending': 'daily',
                          'Wallet balance': 'maxBalance'
                        }.entries)
                          Padding(
                              padding: const EdgeInsets.symmetric(vertical: 7),
                              child: Row(children: [
                                Expanded(
                                    child: Text(entry.key,
                                        style: AppTextStyles.bodyS)),
                                Text(
                                    'NGN ${overview.tierOneLimits![entry.value]}',
                                    style: AppTextStyles.labelS)
                              ])),
                      ],
                      const SizedBox(height: 26),
                      TextButton.icon(
                          onPressed: onHistory,
                          icon: const Icon(Icons.history_rounded, size: 18),
                          label: const Text('Verification history')),
                      const SizedBox(height: 8),
                      Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.lock_outline_rounded,
                                size: 14, color: AppColors.textSecondary),
                            const SizedBox(width: 6),
                            Flexible(
                                child: Text(
                                    'Your identity details are encrypted and kept private.',
                                    style: AppTextStyles.bodyS,
                                    textAlign: TextAlign.center))
                          ]),
                    ])))
      ],
    );
  }
}

class _VerificationTier extends StatelessWidget {
  const _VerificationTier(
      {required this.number,
      required this.title,
      required this.detail,
      required this.status,
      required this.onDetails,
      this.buttonLabel,
      this.onAction,
      this.primary = false});
  final String number, title, detail, status;
  final VoidCallback onDetails;
  final String? buttonLabel;
  final VoidCallback? onAction;
  final bool primary;
  @override
  Widget build(BuildContext context) => Material(
      color: Colors.transparent,
      child: InkWell(
          onTap: onDetails,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            key: ValueKey('kyc-status-${number == '1' ? 'BVN' : 'NIN'}'),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: AppColors.border)),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Container(
                        width: 32,
                        height: 32,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                            color: status == 'VERIFIED'
                                ? AppColors.success.withValues(alpha: .1)
                                : AppColors.surfaceVariant,
                            shape: BoxShape.circle),
                        child: status == 'VERIFIED'
                            ? Icon(Icons.check_rounded,
                                size: 18, color: AppColors.success)
                            : Text(number, style: AppTextStyles.labelM)),
                    const SizedBox(width: 12),
                    Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                          Text('TIER $number',
                              style: AppTextStyles.labelS.copyWith(
                                  color: AppColors.textSecondary,
                                  letterSpacing: 1)),
                          const SizedBox(height: 4),
                          Text(title, style: AppTextStyles.labelM)
                        ])),
                    IconButton(
                        tooltip: 'View ${number == '1' ? 'BVN' : 'NIN'} status',
                        onPressed: onDetails,
                        constraints:
                            const BoxConstraints(minHeight: 40, minWidth: 40),
                        icon: Icon(Icons.chevron_right_rounded,
                            color: AppColors.textSecondary)),
                  ]),
                  const SizedBox(height: 14),
                  Text(detail, style: AppTextStyles.bodyS),
                  if (status != 'INCOMPLETE') ...[
                    const SizedBox(height: 14),
                    Align(
                        alignment: Alignment.centerLeft,
                        child: _StatusPill(status: status))
                  ],
                  if (buttonLabel != null) ...[
                    const SizedBox(height: 18),
                    primary
                        ? FilledButton(
                            onPressed: onAction, child: Text(buttonLabel!))
                        : OutlinedButton(
                            onPressed: onAction, child: Text(buttonLabel!))
                  ],
                ]),
          )));
}

class _AccountPreparation extends StatelessWidget {
  const _AccountPreparation({required this.status, required this.onTap});
  final String status;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ready = status == 'ACTIVE' ||
        status == 'READY' ||
        status == 'COMPLETED' ||
        status == 'SUCCESS';
    final preparing = {'PENDING', 'PROCESSING', 'QUEUED'}.contains(status);
    return Material(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
        child: ListTile(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          leading: Icon(Icons.account_balance_outlined,
              color: AppColors.textSecondary, size: 22),
          title: Text(
              ready
                  ? 'Your bank account is ready'
                  : preparing
                      ? 'Preparing your bank account'
                      : 'Set up your bank account',
              style: AppTextStyles.labelS),
          subtitle: Text(
              ready
                  ? 'View your receiving details'
                  : preparing
                      ? 'BVN is verified. Account setup is separate.'
                      : 'Continue to your NGN receiving account',
              style: AppTextStyles.bodyS),
          trailing: const Icon(Icons.chevron_right_rounded, size: 20),
          onTap: onTap,
        ));
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final color = status == 'VERIFIED'
        ? AppColors.success
        : kycCheckPending(status)
            ? AppColors.warning
            : status == 'FAILED' || status == 'REJECTED'
                ? AppColors.error
                : AppColors.textSecondary;
    return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
            color: color.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(30)),
        child: Text(kycCheckLabel(status),
            style: AppTextStyles.labelS.copyWith(color: color)));
  }
}

class KycSubmissionConfirmation extends StatelessWidget {
  const KycSubmissionConfirmation(
      {super.key,
      required this.type,
      required this.verified,
      required this.message,
      required this.onStatus,
      this.onContinueNin});
  final String type, message;
  final bool verified;
  final VoidCallback onStatus;
  final VoidCallback? onContinueNin;
  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final continueNin = verified && type == 'BVN' ? onContinueNin : null;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
          backgroundColor: AppColors.background,
          automaticallyImplyLeading: false,
          actions: [
            IconButton(
                tooltip: 'View verification status',
                onPressed: onStatus,
                icon: const Icon(Icons.close_rounded))
          ]),
      body: SafeArea(
          child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(28, 24, 28, 40),
              child: Center(
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 460),
                      child: Column(children: [
                        KycIllustration(
                            kind: verified
                                ? KycIllustrationKind.verified
                                : KycIllustrationKind.review,
                            size: 220),
                        const SizedBox(height: 36),
                        Text(verified ? '$type verified' : '$type under review',
                            textAlign: TextAlign.center,
                            style: AppTextStyles.headingXL),
                        const SizedBox(height: 16),
                        Text(message,
                            textAlign: TextAlign.center,
                            style: AppTextStyles.bodyM),
                        if (continueNin != null) ...[
                          const SizedBox(height: 28),
                          Text('Optional next step: Tier 2',
                              textAlign: TextAlign.center,
                              style: AppTextStyles.labelM),
                          const SizedBox(height: 8),
                          Text(
                              'Tier 1 is active. Add NIN when you’re ready for Tier 2.',
                              textAlign: TextAlign.center,
                              style: AppTextStyles.bodyS),
                        ],
                      ]))))),
      bottomNavigationBar: SafeArea(
          child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                        onPressed: continueNin ?? onStatus,
                        child: Text(
                            continueNin == null
                                ? 'View verification status'
                                : 'Continue to NIN',
                            textAlign: TextAlign.center))),
                if (continueNin != null) ...[
                  const SizedBox(height: 8),
                  TextButton(
                      onPressed: onStatus,
                      child: const Text('View verification status'))
                ],
              ]))),
    );
  }
}

class KycCheckDetailsSheet extends StatefulWidget {
  const KycCheckDetailsSheet(
      {super.key,
      required this.overview,
      required this.type,
      required this.onCheckStatus,
      required this.onContinue,
      this.onReconcile});
  final KycOverview overview;
  final String type;
  final Future<KycOverview> Function() onCheckStatus;
  final void Function(KycOverview) onContinue;
  final Future<PaystackKycRecovery> Function()? onReconcile;
  @override
  State<KycCheckDetailsSheet> createState() => _KycCheckDetailsSheetState();
}

class _KycCheckDetailsSheetState extends State<KycCheckDetailsSheet> {
  late KycOverview _overview = widget.overview;
  PaystackKycRecovery? _recovery;
  bool _checking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _recovery = kycRecoveryFor(widget.overview, widget.type);
  }

  Future<void> _check() async {
    if (_checking) return;
    setState(() {
      _checking = true;
      _error = null;
    });
    try {
      final currentStatus = kycCheckStatus(_overview, widget.type);
      if (widget.type.toUpperCase() == 'BVN' &&
          kycCheckPending(currentStatus) &&
          widget.onReconcile != null) {
        final recovery = await widget.onReconcile!();
        if (mounted) setState(() => _recovery = recovery);
      }
      final updated = await widget.onCheckStatus();
      if (mounted) {
        setState(() {
          _overview = updated;
          _recovery = kycRecoveryFor(updated, widget.type) ?? _recovery;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Could not refresh status. Your last result is shown. Try again.');
      }
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final status = kycCheckStatus(_overview, widget.type);
    final pending = kycCheckPending(status), verified = status == 'VERIFIED';
    final recovery = _recovery ?? kycRecoveryFor(_overview, widget.type);
    final canStart = widget.type == 'NIN'
        ? kycCanStartNin(_overview)
        : !kycPaystackReady(_overview) && !pending;
    final dates = _overview.documents.where((item) =>
        item.type.toUpperCase() == widget.type && item.updatedAt != null);
    return _SheetFrame(
        title: '${widget.type} status',
        closeTooltip: 'Close status',
        children: [
          Center(
              child: KycIllustration(
                  kind: verified
                      ? KycIllustrationKind.verified
                      : pending
                          ? KycIllustrationKind.review
                          : KycIllustrationKind.identity,
                  size: 144)),
          const SizedBox(height: 24),
          Align(
              alignment: Alignment.centerLeft,
              child: _StatusPill(status: status)),
          const SizedBox(height: 20),
          Text(
              verified
                  ? 'Your ${widget.type} check is complete.'
                  : pending
                      ? widget.type == 'NIN'
                          ? 'Your NIN document is with our review team.'
                          : 'Your BVN and linked bank account are being checked.'
                      : status == 'FAILED' || status == 'REJECTED'
                          ? 'Your details need another look. Review the information before trying again.'
                          : widget.type == 'NIN' && !canStart
                              ? 'Verify your BVN first. NIN is the next step for Tier 2.'
                              : 'This check has not been started.',
              style: AppTextStyles.bodyM),
          if (dates.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
                'Last updated ${DateFormat('d MMM yyyy, HH:mm').format(dates.first.updatedAt!.toLocal())}',
                style: AppTextStyles.bodyS)
          ],
          if (pending && recovery != null) ...[
            const SizedBox(height: 16),
            _RecoveryGuidance(recovery: recovery),
          ],
          if (_error != null) ...[
            const SizedBox(height: 20),
            Semantics(
                liveRegion: true,
                child: Text(_error!,
                    style:
                        AppTextStyles.bodyS.copyWith(color: AppColors.error)))
          ],
          const SizedBox(height: 28),
          OutlinedButton.icon(
              onPressed: _checking ? null : _check,
              icon: _checking
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh_rounded, size: 20),
              label: Text(_checking ? 'Checking status…' : 'Check status')),
          if (canStart) ...[
            const SizedBox(height: 12),
            FilledButton(
                onPressed:
                    _checking ? null : () => widget.onContinue(_overview),
                child: Text(
                    widget.type == 'NIN' ? 'Continue to NIN' : 'Verify BVN'))
          ],
        ]);
  }
}

class KycHistorySheet extends StatelessWidget {
  const KycHistorySheet({super.key, required this.documents});
  final List<KycDocumentSummary> documents;
  @override
  Widget build(BuildContext context) => _SheetFrame(
          title: 'Verification history',
          closeTooltip: 'Close history',
          children: [
            Text('Updates for your identity checks.',
                style: AppTextStyles.bodyM),
            const SizedBox(height: 28),
            if (documents.isEmpty)
              Text('No verification history yet.', style: AppTextStyles.bodyM),
            for (final document in documents)
              Padding(
                  padding: const EdgeInsets.only(bottom: 24),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${document.type} verification',
                            style: AppTextStyles.labelM),
                        const SizedBox(height: 8),
                        _StatusPill(status: document.status),
                        if (document.recovery != null) ...[
                          const SizedBox(height: 8),
                          Text(document.recovery!.message,
                              style: AppTextStyles.bodyS),
                          if (document.recovery!.supportReference.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                'Support reference: ${document.recovery!.supportReference}',
                                style: AppTextStyles.caption,
                              ),
                            ),
                        ],
                        if (document.updatedAt != null) ...[
                          const SizedBox(height: 8),
                          Text(
                              DateFormat('d MMM yyyy, HH:mm')
                                  .format(document.updatedAt!.toLocal()),
                              style: AppTextStyles.bodyS)
                        ],
                      ])),
          ]);
}

class _RecoveryGuidance extends StatelessWidget {
  const _RecoveryGuidance({required this.recovery});
  final PaystackKycRecovery recovery;

  @override
  Widget build(BuildContext context) {
    final delayed = recovery.isDelayed;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            delayed
                ? 'This check is taking longer than expected'
                : 'Recovery update',
            style: AppTextStyles.labelM,
          ),
          const SizedBox(height: 6),
          Text(recovery.message, style: AppTextStyles.bodyS),
          if (recovery.supportReference.isNotEmpty) ...[
            const SizedBox(height: 8),
            SelectableText(
              'Support reference: ${recovery.supportReference}',
              style: AppTextStyles.caption,
            ),
          ],
        ],
      ),
    );
  }
}

class _SheetFrame extends StatelessWidget {
  const _SheetFrame(
      {required this.title,
      required this.closeTooltip,
      required this.children});
  final String title, closeTooltip;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => SafeArea(
      top: false,
      child: ConstrainedBox(
          constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * .88),
          child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                  24, 12, 24, 32 + MediaQuery.viewInsetsOf(context).bottom),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(children: [
                      Expanded(
                          child: Text(title, style: AppTextStyles.headingM)),
                      IconButton(
                          tooltip: closeTooltip,
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.close_rounded))
                    ]),
                    const SizedBox(height: 24),
                    ...children,
                  ]))));
}
