import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../services/kora_service.dart';
import '../../services/auth_service.dart';
import '../../services/transaction_security_service.dart';
import '../security/screens/transaction_security_screen.dart';

String ghanaError(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['message'] is String) {
      return data['message'] as String;
    }
    return 'We could not confirm the response. Check the payment status before starting again.';
  }
  if (error is FormatException) return error.message;
  return 'This payment could not be confirmed. Refresh its status or contact support.';
}

Future<String?> requireGhanaPin(BuildContext context) async {
  final auth = AuthService(), security = TransactionSecurityService();
  final status = await auth.getTransactionPinStatus();
  if (!context.mounted) return null;
  if (!status.configured ||
      status.locked ||
      (status.resetHoldUntil?.isAfter(DateTime.now().toUtc()) ?? false)) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Check your transaction PIN settings in Security & Limits before continuing.')));
    return null;
  }
  final device = await security.getConfig();
  if (!context.mounted) return null;
  return Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => TransactionPinScreen.verify(
          pinLength: status.pinLength ?? device.pinLength,
          title: 'Enter your transaction PIN',
          subtitle: 'Approve the amount and recipient you just reviewed.',
          securityService: security,
          authService: auth)));
}

class KoraMomoPaymentCard extends StatefulWidget {
  final KoraService service;
  final String? orderId, amount;
  final Map<String, dynamic>? initialPayment;
  final VoidCallback onConfirmed;
  const KoraMomoPaymentCard(
      {super.key,
      required this.service,
      this.orderId,
      this.amount,
      this.initialPayment,
      required this.onConfirmed});
  @override
  State<KoraMomoPaymentCard> createState() => _KoraMomoPaymentCardState();
}

class _KoraMomoPaymentCardState extends State<KoraMomoPaymentCard>
    with WidgetsBindingObserver {
  final _phone = TextEditingController(), _otp = TextEditingController();
  Map<String, dynamic>? _payment;
  String? _error;
  bool _busy = false, _foreground = true, _notified = false;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _payment = widget.initialPayment;
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted &&
          TickerMode.valuesOf(context).enabled &&
          _foreground &&
          _payment != null &&
          _payment!['status'] != 'SUCCESS' &&
          !_busy) {
        unawaited(_check());
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _phone.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() operation) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payment = await operation();
      if (!mounted) return;
      setState(() => _payment = payment);
      if (payment['status'] == 'SUCCESS' && !_notified) {
        _notified = true;
        widget.onConfirmed();
      }
    } catch (error) {
      if (mounted) setState(() => _error = ghanaError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _check() =>
      _run(() => widget.service.refreshPayment('${_payment!['id']}'));
  @override
  Widget build(BuildContext context) {
    final auth = _payment?['authorization'] is Map
        ? Map<String, dynamic>.from(_payment!['authorization'] as Map)
        : <String, dynamic>{};
    final success = _payment?['status'] == 'SUCCESS';
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(success ? 'Payment confirmed' : 'Pay with MoMo',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  if (_payment == null) ...[
                    TextField(
                        controller: _phone,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                            labelText: 'Your Ghana MoMo number',
                            hintText: '0241234567'),
                        enabled: !_busy),
                    const SizedBox(height: 16),
                    FilledButton(
                        onPressed: _busy
                            ? null
                            : () => _run(() => widget.service.momo(
                                orderId: widget.orderId,
                                amount: widget.amount,
                                number: _phone.text)),
                        child: Text(_busy
                            ? 'Requesting payment…'
                            : 'Send payment request'))
                  ] else if (!success) ...[
                    Text(auth['model'] == 'OTP'
                        ? 'Enter the code sent to your phone.'
                        : 'Approve the payment on your phone. Enter your MoMo PIN only in the network prompt.'),
                    if (auth['model'] == 'OTP') ...[
                      const SizedBox(height: 12),
                      TextField(
                          controller: _otp,
                          obscureText: true,
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly
                          ],
                          maxLength: 8,
                          decoration: const InputDecoration(
                              labelText: 'Code from your network'),
                          enabled: !_busy),
                      FilledButton(
                          onPressed: _busy
                              ? null
                              : () => _run(() async {
                                    final code = _otp.text;
                                    _otp.clear();
                                    return widget.service.authorizePayment(
                                        '${_payment!['id']}', code);
                                  }),
                          child: const Text('Confirm code'))
                    ],
                    if (auth['model'] == 'REDIRECT' &&
                        auth['redirectUrl'] is String)
                      OutlinedButton(
                          onPressed: () async {
                            final url =
                                Uri.tryParse(auth['redirectUrl'] as String);
                            if (url != null &&
                                url.scheme == 'https' &&
                                url.userInfo.isEmpty) {
                              await launchUrl(url,
                                  mode: LaunchMode.externalApplication);
                            }
                          },
                          child: const Text('Open secure network approval')),
                    const SizedBox(height: 12),
                    OutlinedButton(
                        onPressed: _busy ? null : _check,
                        child: Text(
                            _busy ? 'Checking payment…' : 'Check payment')),
                  ] else
                    const Text(
                        'Your payment has been verified. You do not need to upload a receipt.'),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error))
                  ],
                ])));
  }
}
