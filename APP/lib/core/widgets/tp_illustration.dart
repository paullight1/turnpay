import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// The set of hand-built vector illustrations available across TrustPay.
///
/// Every illustration is drawn with a [CustomPainter] using [AppColors], so it
/// adapts automatically to light/dark mode and never ships a binary asset.
enum TpIllustrationVariant {
  emptyTransactions,
  emptyRecipients,
  emptyWallet,
  emptySearch,
  emptyNotifications,
  success,
  error,
  security,
  connectionLost,
  receipt,
  send,
  exchange,
  kyc,
  celebrate,
}

/// A tasteful, theme-aware vector illustration.
///
/// By default it gently floats (respecting the platform "reduce motion"
/// setting). Set [animate] to false for a static render (e.g. inside a receipt
/// that gets captured to an image).
class TpIllustration extends StatefulWidget {
  final TpIllustrationVariant variant;
  final double size;
  final bool animate;
  final Color? accent;
  final String? semanticLabel;

  const TpIllustration({
    super.key,
    required this.variant,
    this.size = 160,
    this.animate = true,
    this.accent,
    this.semanticLabel,
  });

  @override
  State<TpIllustration> createState() => _TpIllustrationState();
}

class _TpIllustrationState extends State<TpIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 3600),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncMotion();
  }

  @override
  void didUpdateWidget(covariant TpIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.animate != widget.animate) _syncMotion();
  }

  void _syncMotion() {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (widget.animate && !reduceMotion) {
      if (!_controller.isAnimating) _controller.repeat();
    } else {
      _controller
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final accent = widget.accent ?? AppColors.primary;
    return Semantics(
      label: widget.semanticLabel ?? _defaultLabel(widget.variant),
      image: true,
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final t = _controller.value;
            final bob = math.sin(t * 2 * math.pi) * (widget.size * 0.018);
            return Transform.translate(
              offset: Offset(0, bob),
              child: CustomPaint(
                painter: _IllustrationPainter(
                  variant: widget.variant,
                  accent: accent,
                  isDark: AppColors.isDark,
                  surface: AppColors.surface,
                  surfaceVariant: AppColors.surfaceVariant,
                  border: AppColors.border,
                  success: AppColors.success,
                  warning: AppColors.warning,
                  error: AppColors.error,
                  textHint: AppColors.textHint,
                  t: t,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

String _defaultLabel(TpIllustrationVariant variant) {
  switch (variant) {
    case TpIllustrationVariant.emptyTransactions:
      return 'No transactions yet';
    case TpIllustrationVariant.emptyRecipients:
      return 'No saved recipients';
    case TpIllustrationVariant.emptyWallet:
      return 'Empty wallet';
    case TpIllustrationVariant.emptySearch:
      return 'No results found';
    case TpIllustrationVariant.emptyNotifications:
      return 'No notifications';
    case TpIllustrationVariant.success:
      return 'Success';
    case TpIllustrationVariant.error:
      return 'Something went wrong';
    case TpIllustrationVariant.security:
      return 'Secure';
    case TpIllustrationVariant.connectionLost:
      return 'No connection';
    case TpIllustrationVariant.receipt:
      return 'Receipt';
    case TpIllustrationVariant.send:
      return 'Send money';
    case TpIllustrationVariant.exchange:
      return 'Currency exchange';
    case TpIllustrationVariant.kyc:
      return 'Identity verification';
    case TpIllustrationVariant.celebrate:
      return 'Celebration';
  }
}

class _IllustrationPainter extends CustomPainter {
  final TpIllustrationVariant variant;
  final Color accent;
  final bool isDark;
  final Color surface;
  final Color surfaceVariant;
  final Color border;
  final Color success;
  final Color warning;
  final Color error;
  final Color textHint;
  final double t;

  _IllustrationPainter({
    required this.variant,
    required this.accent,
    required this.isDark,
    required this.surface,
    required this.surfaceVariant,
    required this.border,
    required this.success,
    required this.warning,
    required this.error,
    required this.textHint,
    required this.t,
  });

  @override
  void paint(Canvas canvas, Size size) {
    _paintBackdrop(canvas, size);
    switch (variant) {
      case TpIllustrationVariant.emptyTransactions:
      case TpIllustrationVariant.receipt:
        _paintReceipt(canvas, size);
        break;
      case TpIllustrationVariant.emptyRecipients:
        _paintPeople(canvas, size);
        break;
      case TpIllustrationVariant.emptyWallet:
        _paintWallet(canvas, size);
        break;
      case TpIllustrationVariant.emptySearch:
        _paintSearch(canvas, size);
        break;
      case TpIllustrationVariant.emptyNotifications:
        _paintBell(canvas, size);
        break;
      case TpIllustrationVariant.success:
      case TpIllustrationVariant.celebrate:
        _paintSuccess(canvas, size);
        break;
      case TpIllustrationVariant.error:
        _paintError(canvas, size);
        break;
      case TpIllustrationVariant.security:
        _paintShield(canvas, size);
        break;
      case TpIllustrationVariant.connectionLost:
        _paintConnection(canvas, size);
        break;
      case TpIllustrationVariant.send:
        _paintSend(canvas, size);
        break;
      case TpIllustrationVariant.exchange:
        _paintExchange(canvas, size);
        break;
      case TpIllustrationVariant.kyc:
        _paintKyc(canvas, size);
        break;
    }
  }

  // ---- shared helpers -------------------------------------------------------

  Paint get _fillSurface => Paint()
    ..style = PaintingStyle.fill
    ..color = surface;

  Paint _fill(Color c) => Paint()
    ..style = PaintingStyle.fill
    ..color = c;

  Paint _stroke(Color c, double w) => Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = w
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..color = c;

  void _paintBackdrop(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    // Soft radial-ish blob using layered translucent circles.
    canvas.drawCircle(
      c,
      size.width * 0.44,
      _fill(accent.withValues(alpha: isDark ? 0.10 : 0.08)),
    );
    canvas.drawCircle(
      c.translate(size.width * 0.14, -size.height * 0.1),
      size.width * 0.30,
      _fill(accent.withValues(alpha: isDark ? 0.07 : 0.06)),
    );
    // Orbiting accent dots for a little life.
    for (var i = 0; i < 3; i++) {
      final ang = (t * 2 * math.pi) + (i * 2 * math.pi / 3);
      final r = size.width * (0.40 + 0.02 * i);
      final p = c + Offset(math.cos(ang) * r, math.sin(ang) * r * 0.62);
      canvas.drawCircle(
        p,
        size.width * (0.012 + 0.006 * (i % 2)),
        _fill(accent.withValues(alpha: 0.35 - i * 0.08)),
      );
    }
  }

  RRect _rrect(Rect r, double radius) =>
      RRect.fromRectAndRadius(r, Radius.circular(radius));

  // ---- variants -------------------------------------------------------------

  void _paintReceipt(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final cardRect = Rect.fromLTWH(w * 0.30, h * 0.22, w * 0.40, h * 0.56);
    _softShadow(canvas, cardRect, 20);
    // Torn-bottom receipt using a path.
    final path = Path()
      ..moveTo(cardRect.left, cardRect.top + 16)
      ..quadraticBezierTo(
          cardRect.left, cardRect.top, cardRect.left + 16, cardRect.top)
      ..lineTo(cardRect.right - 16, cardRect.top)
      ..quadraticBezierTo(
          cardRect.right, cardRect.top, cardRect.right, cardRect.top + 16)
      ..lineTo(cardRect.right, cardRect.bottom - 8);
    const teeth = 5;
    final step = cardRect.width / teeth;
    for (var i = 0; i < teeth; i++) {
      final x = cardRect.right - step * i;
      path.lineTo(x - step / 2, cardRect.bottom);
      path.lineTo(x - step, cardRect.bottom - 8);
    }
    path
      ..lineTo(cardRect.left, cardRect.top + 16)
      ..close();
    canvas.drawPath(path, _fillSurface);
    canvas.drawPath(path, _stroke(border, 1.4));

    // Lines of text.
    final lineX = cardRect.left + w * 0.05;
    final lineW = cardRect.width - w * 0.10;
    for (var i = 0; i < 4; i++) {
      final y = cardRect.top + h * 0.12 + i * h * 0.085;
      final frac = i == 0 ? 1.0 : (i.isEven ? 0.55 : 0.8);
      canvas.drawRRect(
        _rrect(Rect.fromLTWH(lineX, y, lineW * frac, h * 0.022), 6),
        _fill(i == 0 ? accent.withValues(alpha: 0.85) : textHint.withValues(alpha: 0.4)),
      );
    }
    // Magnifier accent when it's an "empty" search-ish state.
    final gc = Offset(w * 0.66, h * 0.62);
    canvas.drawCircle(gc, w * 0.11, _fill(surfaceVariant));
    canvas.drawCircle(gc, w * 0.11, _stroke(accent, 3));
    canvas.drawLine(
      gc + Offset(w * 0.08, w * 0.08),
      gc + Offset(w * 0.15, w * 0.15),
      _stroke(accent, 3.4),
    );
  }

  void _paintPeople(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    void avatar(Offset c, double r, Color col, double alpha) {
      final rect = Rect.fromCircle(center: c, radius: r);
      _softShadow(canvas, rect, r);
      canvas.drawCircle(c, r, _fillSurface);
      canvas.drawCircle(c, r, _stroke(border, 1.4));
      // head
      canvas.drawCircle(
          c.translate(0, -r * 0.28), r * 0.30, _fill(col.withValues(alpha: alpha)));
      // shoulders
      final body = Path();
      final bc = c.translate(0, r * 0.5);
      body.addArc(
        Rect.fromCircle(center: bc, radius: r * 0.55),
        math.pi,
        math.pi,
      );
      canvas.drawPath(body, _fill(col.withValues(alpha: alpha)));
    }

    avatar(Offset(w * 0.35, h * 0.52), w * 0.15, textHint, 0.5);
    avatar(Offset(w * 0.62, h * 0.46), w * 0.17, accent, 0.9);
    // plus badge
    final badge = Offset(w * 0.75, h * 0.62);
    canvas.drawCircle(badge, w * 0.09, _fill(success));
    canvas.drawLine(badge.translate(-w * 0.035, 0), badge.translate(w * 0.035, 0),
        _stroke(Colors.white, 3));
    canvas.drawLine(badge.translate(0, -w * 0.035), badge.translate(0, w * 0.035),
        _stroke(Colors.white, 3));
  }

  void _paintWallet(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final rect = Rect.fromLTWH(w * 0.24, h * 0.34, w * 0.52, h * 0.34);
    _softShadow(canvas, rect, 18);
    canvas.drawRRect(_rrect(rect, 16), _fill(accent));
    canvas.drawRRect(
      _rrect(Rect.fromLTWH(rect.left, rect.top, rect.width, rect.height * 0.42), 16),
      _fill(Colors.white.withValues(alpha: 0.18)),
    );
    // clasp / button
    final clasp = Rect.fromLTWH(
        rect.right - w * 0.16, rect.center.dy - h * 0.05, w * 0.14, h * 0.1);
    canvas.drawRRect(_rrect(clasp, 10), _fill(surface));
    canvas.drawCircle(clasp.center, w * 0.022, _fill(accent));
    // floating coin
    final coin = Offset(w * 0.5, h * 0.26 + math.sin(t * 2 * math.pi) * h * 0.02);
    canvas.drawCircle(coin, w * 0.075, _fill(warning));
    canvas.drawCircle(coin, w * 0.075, _stroke(Colors.white.withValues(alpha: 0.6), 2));
    _centeredGlyph(canvas, coin, w * 0.075, '₦', Colors.white);
  }

  void _paintSearch(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final gc = Offset(w * 0.45, h * 0.45);
    final r = w * 0.20;
    canvas.drawCircle(gc, r, _fillSurface);
    canvas.drawCircle(gc, r, _stroke(accent, 5));
    canvas.drawLine(
      gc + Offset(r * 0.72, r * 0.72),
      gc + Offset(r * 1.7, r * 1.7),
      _stroke(accent, 6),
    );
    // question mark inside
    _centeredGlyph(canvas, gc, r, '?', accent);
  }

  void _paintBell(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final cx = w * 0.5;
    final top = h * 0.30;
    final path = Path()
      ..moveTo(cx, top)
      ..cubicTo(cx + w * 0.16, top + h * 0.02, cx + w * 0.17, top + h * 0.22,
          cx + w * 0.19, top + h * 0.3)
      ..lineTo(cx - w * 0.19, top + h * 0.3)
      ..cubicTo(cx - w * 0.17, top + h * 0.22, cx - w * 0.16, top + h * 0.02, cx,
          top);
    canvas.drawPath(path, _fill(accent));
    canvas.drawRRect(
      _rrect(Rect.fromCenter(center: Offset(cx, top + h * 0.31), width: w * 0.44, height: h * 0.03), 8),
      _fill(accent),
    );
    canvas.drawCircle(Offset(cx, top + h * 0.37), w * 0.03, _fill(accent));
    canvas.drawCircle(Offset(cx, top), w * 0.03, _fill(textHint.withValues(alpha: 0.6)));
  }

  void _paintSuccess(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final c = Offset(w * 0.5, h * 0.5);
    final r = w * 0.20;
    canvas.drawCircle(c, r * 1.5, _fill(success.withValues(alpha: 0.14)));
    canvas.drawCircle(c, r, _fill(success));
    final check = Path()
      ..moveTo(c.dx - r * 0.42, c.dy + r * 0.02)
      ..lineTo(c.dx - r * 0.1, c.dy + r * 0.4)
      ..lineTo(c.dx + r * 0.5, c.dy - r * 0.4);
    canvas.drawPath(check, _stroke(Colors.white, 5));
    // confetti sparks
    for (var i = 0; i < 6; i++) {
      final ang = i * math.pi / 3 + t * 2 * math.pi;
      final p = c + Offset(math.cos(ang), math.sin(ang)) * r * 2.1;
      canvas.drawCircle(
          p, w * 0.015, _fill([accent, warning, success][i % 3].withValues(alpha: 0.8)));
    }
  }

  void _paintError(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final c = Offset(w * 0.5, h * 0.5);
    final r = w * 0.20;
    canvas.drawCircle(c, r * 1.5, _fill(error.withValues(alpha: 0.14)));
    canvas.drawCircle(c, r, _fill(error));
    canvas.drawLine(c.translate(-r * 0.42, -r * 0.42),
        c.translate(r * 0.42, r * 0.42), _stroke(Colors.white, 5));
    canvas.drawLine(c.translate(r * 0.42, -r * 0.42),
        c.translate(-r * 0.42, r * 0.42), _stroke(Colors.white, 5));
  }

  void _paintShield(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final cx = w * 0.5;
    final top = h * 0.26;
    final rect = Rect.fromLTWH(w * 0.30, top, w * 0.40, h * 0.30);
    final path = Path()
      ..moveTo(cx, top)
      ..lineTo(rect.right, top + h * 0.06)
      ..lineTo(rect.right, top + h * 0.24)
      ..quadraticBezierTo(rect.right, top + h * 0.42, cx, top + h * 0.48)
      ..quadraticBezierTo(rect.left, top + h * 0.42, rect.left, top + h * 0.24)
      ..lineTo(rect.left, top + h * 0.06)
      ..close();
    _softShadow(canvas, rect, 16);
    canvas.drawPath(path, _fill(accent));
    canvas.drawPath(path, _stroke(Colors.white.withValues(alpha: 0.25), 2));
    // check
    final c = Offset(cx, top + h * 0.22);
    final r = w * 0.12;
    final check = Path()
      ..moveTo(c.dx - r * 0.5, c.dy)
      ..lineTo(c.dx - r * 0.12, c.dy + r * 0.42)
      ..lineTo(c.dx + r * 0.6, c.dy - r * 0.42);
    canvas.drawPath(check, _stroke(Colors.white, 5));
  }

  void _paintConnection(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final base = Offset(w * 0.5, h * 0.62);
    for (var i = 3; i >= 1; i--) {
      final r = w * 0.12 * i;
      canvas.drawArc(
        Rect.fromCircle(center: base, radius: r),
        math.pi * 1.15,
        math.pi * 0.7,
        false,
        _stroke(accent.withValues(alpha: 0.3 + i * 0.18), 5),
      );
    }
    canvas.drawCircle(base, w * 0.035, _fill(accent));
    // slash
    canvas.drawLine(
      Offset(w * 0.3, h * 0.28),
      Offset(w * 0.7, h * 0.7),
      _stroke(error, 5),
    );
  }

  void _paintSend(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final c = Offset(w * 0.5, h * 0.5);
    // paper plane
    final drift = math.sin(t * 2 * math.pi) * w * 0.02;
    final plane = Path()
      ..moveTo(c.dx - w * 0.22 + drift, c.dy - h * 0.02)
      ..lineTo(c.dx + w * 0.24 + drift, c.dy - h * 0.20)
      ..lineTo(c.dx + w * 0.08 + drift, c.dy + h * 0.22)
      ..lineTo(c.dx + w * 0.02 + drift, c.dy + h * 0.04)
      ..close();
    _softShadow(canvas, plane.getBounds(), 12);
    canvas.drawPath(plane, _fill(accent));
    final fold = Path()
      ..moveTo(c.dx - w * 0.22 + drift, c.dy - h * 0.02)
      ..lineTo(c.dx + w * 0.02 + drift, c.dy + h * 0.04)
      ..lineTo(c.dx + w * 0.24 + drift, c.dy - h * 0.20);
    canvas.drawPath(fold, _stroke(Colors.white.withValues(alpha: 0.5), 2));
    // motion trail
    for (var i = 0; i < 3; i++) {
      final x = c.dx - w * 0.24 - i * w * 0.06 + drift;
      canvas.drawLine(Offset(x, c.dy + i * h * 0.04), Offset(x - w * 0.05, c.dy + i * h * 0.04),
          _stroke(accent.withValues(alpha: 0.4 - i * 0.1), 3));
    }
  }

  void _paintExchange(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final left = Offset(w * 0.36, h * 0.5);
    final right = Offset(w * 0.64, h * 0.5);
    final r = w * 0.13;
    canvas.drawCircle(left, r, _fill(accent));
    _centeredGlyph(canvas, left, r, '₦', Colors.white);
    canvas.drawCircle(right, r, _fill(success));
    _centeredGlyph(canvas, right, r, '\$', Colors.white);
    // rotating swap arrows
    final mid = Offset(w * 0.5, h * 0.5);
    canvas.save();
    canvas.translate(mid.dx, mid.dy);
    canvas.rotate(t * 2 * math.pi);
    final top = Path()
      ..moveTo(-w * 0.06, -h * 0.14)
      ..lineTo(w * 0.06, -h * 0.14);
    canvas.drawPath(top, _stroke(textHint, 3));
    canvas.drawPath(
        Path()
          ..moveTo(w * 0.03, -h * 0.17)
          ..lineTo(w * 0.06, -h * 0.14)
          ..lineTo(w * 0.03, -h * 0.11),
        _stroke(textHint, 3));
    canvas.drawPath(
        Path()
          ..moveTo(-w * 0.03, h * 0.17)
          ..lineTo(-w * 0.06, h * 0.14)
          ..lineTo(-w * 0.03, h * 0.11),
        _stroke(textHint, 3));
    canvas.drawLine(Offset(-w * 0.06, h * 0.14), Offset(w * 0.06, h * 0.14),
        _stroke(textHint, 3));
    canvas.restore();
  }

  void _paintKyc(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final rect = Rect.fromLTWH(w * 0.24, h * 0.32, w * 0.52, h * 0.36);
    _softShadow(canvas, rect, 16);
    canvas.drawRRect(_rrect(rect, 14), _fillSurface);
    canvas.drawRRect(_rrect(rect, 14), _stroke(border, 1.4));
    // photo circle
    final pc = Offset(rect.left + w * 0.13, rect.center.dy);
    canvas.drawCircle(pc, w * 0.07, _fill(accent.withValues(alpha: 0.85)));
    canvas.drawCircle(pc.translate(0, -w * 0.02), w * 0.025, _fill(surface));
    canvas.drawArc(Rect.fromCircle(center: pc.translate(0, w * 0.05), radius: w * 0.045),
        math.pi, math.pi, false, _fill(surface));
    // detail lines
    for (var i = 0; i < 3; i++) {
      final y = rect.top + h * 0.09 + i * h * 0.08;
      canvas.drawRRect(
        _rrect(Rect.fromLTWH(rect.left + w * 0.24, y, w * 0.24 * (1 - i * 0.2), h * 0.02), 5),
        _fill(textHint.withValues(alpha: 0.4)),
      );
    }
    // verified badge
    final badge = Offset(rect.right - w * 0.04, rect.bottom - h * 0.04);
    canvas.drawCircle(badge, w * 0.06, _fill(success));
    final check = Path()
      ..moveTo(badge.dx - w * 0.025, badge.dy)
      ..lineTo(badge.dx - w * 0.005, badge.dy + w * 0.02)
      ..lineTo(badge.dx + w * 0.03, badge.dy - w * 0.022);
    canvas.drawPath(check, _stroke(Colors.white, 3));
  }

  // ---- primitives -----------------------------------------------------------

  void _softShadow(Canvas canvas, Rect rect, double radius) {
    canvas.drawRRect(
      _rrect(rect.translate(0, 8), radius),
      Paint()
        ..color = Colors.black.withValues(alpha: isDark ? 0.35 : 0.10)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12),
    );
  }

  void _centeredGlyph(Canvas canvas, Offset center, double r, String glyph, Color color) {
    final tp = TextPainter(
      text: TextSpan(
        text: glyph,
        style: TextStyle(
          color: color,
          fontSize: r * 1.15,
          fontWeight: FontWeight.w800,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(covariant _IllustrationPainter old) =>
      old.t != t ||
      old.variant != variant ||
      old.accent != accent ||
      old.isDark != isDark;
}
