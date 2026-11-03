import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class StartupGate extends StatefulWidget {
  const StartupGate(
      {super.key,
      required this.initialize,
      required this.builder,
      this.onError});
  final Future<void> Function() initialize;
  final WidgetBuilder builder;
  final void Function(Object error, StackTrace stack)? onError;
  @override
  State<StartupGate> createState() => _StartupGateState();
}

class _StartupGateState extends State<StartupGate> with WidgetsBindingObserver {
  bool _ready = false;
  bool _failed = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_failed && state == AppLifecycleState.resumed && !kIsWeb) {
      const MethodChannel('trustpay/app_privacy')
          .invokeMethod<void>('ready')
          .catchError((_) {});
    }
  }

  Future<void> _initialize() async {
    try {
      await widget.initialize();
      if (mounted) setState(() => _ready = true);
    } catch (error, stack) {
      widget.onError?.call(error, stack);
      if (!mounted) return;
      setState(() => _failed = true);
      // The failure screen has no authenticated data. Let iOS show its retry
      // action while the normal application remains behind the startup gate.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!kIsWeb) {
          const MethodChannel('trustpay/app_privacy')
              .invokeMethod<void>('ready')
              .catchError((_) {});
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_ready) return widget.builder(context);
    return MaterialApp(
        // This loading shell does not own deep links. The application router
        // reads the requested location after initialization completes.
        builder: (context, _) => Scaffold(
            body: SafeArea(
                child: Center(
                    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(_failed ? 'Unable to start TrustPay' : 'Starting TrustPay',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
        const SizedBox(height: 16),
        if (_failed) ...[
          const Text(
              'Check your connection and try again. If this continues, contact support.',
              textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton(
              onPressed: () {
                setState(() => _failed = false);
                _initialize();
              },
              child: const Text('Retry')),
        ] else
          const CircularProgressIndicator(),
      ]),
    )))));
  }
}
