import 'package:flutter/material.dart';

/// Paints immediately without a font or asset load, including on web.
class ExchangeCurrencyFlag extends StatelessWidget {
  final bool naira;
  final double width;

  const ExchangeCurrencyFlag({super.key, required this.naira, this.width = 30});

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: CustomPaint(
          size: Size(width, width * 2 / 3),
          painter: _FlagPainter(naira),
        ),
      ),
    );
  }
}

class _FlagPainter extends CustomPainter {
  final bool naira;

  const _FlagPainter(this.naira);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    if (naira) {
      final stripe = size.width / 3;
      canvas.drawRect(
          Offset.zero & size, paint..color = const Color(0xFF008753));
      canvas.drawRect(Rect.fromLTWH(stripe, 0, stripe, size.height),
          paint..color = Colors.white);
      return;
    }

    final stripe = size.height / 3;
    canvas.drawRect(Offset.zero & size, paint..color = const Color(0xFFFCD116));
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, stripe),
        paint..color = const Color(0xFFCE1126));
    canvas.drawRect(Rect.fromLTWH(0, stripe * 2, size.width, stripe),
        paint..color = const Color(0xFF006B3F));

    const points = [
      Offset(0, -1),
      Offset(.22, -.31),
      Offset(.95, -.31),
      Offset(.36, .12),
      Offset(.59, .81),
      Offset(0, .38),
      Offset(-.59, .81),
      Offset(-.36, .12),
      Offset(-.95, -.31),
      Offset(-.22, -.31),
    ];
    final center = size.center(Offset.zero);
    final path = Path()
      ..addPolygon(
          points.map((point) => center + point * (stripe * .54)).toList(),
          true);
    canvas.drawPath(path, paint..color = Colors.black);
  }

  @override
  bool shouldRepaint(_FlagPainter oldDelegate) => oldDelegate.naira != naira;
}
