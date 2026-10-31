import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_theme.dart';

/// The small, static illustrations used by the KYC review flow.
enum KycIllustrationKind {
  review,
  identity,
  verified,
}

/// A decorative KYC illustration that follows the active app brightness.
///
/// The source artwork is 240x180 (4:3). [size] is its requested maximum
/// width; the widget will shrink to the available constraints while preserving
/// that aspect ratio.
class KycIllustration extends StatelessWidget {
  final KycIllustrationKind kind;
  final double size;

  const KycIllustration({
    super.key,
    required this.kind,
    this.size = 160,
  });

  String _assetPath() {
    final suffix = AppColors.isDark ? '_dark' : '';
    switch (kind) {
      case KycIllustrationKind.review:
        return 'assets/images/kyc/review$suffix.svg';
      case KycIllustrationKind.identity:
        return 'assets/images/kyc/identity$suffix.svg';
      case KycIllustrationKind.verified:
        return 'assets/images/kyc/verified$suffix.svg';
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final requestedWidth = size.isFinite && size > 0 ? size : 160.0;
    final assetPath = _assetPath();

    return ExcludeSemantics(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final availableWidth = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : requestedWidth;
          final availableHeight = constraints.maxHeight.isFinite
              ? constraints.maxHeight
              : requestedWidth * 0.75;
          final width = math.min(
            requestedWidth,
            math.min(availableWidth, availableHeight * (4 / 3)),
          );
          final boundedWidth = width.isFinite
              ? width.clamp(0.0, requestedWidth).toDouble()
              : requestedWidth;

          return SizedBox(
            width: boundedWidth,
            height: boundedWidth * 0.75,
            child: SvgPicture.asset(
              assetPath,
              fit: BoxFit.contain,
              excludeFromSemantics: true,
            ),
          );
        },
      ),
    );
  }
}
