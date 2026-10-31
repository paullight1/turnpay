import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/tp_page_header.dart';
import '../../core/state/wallet_refresh_signal.dart';
import '../../core/money/money_value.dart';
import '../../services/kora_service.dart';
import 'ghana_widgets.dart';

class GhanaMoneyScreen extends StatefulWidget {
  final bool withdraw;
  final KoraService? service;
  final Future<String?> Function(BuildContext)? authorize;
  const GhanaMoneyScreen(
      {super.key, this.withdraw = false, this.service, this.authorize});
  @override
  State<GhanaMoneyScreen> createState() => _GhanaMoneyScreenState();
}

class _GhanaMoneyScreenState extends State<GhanaMoneyScreen> {
  late final KoraService _service;
  late Future<Map<String, dynamic>> _capabilities;
  Future<Map<String, dynamic>>? _account;
  Future<List<Map<String, dynamic>>>? _operators;
  final _amount = TextEditingController(), _phone = TextEditingController();
  String _method = 'MOMO';
  String? _operator, _fixedAmount, _error, _recipientName;
  Map<String, dynamic>? _cashout;
  bool _busy = false, _consent = false;
  @override
  void initState() {
    super.initState();
    _service = widget.service ?? KoraService();
    _capabilities = _service.capabilities();
    unawaited(_restore());
    if (widget.withdraw) {
      _operators = _service.operators();
      unawaited(_operators!
          .then<void>((_) {}, onError: (Object _, StackTrace __) {}));
    }
  }

  Future<void> _restore() async {
    try {
      final fields = await _service.pendingMutation(
          widget.withdraw ? 'ghs-cashout-create' : 'kora-momo-create');
      if (!mounted || fields == null) return;
      setState(() {
        _amount.text = '${fields['amount'] ?? ''}';
        if (widget.withdraw) {
          _phone.text = '${fields['mobileNumber'] ?? ''}';
          _operator = fields['operator'] as String?;
        }
        _error =
            'Your last payment response is still being checked. Review these same details to recover it.';
      });
    } catch (_) {
      /* Secure storage failure must not invent a completed payment. */
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() work) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await work();
    } catch (error) {
      if (mounted) setState(() => _error = ghanaError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _validAmount() {
    final amount = MoneyValue.parse(_amount.text);
    if (amount.minorUnits <= BigInt.zero) {
      throw const FormatException('Enter an amount greater than zero.');
    }
    return amount.decimalString;
  }

  Future<void> _review() => _run(() async {
        final amount = _validAmount();
        if (_operator == null) {
          throw const FormatException('Choose the MoMo network.');
        }
        final result = await _service.resolveRecipient(_phone.text, _operator!);
        if (mounted) {
          setState(() {
            _fixedAmount = amount;
            _recipientName = '${result['name']}';
          });
        }
      });
  Future<void> _withdraw() => _run(() async {
        final pin =
            await (widget.authorize?.call(context) ?? requireGhanaPin(context));
        if (pin == null || !mounted) return;
        final result = await _service.cashout(
            amount: _fixedAmount!,
            number: _phone.text,
            operator: _operator!,
            pin: pin,
            name: _recipientName);
        if (mounted) setState(() => _cashout = result);
        walletRefreshSignal.bump();
      });
  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
        backgroundColor: AppColors.background,
        appBar: TpAppHeader(
            label: widget.withdraw ? 'Withdraw cedis' : 'Receive cedis'),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Text(widget.withdraw ? 'Cedis to your MoMo' : 'Add money in cedis',
              style: AppTextStyles.headingL),
          const SizedBox(height: 12),
          Text(
              widget.withdraw
                  ? 'Check your MoMo details before sending.'
                  : 'Payments are checked automatically. No receipt upload is needed.',
              style: AppTextStyles.bodyM),
          const SizedBox(height: 24),
          FutureBuilder<Map<String, dynamic>>(
              future: _capabilities,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return _notice(
                      'Ghana payment options could not load. Go back and try again.');
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final caps = snapshot.data!;
                if (caps['enabled'] != true) {
                  return _notice(
                      'Ghana payments are being prepared. Please check again later.');
                }
                if (widget.withdraw) {
                  if (caps['momoPayouts'] != true) {
                    return _notice('Cedi cash-out is not available yet.');
                  }
                  if (_cashout != null) {
                    final result = _cashout!;
                    return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Icon(
                              result['status'] == 'SUCCESS'
                                  ? Icons.check_circle
                                  : Icons.schedule,
                              size: 48,
                              color: AppColors.primary),
                          const SizedBox(height: 16),
                          Text(
                              result['status'] == 'SUCCESS'
                                  ? 'Sent'
                                  : result['status'] == 'FAILED' ||
                                          result['status'] == 'REVERSED'
                                      ? 'Money returned to your wallet'
                                      : 'Checking your cash-out',
                              style: AppTextStyles.headingM),
                          const SizedBox(height: 16),
                          Text(koraMoney('${result['amount']}', 'GHS'),
                              style: const TextStyle(
                                  fontSize: 36, fontWeight: FontWeight.w800)),
                          Text('${result['accountName']}'),
                          Text('${result['accountNumberMasked']}'),
                          const SizedBox(height: 20),
                          SelectableText('${result['reference']}',
                              style: AppTextStyles.bodyS),
                          const SizedBox(height: 20),
                          OutlinedButton(
                              onPressed: _busy
                                  ? null
                                  : () => _run(() async {
                                        final next =
                                            await _service.refreshCashout(
                                                '${result['reference']}');
                                        if (mounted) {
                                          setState(() => _cashout = next);
                                        }
                                        if (next['status'] !=
                                            result['status']) {
                                          walletRefreshSignal.bump();
                                        }
                                      }),
                              child: const Text('Check payment status'))
                        ]);
                  }
                  if (_fixedAmount != null) {
                    return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(koraMoney(_fixedAmount!, 'GHS'),
                              style: const TextStyle(
                                  fontSize: 38, fontWeight: FontWeight.w800)),
                          const SizedBox(height: 20),
                          Text(_recipientName ?? '',
                              style: AppTextStyles.headingM),
                          Text(ghanaPhone(_phone.text)),
                          const SizedBox(height: 20),
                          FilledButton(
                              onPressed: _busy ? null : _withdraw,
                              child: Text(_busy ? 'Confirming…' : 'Withdraw')),
                          TextButton(
                              onPressed: _busy
                                  ? null
                                  : () => setState(() => _fixedAmount = null),
                              child: const Text('Change details'))
                        ]);
                  }
                  return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _amountField(),
                        const SizedBox(height: 16),
                        TextField(
                            controller: _phone,
                            keyboardType: TextInputType.phone,
                            decoration: const InputDecoration(
                                labelText: 'Receiving MoMo number',
                                hintText: '0241234567')),
                        const SizedBox(height: 16),
                        FutureBuilder<List<Map<String, dynamic>>>(
                            future: _operators,
                            builder: (context, snapshot) {
                              if (snapshot.hasError) {
                                return _notice(
                                    'MoMo networks could not load. Go back and try again.');
                              }
                              if (!snapshot.hasData) {
                                return const LinearProgressIndicator();
                              }
                              return DropdownButtonFormField<String>(
                                  initialValue: _operator,
                                  decoration: const InputDecoration(
                                      labelText: 'MoMo network'),
                                  isExpanded: true,
                                  items: snapshot.data!
                                      .map((item) => DropdownMenuItem(
                                          value: '${item['slug']}',
                                          child: Text('${item['name']}')))
                                      .toList(),
                                  onChanged: _busy
                                      ? null
                                      : (value) =>
                                          setState(() => _operator = value));
                            }),
                        const SizedBox(height: 24),
                        FilledButton(
                            onPressed: _busy ? null : _review,
                            child: Text(_busy
                                ? 'Checking recipient…'
                                : 'Review cash-out'))
                      ]);
                }
                return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Wrap(spacing: 8, children: [
                        if (caps['momoCollections'] == true)
                          ChoiceChip(
                              label: const Text('MoMo'),
                              selected: _method == 'MOMO',
                              onSelected: (_) =>
                                  setState(() => _method = 'MOMO')),
                        if (caps['virtualAccounts'] == true)
                          ChoiceChip(
                              label: const Text('Bank transfer'),
                              selected: _method == 'BANK',
                              onSelected: (_) => setState(() {
                                    _method = 'BANK';
                                    _account = _service.account();
                                  }))
                      ]),
                      const SizedBox(height: 20),
                      if (_method == 'MOMO' &&
                          caps['momoCollections'] == true) ...[
                        if (_fixedAmount == null) ...[
                          _amountField(),
                          const SizedBox(height: 20),
                          FilledButton(
                              onPressed: _busy
                                  ? null
                                  : () => _run(() async {
                                        final amount = _validAmount();
                                        setState(() => _fixedAmount = amount);
                                      }),
                              child: const Text('Continue'))
                        ] else ...[
                          Text(koraMoney(_fixedAmount!, 'GHS'),
                              style: const TextStyle(
                                  fontSize: 36, fontWeight: FontWeight.w800)),
                          const SizedBox(height: 16),
                          KoraMomoPaymentCard(
                              service: _service,
                              amount: _fixedAmount,
                              onConfirmed: () => walletRefreshSignal.bump())
                        ],
                      ],
                      if (_method == 'BANK')
                        FutureBuilder<Map<String, dynamic>>(
                            future: _account,
                            builder: (context, snapshot) {
                              if (snapshot.hasError) {
                                return _notice(ghanaError(snapshot.error!));
                              }
                              if (!snapshot.hasData) {
                                return const LinearProgressIndicator();
                              }
                              final account = snapshot.data!;
                              if (account['status'] == 'ACTIVE' &&
                                  RegExp(r'^\d{7,20}$').hasMatch(
                                      '${account['accountNumber']}')) {
                                return Card(
                                    child: Padding(
                                        padding: const EdgeInsets.all(20),
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text('${account['bankName']}',
                                                  style:
                                                      AppTextStyles.headingM),
                                              const SizedBox(height: 12),
                                              SelectableText(
                                                  '${account['accountNumber']}',
                                                  style: const TextStyle(
                                                      fontSize: 30,
                                                      fontWeight:
                                                          FontWeight.w800)),
                                              Text('${account['accountName']}'),
                                              const SizedBox(height: 16),
                                              OutlinedButton.icon(
                                                  onPressed: () async {
                                                    await Clipboard.setData(
                                                        ClipboardData(
                                                            text:
                                                                '${account['accountNumber']}'));
                                                  },
                                                  icon: const Icon(Icons.copy),
                                                  label: const Text(
                                                      'Copy account number')),
                                              const SizedBox(height: 12),
                                              const Text(
                                                  'Transfer cedis to this account. We will update your wallet after the payment is verified.')
                                            ])));
                              }
                              if (account['status'] == 'PENDING') {
                                return Column(children: [
                                  _notice(
                                      'Your Ghana account is being prepared. Use MoMo while you wait, or check again.'),
                                  TextButton(
                                      onPressed: () => setState(() {
                                            _account = _service.account();
                                          }),
                                      child: const Text('Check account status'))
                                ]);
                              }
                              return Column(children: [
                                CheckboxListTile(
                                    value: _consent,
                                    onChanged: _busy
                                        ? null
                                        : (value) => setState(
                                            () => _consent = value ?? false),
                                    title: const Text(
                                        'I agree to create a Ghana receiving account using my verified profile.')),
                                FilledButton(
                                    onPressed: _busy || !_consent
                                        ? null
                                        : () => _run(() async {
                                              final result = await _service
                                                  .createAccount();
                                              if (mounted) {
                                                setState(() {
                                                  _account =
                                                      Future.value(result);
                                                });
                                              }
                                            }),
                                    child: Text(_busy
                                        ? 'Preparing…'
                                        : 'Create Ghana account'))
                              ]);
                            }),
                    ]);
              }),
          if (_error != null) ...[const SizedBox(height: 20), _notice(_error!)],
        ]));
  }

  Widget _amountField() => TextField(
      controller: _amount,
      enabled: !_busy,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
      decoration: const InputDecoration(
          labelText: 'Amount in cedis', prefixText: '₵ ', hintText: '0.00'),
      style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800));
  Widget _notice(String text) => Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border)),
      child: Text(text));
}
