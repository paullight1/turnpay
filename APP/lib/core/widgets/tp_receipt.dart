import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../utils/haptics.dart';
import 'tp_illustration.dart';
import 'tp_transaction_status.dart';

/// The outcome tone of a receipt, used to pick colors and illustration.
enum TpReceiptTone { success, pending, failed }

extension TpReceiptToneX on TpReceiptTone {
  Color get color {
    switch (this) {
      case TpReceiptTone.success:
        return AppColors.success;
      case TpReceiptTone.failed:
        return AppColors.error;
      case TpReceiptTone.pending:
        return AppColors.warning;
    }
  }

  TpIllustrationVariant get illustration {
    switch (this) {
      case TpReceiptTone.success:
        return TpIllustrationVariant.success;
      case TpReceiptTone.failed:
        return TpIllustrationVariant.error;
      case TpReceiptTone.pending:
        return TpIllustrationVariant.receipt;
    }
  }

  /// The animated status state used by the receipt hero.
  TpTxStatus get txStatus {
    switch (this) {
      case TpReceiptTone.success:
        return TpTxStatus.success;
      case TpReceiptTone.failed:
        return TpTxStatus.failed;
      case TpReceiptTone.pending:
        return TpTxStatus.pending;
    }
  }

  IconData get icon {
    switch (this) {
      case TpReceiptTone.success:
        return Icons.verified_rounded;
      case TpReceiptTone.failed:
        return Icons.error_outline_rounded;
      case TpReceiptTone.pending:
        return Icons.hourglass_top_rounded;
    }
  }

  static TpReceiptTone fromStatus(String status) {
    switch (status.toUpperCase()) {
      case 'SUCCESS':
      case 'COMPLETED':
      case 'SUCCESSFUL':
        return TpReceiptTone.success;
      case 'FAILED':
      case 'REVERSED':
      case 'CANCELLED':
        return TpReceiptTone.failed;
      default:
        return TpReceiptTone.pending;
    }
  }
}

/// A single label/value line inside a receipt body.
class TpReceiptEntry {
  final String label;
  final String value;
  final bool emphasize;
  final bool copyable;

  const TpReceiptEntry(
    this.label,
    this.value, {
    this.emphasize = false,
    this.copyable = false,
  });
}

/// The animated hero shown above a receipt card (not part of the captured
/// image). Uses the hand-drawn illustration set so it adapts to the theme.
class TpReceiptHero extends StatelessWidget {
  final TpReceiptTone tone;
  final String title;
  final String message;
  final String statusLabel;
  final String amountLabel;
  final String? reference;

  const TpReceiptHero({
    super.key,
    required this.tone,
    required this.title,
    required this.message,
    required this.statusLabel,
    required this.amountLabel,
    this.reference,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 24,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        children: [
          TpStatusIcon(status: tone.txStatus, size: 104),
          const SizedBox(height: AppSpacing.md),
          Text(
            title,
            style: AppTextStyles.headingL.copyWith(fontWeight: FontWeight.w900),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            message,
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          _StatusPill(label: statusLabel, tone: tone),
          const SizedBox(height: AppSpacing.md),
          Text(
            amountLabel,
            style: AppTextStyles.displayMedium.copyWith(
              fontSize: 34,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (reference != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Reference $reference',
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String label;
  final TpReceiptTone tone;

  const _StatusPill({required this.label, required this.tone});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final tint = tone.color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: tint.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(tone.icon, size: 14, color: tint),
          const SizedBox(width: 6),
          Text(
            label.replaceAll('_', ' ').toUpperCase(),
            style: AppTextStyles.labelS.copyWith(
              color: tint,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

/// The printable receipt card. Wrap this in a [RepaintBoundary] to capture it
/// as an image for share/download.
class TpReceiptCard extends StatelessWidget {
  final TpReceiptTone tone;
  final String headerTitle;
  final String headerSubtitle;
  final String statusLabel;
  final List<TpReceiptEntry> entries;
  final String footerNote;

  const TpReceiptCard({
    super.key,
    required this.tone,
    required this.headerTitle,
    required this.headerSubtitle,
    required this.statusLabel,
    required this.entries,
    required this.footerNote,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final tint = tone.color;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primary.withValues(alpha: 0.08),
                  AppColors.primary.withValues(alpha: 0.03),
                ],
              ),
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadius.xl),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.receipt_long_rounded,
                    color: AppColors.primary,
                    size: 24,
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        headerTitle,
                        style: AppTextStyles.labelL
                            .copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 2),
                      Text(headerSubtitle, style: AppTextStyles.bodyS),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: tint.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                  child: Text(
                    statusLabel.toUpperCase(),
                    style: AppTextStyles.caption.copyWith(
                      color: tint,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const TpReceiptCutLine(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < entries.length; i++)
                  _TpReceiptRow(
                    entry: entries[i],
                    showDivider: i != entries.length - 1,
                  ),
              ],
            ),
          ),
          const TpReceiptCutLine(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            child: Text(
              footerNote,
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

class _TpReceiptRow extends StatelessWidget {
  final TpReceiptEntry entry;
  final bool showDivider;

  const _TpReceiptRow({required this.entry, required this.showDivider});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 108,
                child: Text(entry.label, style: AppTextStyles.bodyS),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  entry.value,
                  style: (entry.emphasize
                          ? AppTextStyles.labelL
                          : AppTextStyles.labelM)
                      .copyWith(color: AppColors.textPrimary),
                ),
              ),
            ],
          ),
        ),
        if (showDivider)
          Divider(
            height: 1,
            thickness: 1,
            color: AppColors.border.withValues(alpha: 0.7),
          ),
      ],
    );
  }
}

/// A dashed "tear here" separator used inside receipt cards.
class TpReceiptCutLine extends StatelessWidget {
  const TpReceiptCutLine({super.key});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return SizedBox(
      height: 18,
      child: CustomPaint(
        painter: _CutLinePainter(AppColors.border.withValues(alpha: 0.7)),
        child: const SizedBox.expand(),
      ),
    );
  }
}

class _CutLinePainter extends CustomPainter {
  final Color color;
  _CutLinePainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;

    const dashWidth = 8.0;
    const dashGap = 6.0;
    double startX = 0;
    while (startX < size.width) {
      final endX = (startX + dashWidth).clamp(0, size.width).toDouble();
      canvas.drawLine(
        Offset(startX, size.height / 2),
        Offset(endX, size.height / 2),
        paint,
      );
      startX += dashWidth + dashGap;
    }
  }

  @override
  bool shouldRepaint(covariant _CutLinePainter old) => old.color != color;
}

/// Save + Share action pair, responsive and with haptic feedback.
class TpReceiptActions extends StatelessWidget {
  final bool isSaving;
  final bool isSharing;
  final VoidCallback onSave;
  final VoidCallback onShare;

  const TpReceiptActions({
    super.key,
    required this.isSaving,
    required this.isSharing,
    required this.onSave,
    required this.onShare,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final saveButton = OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: isSaving
          ? null
          : () {
              Haptics.light();
              onSave();
            },
      icon: isSaving
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.download_rounded, size: 18),
      label: const Text('Save', maxLines: 1, overflow: TextOverflow.ellipsis),
    );

    final shareButton = FilledButton.icon(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      onPressed: isSharing
          ? null
          : () {
              Haptics.medium();
              onShare();
            },
      icon: isSharing
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.ios_share_rounded, size: 18),
      label: const Text('Share', maxLines: 1, overflow: TextOverflow.ellipsis),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 420) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              saveButton,
              const SizedBox(height: AppSpacing.sm),
              shareButton,
            ],
          );
        }
        return Row(
          children: [
            Expanded(child: saveButton),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: shareButton),
          ],
        );
      },
    );
  }
}

/// A subtle informational note panel, used below receipt actions.
class TpReceiptInfoPanel extends StatelessWidget {
  final String text;

  const TpReceiptInfoPanel({super.key, required this.text});

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
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded,
              size: 18, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(text, style: AppTextStyles.bodyS)),
        ],
      ),
    );
  }
}
