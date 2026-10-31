import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_theme.dart';
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
      this.busy = false});
  final KycOverview overview;
  final ValueChanged<String> onDetails;
  final VoidCallback onStartBvn, onStartNin, onHistory, onAccount;
  final bool busy;
  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final bvn = kycCheckStatus(overview, 'BVN'),
        nin = kycCheckStatus(overview, 'NIN');
    final complete = (bvn == 'VERIFIED' ? 1 : 0) + (nin == 'VERIFIED' ? 1 : 0);
    return ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Center(
              child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 600),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Align(
                            alignment: Alignment.centerLeft,
                            child: KycIllustration(
                                kind: complete == 2
                                    ? KycIllustrationKind.verified
                                    : KycIllustrationKind.identity,
                                size: 104)),
                        const SizedBox(height: 20),
                        Text(
                            complete == 2
                                ? 'You’re verified'
                                : 'Your identity checks',
                            style: AppTextStyles.headingL),
                        const SizedBox(height: 8),
                        Text(
                            complete == 2
                                ? 'Your NIN and BVN are verified.'
                                : 'Complete two checks. Follow their progress here.',
                            style: AppTextStyles.bodyM),
                        const SizedBox(height: 16),
                        Text('$complete of 2 verified',
                            style: AppTextStyles.labelS
                                .copyWith(color: AppColors.textSecondary)),
                        const SizedBox(height: 28),
                        for (final type in ['BVN', 'NIN']) ...[
                          _CheckCard(
                              type: type,
                              status: type == 'BVN' ? bvn : nin,
                              onTap: () => onDetails(type),
                              onStart: busy
                                  ? null
                                  : type == 'BVN'
                                      ? bvn != 'VERIFIED' &&
                                              !kycCheckPending(bvn)
                                          ? onStartBvn
                                          : null
                                      : kycCanStartNin(overview)
                                          ? onStartNin
                                          : null),
                          const SizedBox(height: 16),
                        ],
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                            onPressed: onHistory,
                            icon: const Icon(Icons.history_rounded, size: 20),
                            label: const Text('View verification history')),
                        if (bvn == 'VERIFIED' &&
                            !kycPaystackReady(overview) &&
                            !busy)
                          TextButton(
                              onPressed: onStartBvn,
                              child: const Text('Verify bank details')),
                        if (kycPaystackReady(overview)) ...[
                          const SizedBox(height: 12),
                          TextButton.icon(
                              onPressed: onAccount,
                              icon: const Icon(Icons.account_balance_outlined,
                                  size: 20),
                              label: const Text('Set up receiving account')),
                        ],
                      ]))),
        ]);
  }
}

class _CheckCard extends StatelessWidget {
  const _CheckCard(
      {required this.type,
      required this.status,
      required this.onTap,
      this.onStart});
  final String type, status;
  final VoidCallback onTap;
  final VoidCallback? onStart;
  @override
  Widget build(BuildContext context) => Material(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: AppColors.border)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
          key: ValueKey('kyc-status-$type'),
          onTap: onTap,
          child: Padding(
              padding: const EdgeInsets.all(22),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                  color: AppColors.surfaceVariant,
                                  borderRadius: BorderRadius.circular(14)),
                              child: Icon(
                                  type == 'BVN'
                                      ? Icons.account_balance_outlined
                                      : Icons.badge_outlined,
                                  color: AppColors.primary,
                                  size: 24)),
                          const SizedBox(width: 16),
                          Expanded(
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                Text('$type verification',
                                    style: AppTextStyles.labelM),
                                const SizedBox(height: 6),
                                Text(
                                    type == 'BVN'
                                        ? 'Bank identity check'
                                        : 'Identity document',
                                    style: AppTextStyles.bodyS),
                              ])),
                          const SizedBox(width: 8),
                          Icon(Icons.chevron_right_rounded,
                              color: AppColors.textSecondary),
                        ]),
                    const SizedBox(height: 20),
                    _StatusPill(status: status),
                    if (onStart != null) ...[
                      const SizedBox(height: 16),
                      SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                              onPressed: onStart,
                              child: Text(
                                  type == 'BVN'
                                      ? 'Verify BVN'
                                      : 'Continue to NIN',
                                  textAlign: TextAlign.center))),
                    ],
                  ]))));
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
                        if (onContinueNin != null) ...[
                          const SizedBox(height: 28),
                          Text('Next: your NIN document',
                              textAlign: TextAlign.center,
                              style: AppTextStyles.labelM),
                          const SizedBox(height: 8),
                          Text('You can add your NIN while we check your BVN.',
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
                        onPressed: onContinueNin ?? onStatus,
                        child: Text(
                            onContinueNin == null
                                ? 'View verification status'
                                : 'Continue to NIN',
                            textAlign: TextAlign.center))),
                if (onContinueNin != null) ...[
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
      required this.onContinue});
  final KycOverview overview;
  final String type;
  final Future<KycOverview> Function() onCheckStatus;
  final void Function(KycOverview) onContinue;
  @override
  State<KycCheckDetailsSheet> createState() => _KycCheckDetailsSheetState();
}

class _KycCheckDetailsSheetState extends State<KycCheckDetailsSheet> {
  late KycOverview _overview = widget.overview;
  bool _checking = false;
  String? _error;
  Future<void> _check() async {
    if (_checking) return;
    setState(() {
      _checking = true;
      _error = null;
    });
    try {
      final updated = await widget.onCheckStatus();
      if (mounted) setState(() => _overview = updated);
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
                              ? 'Submit your BVN first. You can then add your NIN document.'
                              : 'This check has not been started.',
              style: AppTextStyles.bodyM),
          if (dates.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
                'Last updated ${DateFormat('d MMM yyyy, HH:mm').format(dates.first.updatedAt!.toLocal())}',
                style: AppTextStyles.bodyS)
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
