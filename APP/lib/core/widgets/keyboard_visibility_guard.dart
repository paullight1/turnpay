import 'dart:async';

import 'package:flutter/material.dart';

/// Keeps focused inputs in scrollable forms above the software keyboard.
/// Scaffolds retain their native inset resizing; no duplicate padding is added.
class KeyboardVisibilityGuard extends StatefulWidget {
  final Widget child;
  const KeyboardVisibilityGuard({super.key, required this.child});

  @override
  State<KeyboardVisibilityGuard> createState() =>
      _KeyboardVisibilityGuardState();
}

class _KeyboardVisibilityGuardState extends State<KeyboardVisibilityGuard>
    with WidgetsBindingObserver {
  Timer? _settle;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_reveal);
  }

  @override
  void didChangeMetrics() => _reveal();

  void _reveal() {
    _settle?.cancel();
    _settle = Timer(const Duration(milliseconds: 220), () {
      if (!mounted || View.of(context).viewInsets.bottom == 0) return;
      final target = FocusManager.instance.primaryFocus?.context;
      if (target == null || !target.mounted) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.25,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    _settle?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    FocusManager.instance.removeListener(_reveal);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
