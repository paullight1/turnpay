import 'package:flutter/material.dart';

import 'legal_page_service.dart';

class LegalPageLink extends StatelessWidget {
  const LegalPageLink({
    super.key,
    required this.label,
    required this.fragment,
    required this.style,
  });

  final String label;
  final String fragment;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    final foregroundColor =
        style.color ?? Theme.of(context).colorScheme.primary;

    return TextButton(
      onPressed: () => openTrustPayLegalPage(fragment: fragment),
      style: TextButton.styleFrom(
        minimumSize: Size.zero,
        padding: EdgeInsets.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
        foregroundColor: foregroundColor,
      ),
      child: Text(label, style: style),
    );
  }
}
