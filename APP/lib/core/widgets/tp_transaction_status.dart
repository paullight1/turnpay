import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../utils/haptics.dart';
import 'micro_interactions.dart';

/// The lifecycle state of a money movement, used across receipts, result
/// screens, transaction lists and inline feedback so the whole app speaks one
/// visual language for outcomes.
enum TpTxStatus { success, inProgress, pending, failed }

extension TpTxStatusX on TpTxStatus {
  Color get color {
    switch (this) {
      case TpTxStatus.success:
        return AppColors.success;
      case TpTxStatus.inProgress:
        return AppColors.primary;
      case TpTxStatus.pending:
        return AppColors.warning;
      case TpTxStatus.failed:
        return AppColors.error;
    }
  }

  String get label {
    switch (this) {
      case TpTxStatus.success:
        return 'Successful';
      case TpTxStatus.inProgress:
        return 'Processing';
      case TpTxStatus.pending:
        return 'Pending';
      case TpTxStatus.failed:
        return 'Failed';
    }
  }

  IconData get glyph {
    switch (this) {
      case TpTxStatus.success:
        return Icons.check_rounded;
      case TpTxStatus.inProgress:
        return Icons.sync_rounded;
      case TpTxStatus.pending:
        return Icons.schedule_rounded;
      case TpTxStatus.failed:
        return Icons.close_rounded;
    }
  }

  /// Maps a raw backend status string onto a visual state. Kept permissive so
  /// new provider statuses degrade to a sensible default rather than crash.
  static TpTxStatus fromString(String? raw) {
    switch ((raw ?? '').toUpperCase()) {
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
      case 'COMPLETE':
      case 'PAID':
      case 'SENT':
        return TpTxStatus.success;
      case 'PROCESSING':
      case 'IN_PROGRESS':
      case 'INITIATED':
        return TpTxStatus.inProgress;
      case 'FAILED':
      case 'REVERSED':
      case 'CANCELLED':
      case 'REJECTED':
      case 'ABANDONED':
        return TpTxStatus.failed;
      default:
        return TpTxStatus.pending;
    }
  }
}

/// A crisp, vector-drawn animated status icon. Deliberately asset-free (no
/// Lottie JSON) so it renders identically on every platform, tints itself from
/// the theme, and collapses to a static glyph when the OS requests reduced
/// motion. Success/failed play a one-shot draw-in; in-progress/pending loop.
class TpStatusIcon extends StatefulWidget {
  final TpTxStatus status;
  final double size;

  /// When false the icon renders in its finished state with no animation. Also
  /// forced off when the platform requests reduced motion.
  final bool animate;

  const TpStatusIcon({
    super.key,
    required this.status,
    this.size = 96,
    this.animate = true,
  });

  @override
  State<TpStatusIcon> createState() => _TpStatusIconState();
}

class _TpStatusIconState extends State<TpStatusIcon>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  bool get _looping =>
      widget.status == TpTxStatus.inProgress ||
      widget.status == TpTxStatus.pending;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _looping
          ? const Duration(milliseconds: 1400)
          : const Duration(milliseconds: 900),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncPlayback();
  }

  @override
  void didUpdateWidget(covariant TpStatusIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) {
      _controller.duration = _looping
          ? const Duration(milliseconds: 1400)
          : const Duration(milliseconds: 900);
      _controller.reset();
      _syncPlayback();
    }
  }

  void _syncPlayback() {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (!widget.animate || reduceMotion) {
      _controller.value = 1;
      return;
    }
    if (_looping) {
      _controller.repeat();
    } else {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.status.label,
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return CustomPaint(
              painter: _StatusPainter(
                status: widget.status,
                progress: _controller.value,
                color: widget.status.color,
                trackColor: AppColors.border,
              ),
            );
          },
        ),
      ),
    );
  }
}

class _StatusPainter extends CustomPainter {
  final TpTxStatus status;
  final double progress;
  final Color color;
  final Color trackColor;

  _StatusPainter({
    required this.status,
    required this.progress,
    required this.color,
    required this.trackColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2;
    final stroke = size.width * 0.075;

    switch (status) {
      case TpTxStatus.success:
        _paintDrawIn(canvas, center, radius, stroke, _tickPath(size));
        break;
      case TpTxStatus.failed:
        _paintDrawIn(canvas, center, radius, stroke, _crossPath(size));
        break;
      case TpTxStatus.inProgress:
        _paintSpinner(canvas, center, radius, stroke);
        break;
      case TpTxStatus.pending:
        _paintPending(canvas, center, radius, stroke);
        break;
    }
  }

  // Ring sweeps in over the first 55%, a soft halo blooms, then the glyph path
  // draws itself over the remaining time — the classic "confirmation" beat.
  void _paintDrawIn(
    Canvas canvas,
    Offset center,
    double radius,
    double stroke,
    Path glyph,
  ) {
    final ringT = Curves.easeOutCubic
        .transform((progress / 0.55).clamp(0.0, 1.0).toDouble());
    final glyphT = Curves.easeOutCubic
        .transform(((progress - 0.45) / 0.55).clamp(0.0, 1.0).toDouble());
    final ringRadius = radius - stroke;

    // Soft halo fill.
    final haloPaint = Paint()
      ..color = color.withValues(alpha: 0.12 * ringT)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(center, ringRadius * (0.6 + 0.4 * ringT), haloPaint);

    // Ring stroke sweeping from the top.
    final ringPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    final rect = Rect.fromCircle(center: center, radius: ringRadius);
    canvas.drawArc(rect, -math.pi / 2, 2 * math.pi * ringT, false, ringPaint);

    if (glyphT <= 0) return;
    final glyphPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(_partialPath(glyph, glyphT), glyphPaint);
  }

  // A rotating arc with a comet-style fade over a faint full-circle track.
  void _paintSpinner(
    Canvas canvas,
    Offset center,
    double radius,
    double stroke,
  ) {
    final ringRadius = radius - stroke;
    final rect = Rect.fromCircle(center: center, radius: ringRadius);

    final trackPaint = Paint()
      ..color = trackColor.withValues(alpha: 0.5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    canvas.drawCircle(center, ringRadius, trackPaint);

    final start = 2 * math.pi * progress;
    const sweep = math.pi * 0.62;
    final shader = SweepGradient(
      startAngle: start,
      endAngle: start + sweep,
      colors: [color.withValues(alpha: 0), color],
    ).createShader(rect);
    final arcPaint = Paint()
      ..shader = shader
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(rect, start, sweep, false, arcPaint);

    // Small leading dot for a friendlier read.
    final dotAngle = start + sweep;
    final dot = Offset(
      center.dx + ringRadius * math.cos(dotAngle),
      center.dy + ringRadius * math.sin(dotAngle),
    );
    canvas.drawCircle(dot, stroke * 0.5, Paint()..color = color);
  }

  // A steady ring with a gently pulsing clock — reads as "waiting on someone".
  void _paintPending(
    Canvas canvas,
    Offset center,
    double radius,
    double stroke,
  ) {
    final pulse = 0.5 + 0.5 * math.sin(progress * 2 * math.pi);
    final ringRadius = radius - stroke;

    canvas.drawCircle(
      center,
      ringRadius * (0.62 + 0.05 * pulse),
      Paint()..color = color.withValues(alpha: 0.10 + 0.06 * pulse),
    );

    final ringPaint = Paint()
      ..color = color.withValues(alpha: 0.85)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, ringRadius, ringPaint);

    // Clock hands.
    final handPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke * 0.75
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(center, center + Offset(0, -ringRadius * 0.45), handPaint);
    final minuteAngle = -math.pi / 2 + progress * 2 * math.pi;
    canvas.drawLine(
      center,
      center +
          Offset(
            math.cos(minuteAngle) * ringRadius * 0.6,
            math.sin(minuteAngle) * ringRadius * 0.6,
          ),
      handPaint,
    );
  }

  Path _tickPath(Size size) {
    final w = size.width;
    final h = size.height;
    return Path()
      ..moveTo(w * 0.30, h * 0.52)
      ..lineTo(w * 0.44, h * 0.66)
      ..lineTo(w * 0.71, h * 0.36);
  }

  Path _crossPath(Size size) {
    final w = size.width;
    final h = size.height;
    return Path()
      ..moveTo(w * 0.36, h * 0.36)
      ..lineTo(w * 0.64, h * 0.64)
      ..moveTo(w * 0.64, h * 0.36)
      ..lineTo(w * 0.36, h * 0.64);
  }

  // Returns the leading [t] fraction of [source], drawn segment-by-segment so
  // multi-subpath glyphs (like the cross) animate as a whole.
  Path _partialPath(Path source, double t) {
    final dest = Path();
    for (final metric in source.computeMetrics()) {
      dest.addPath(
        metric.extractPath(0, metric.length * t),
        Offset.zero,
      );
    }
    return dest;
  }

  @override
  bool shouldRepaint(covariant _StatusPainter old) =>
      old.progress != progress ||
      old.status != status ||
      old.color != color;
}

/// A compact status chip for transaction lists and detail rows.
class TpStatusPill extends StatelessWidget {
  final TpTxStatus status;
  final String? label;

  const TpStatusPill({super.key, required this.status, this.label});

  factory TpStatusPill.fromStatus(String? raw, {Key? key}) =>
      TpStatusPill(key: key, status: TpTxStatusX.fromString(raw));

  @override
  Widget build(BuildContext context) {
    final color = status.color;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm + 2,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(status.glyph, size: 13, color: color),
          const SizedBox(width: 5),
          Text(
            label ?? status.label,
            style: AppTextStyles.caption.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// One line item in a transaction result / receipt breakdown.
class TpDetailRow {
  final String label;
  final String value;
  final bool emphasize;
  final Color? valueColor;

  const TpDetailRow(
    this.label,
    this.value, {
    this.emphasize = false,
    this.valueColor,
  });
}

/// A full result body shown after initiating a money movement. Composes the
/// animated status icon, an animated amount, headline, a details card and
/// action buttons. Designed to sit inside a Scaffold body.
class TpTransactionResultView extends StatefulWidget {
  final TpTxStatus status;
  final String title;
  final String message;

  /// Optional hero amount (already formatted, e.g. "₦25,000.00").
  final String? amount;
  final List<TpDetailRow> details;
  final Widget? primaryAction;
  final Widget? secondaryAction;

  const TpTransactionResultView({
    super.key,
    required this.status,
    required this.title,
    required this.message,
    this.amount,
    this.details = const [],
    this.primaryAction,
    this.secondaryAction,
  });

  @override
  State<TpTransactionResultView> createState() =>
      _TpTransactionResultViewState();
}

class _TpTransactionResultViewState extends State<TpTransactionResultView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      switch (widget.status) {
        case TpTxStatus.success:
          Haptics.success();
          break;
        case TpTxStatus.failed:
          Haptics.error();
          break;
        case TpTxStatus.pending:
        case TpTxStatus.inProgress:
          Haptics.warning();
          break;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          children: [
            const Spacer(),
            StaggeredEntrance(
              child: TpStatusIcon(status: widget.status, size: 108),
            ),
            const SizedBox(height: AppSpacing.lg),
            StaggeredEntrance(
              delay: const Duration(milliseconds: 80),
              child: Text(
                widget.title,
                style: AppTextStyles.headingL,
                textAlign: TextAlign.center,
              ),
            ),
            if (widget.amount != null) ...[
              const SizedBox(height: AppSpacing.sm),
              StaggeredEntrance(
                delay: const Duration(milliseconds: 130),
                child: AnimatedValueText(
                  value: widget.amount!,
                  style: AppTextStyles.displayMedium.copyWith(
                    color: widget.status.color,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.sm),
            StaggeredEntrance(
              delay: const Duration(milliseconds: 170),
              child: Text(
                widget.message,
                style: AppTextStyles.bodyM,
                textAlign: TextAlign.center,
              ),
            ),
            if (widget.details.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.lg),
              StaggeredEntrance(
                delay: const Duration(milliseconds: 220),
                child: _DetailsCard(rows: widget.details),
              ),
            ],
            const Spacer(),
            if (widget.primaryAction != null)
              StaggeredEntrance(
                delay: const Duration(milliseconds: 260),
                child: SizedBox(
                  width: double.infinity,
                  child: widget.primaryAction,
                ),
              ),
            if (widget.secondaryAction != null) ...[
              const SizedBox(height: AppSpacing.sm),
              SizedBox(width: double.infinity, child: widget.secondaryAction),
            ],
          ],
        ),
      ),
    );
  }
}

class _DetailsCard extends StatelessWidget {
  final List<TpDetailRow> rows;

  const _DetailsCard({required this.rows});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0)
              Divider(height: AppSpacing.md, color: AppColors.divider),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(rows[i].label, style: AppTextStyles.bodyM),
                ),
                const SizedBox(width: AppSpacing.md),
                Flexible(
                  child: Text(
                    rows[i].value,
                    textAlign: TextAlign.right,
                    style: (rows[i].emphasize
                            ? AppTextStyles.labelL
                            : AppTextStyles.labelM)
                        .copyWith(color: rows[i].valueColor),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// A vertical step tracker for a multi-stage money movement, e.g.
/// "Amount debited → Sent to bank → Bank confirmed". The active step pulses
/// via the shared in-progress icon; completed steps show a static tick.
class TpStatusStep {
  final String title;
  final String? subtitle;

  const TpStatusStep(this.title, {this.subtitle});
}

class TpStatusStepTracker extends StatelessWidget {
  final List<TpStatusStep> steps;

  /// Index of the currently active step. Steps before it are complete; steps
  /// after it are upcoming. Set to [steps.length] when everything is done.
  final int currentIndex;

  /// When true the active step renders as failed rather than in-progress.
  final bool failedAtCurrent;

  const TpStatusStepTracker({
    super.key,
    required this.steps,
    required this.currentIndex,
    this.failedAtCurrent = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < steps.length; i++)
          _StepTile(
            step: steps[i],
            state: _stateFor(i),
            isLast: i == steps.length - 1,
          ),
      ],
    );
  }

  _StepState _stateFor(int i) {
    if (i < currentIndex) return _StepState.done;
    if (i == currentIndex) {
      return failedAtCurrent ? _StepState.failed : _StepState.active;
    }
    return _StepState.upcoming;
  }
}

enum _StepState { done, active, failed, upcoming }

class _StepTile extends StatelessWidget {
  final TpStatusStep step;
  final _StepState state;
  final bool isLast;

  const _StepTile({
    required this.step,
    required this.state,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    final Color accent;
    switch (state) {
      case _StepState.done:
        accent = AppColors.success;
        break;
      case _StepState.active:
        accent = AppColors.primary;
        break;
      case _StepState.failed:
        accent = AppColors.error;
        break;
      case _StepState.upcoming:
        accent = AppColors.border;
        break;
    }

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              _marker(accent),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    margin: const EdgeInsets.symmetric(vertical: 2),
                    color: state == _StepState.done
                        ? AppColors.success
                        : AppColors.border,
                  ),
                ),
            ],
          ),
          const SizedBox(width: AppSpacing.md),
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  step.title,
                  style: AppTextStyles.labelM.copyWith(
                    color: state == _StepState.upcoming
                        ? AppColors.textHint
                        : AppColors.textPrimary,
                  ),
                ),
                if (step.subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(step.subtitle!, style: AppTextStyles.bodyS),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _marker(Color accent) {
    const double d = 26;
    switch (state) {
      case _StepState.active:
        return const SizedBox(
          width: d,
          height: d,
          child: TpStatusIcon(status: TpTxStatus.inProgress, size: d),
        );
      case _StepState.done:
        return Container(
          width: d,
          height: d,
          decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
          child: const Icon(Icons.check_rounded, size: 15, color: Colors.white),
        );
      case _StepState.failed:
        return Container(
          width: d,
          height: d,
          decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
          child: const Icon(Icons.close_rounded, size: 15, color: Colors.white),
        );
      case _StepState.upcoming:
        return Container(
          width: d,
          height: d,
          decoration: BoxDecoration(
            color: AppColors.surface,
            shape: BoxShape.circle,
            border: Border.all(color: accent, width: 2),
          ),
        );
    }
  }
}
