import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class TpAuthBackground extends StatelessWidget {
  final Widget child;
  final bool showGradient;

  const TpAuthBackground({
    super.key,
    required this.child,
    this.showGradient = true,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Stack(
      fit: StackFit.expand,
      children: [
        if (showGradient)
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppColors.primary.withValues(alpha: 0.18),
                  AppColors.background.withValues(alpha: 0.92),
                  AppColors.background,
                ],
                stops: const [0, 0.48, 1],
              ),
            ),
          ),
        if (showGradient)
          Positioned(
            top: -88,
            right: -92,
            child: Container(
              width: 280,
              height: 280,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.14),
              ),
            ),
          ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 300,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppColors.background.withValues(alpha: 0),
                  AppColors.background.withValues(alpha: 0.94),
                  AppColors.background,
                ],
              ),
            ),
          ),
        ),
        child,
      ],
    );
  }
}
