import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/theme/app_theme.dart';
import '../../auth/widgets/tp_button.dart';

/// A device-local education preference, never an authorization or consent flag.
class ExchangeIntroductionPreference {
  static final instance = ExchangeIntroductionPreference();
  static const _key = 'exchange-introduction-started-v1';
  final FlutterSecureStorage _storage;
  bool _started = false;

  ExchangeIntroductionPreference({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  Future<bool> hasStarted() async {
    if (_started) return true;
    try {
      return _started = await _storage.read(key: _key) == 'true';
    } catch (_) {
      return false;
    }
  }

  Future<void> markStarted() async {
    _started = true;
    try {
      await _storage.write(key: _key, value: 'true');
    } catch (_) {
      // Education can still be dismissed for this session if storage is down.
    }
  }
}

class ExchangeIntroductionGate extends StatefulWidget {
  final ExchangeIntroductionPreference? preference;
  final bool resumePending;
  final bool showBackButton;
  final bool manualTransfer;
  final WidgetBuilder builder;

  const ExchangeIntroductionGate({
    super.key,
    this.preference,
    this.resumePending = false,
    this.showBackButton = true,
    this.manualTransfer = true,
    required this.builder,
  });

  @override
  State<ExchangeIntroductionGate> createState() =>
      _ExchangeIntroductionGateState();
}

class _ExchangeIntroductionGateState extends State<ExchangeIntroductionGate> {
  late final _preference =
      widget.preference ?? ExchangeIntroductionPreference.instance;
  late final Future<bool> _started = _preference.hasStarted();
  bool _continue = false;
  bool _busy = false;

  Future<void> _start() async {
    if (_busy) return;
    setState(() => _busy = true);
    await _preference.markStarted();
    if (mounted) {
      setState(() {
        _continue = true;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (widget.resumePending || _continue) {
      return widget.builder(context);
    }
    return FutureBuilder<bool>(
      future: _started,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
              body: Center(child: CircularProgressIndicator()));
        }
        if (snapshot.data == true) return widget.builder(context);
        return Scaffold(
          backgroundColor: AppColors.background,
          appBar: AppBar(
              title: const Text('Exchange'),
              centerTitle: true,
              automaticallyImplyLeading: widget.showBackButton),
          body: SafeArea(
            top: false,
            child: Column(children: [
              Expanded(
                  child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _ExchangeImageStrip(),
                        const SizedBox(height: 28),
                        Text('Exchange with\nconfidence.',
                            textAlign: TextAlign.center,
                            style: AppTextStyles.displayMedium.copyWith(
                                fontSize: 30, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 12),
                        Text(
                            'Move between naira and cedis. Here’s what you’ll need before you begin.',
                            textAlign: TextAlign.center,
                            style: AppTextStyles.bodyM),
                        const SizedBox(height: 28),
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: AppColors.border)),
                          child: Column(children: [
                            const _ExchangeStep(
                                icon: Icons.account_balance_outlined,
                                title: 'Your receiving account',
                                body:
                                    'You’ll enter the bank or mobile money details where you want to receive your exchange.'),
                            const SizedBox(height: 24),
                            _ExchangeStep(
                                icon: Icons.swap_horiz_rounded,
                                title: widget.manualTransfer
                                    ? 'Transfer and upload your receipt'
                                    : 'Review before you confirm',
                                body: widget.manualTransfer
                                    ? 'Review the rate, transfer to the account shown and upload proof of payment.'
                                    : 'Review your quote, receiving details and funding method before authorizing the exchange.'),
                            const SizedBox(height: 24),
                            _ExchangeStep(
                                icon: Icons.verified_user_outlined,
                                title: 'Confirmation before payout',
                                body: widget.manualTransfer
                                    ? 'We confirm your deposit before sending to your receiving account. Track updates in the app.'
                                    : 'Follow your payment instructions and track the exchange status in the app.'),
                          ]),
                        ),
                        const SizedBox(height: 20),
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: .06),
                              border: Border.all(
                                  color:
                                      AppColors.primary.withValues(alpha: .22)),
                              borderRadius: BorderRadius.circular(12)),
                          child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(Icons.info_outline_rounded,
                                    color: AppColors.primary, size: 22),
                                const SizedBox(width: 12),
                                Expanded(
                                    child: Text(
                                        widget.manualTransfer
                                            ? 'Double-check your receiving details. Only transfer after the app shows instructions for your exchange.'
                                            : 'Double-check your receiving details. The final quote shows your rate and fees before you confirm.',
                                        style: AppTextStyles.bodyS)),
                              ]),
                        ),
                      ],
                    ),
                  ),
                ),
              )),
              Padding(
                padding: EdgeInsets.fromLTRB(
                    24, 12, 24, widget.showBackButton ? 20 : 96),
                child: Center(
                    child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 520),
                        child: TpButton(
                            label: 'Get started',
                            isLoading: _busy,
                            onTap: _start))),
              ),
            ]),
          ),
        );
      },
    );
  }
}

class _ExchangeImageStrip extends StatelessWidget {
  const _ExchangeImageStrip();
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 132,
        child: Row(children: [
          for (final name in ['transfer', 'bills', 'security']) ...[
            if (name != 'transfer') const SizedBox(width: 10),
            Expanded(
                child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Image.asset('assets/images/onboarding_$name.jpg',
                        height: 132,
                        fit: BoxFit.cover,
                        excludeFromSemantics: true))),
          ],
        ]),
      );
}

class _ExchangeStep extends StatelessWidget {
  final IconData icon;
  final String title, body;
  const _ExchangeStep(
      {required this.icon, required this.title, required this.body});
  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, color: AppColors.primary, size: 22)),
          const SizedBox(width: 14),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    style: AppTextStyles.labelL
                        .copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 5),
                Text(body, style: AppTextStyles.bodyS.copyWith(height: 1.5)),
              ])),
        ],
      );
}
