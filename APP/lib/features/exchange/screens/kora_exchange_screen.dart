import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../../../core/state/wallet_refresh_signal.dart';
import '../../../services/kora_service.dart';
import '../../ghana/ghana_widgets.dart';
import 'manual_exchange_screen.dart';

class ExchangeEntryScreen extends StatefulWidget {
  final bool showBackButton, active;
  const ExchangeEntryScreen(
      {super.key, this.showBackButton = true, this.active = true});
  @override
  State<ExchangeEntryScreen> createState() => _ExchangeEntryScreenState();
}

class _ExchangeEntryScreenState extends State<ExchangeEntryScreen> {
  final _service = KoraService();
  late Future<Map<String, dynamic>> _future;
  @override
  void initState() {
    super.initState();
    _future = _entry();
  }

  Future<Map<String, dynamic>> _entry() async {
    final config = await _service.config();
    return {...config, 'hasPending': await _service.pendingAttempt() != null};
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Scaffold(
              appBar: const TpAppHeader(label: 'Exchange'),
              body: Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('Exchange availability could not load.'),
                TextButton(
                    onPressed: () => setState(() {
                          _future = _entry();
                        }),
                    child: const Text('Try again'))
              ])));
        }
        if (!snapshot.hasData) {
          return const Scaffold(
              body: Center(child: CircularProgressIndicator()));
        }
        if (usesProviderExchange(snapshot.data!)) {
          return KoraExchangeScreen(
              service: _service,
              showBackButton: widget.showBackButton,
              active: widget.active);
        }
        return ManualExchangeScreen(
            showBackButton: widget.showBackButton, active: widget.active);
      });
}

class KoraExchangeScreen extends StatefulWidget {
  final KoraService? service;
  final bool showBackButton, active;
  final Future<String?> Function(BuildContext)? authorize;
  const KoraExchangeScreen(
      {super.key,
      this.service,
      this.authorize,
      this.showBackButton = true,
      this.active = true});
  @override
  State<KoraExchangeScreen> createState() => _KoraExchangeScreenState();
}

class _KoraExchangeScreenState extends State<KoraExchangeScreen>
    with WidgetsBindingObserver {
  late final KoraService _service;
  late Future<Map<String, dynamic>> _config;
  late Future<Map<String, String>> _balances;
  late Future<List<KoraOrder>> _orders;
  Future<List<Map<String, dynamic>>>? _recipients;
  final _amount = TextEditingController(), _recipient = TextEditingController();
  final _scroll = ScrollController();
  String _source = 'GHS', _funding = 'WALLET';
  String? _code, _message;
  KoraQuote? _quote;
  KoraOrder? _order;
  int _step = 0;
  bool _busy = false,
      _restoreComplete = false,
      _pending = false,
      _foreground = true;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _service = widget.service ?? KoraService();
    WidgetsBinding.instance.addObserver(this);
    _load();
    unawaited(_restore());
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (widget.active && _foreground && !_busy && _order?.active == true) {
        unawaited(_refreshOrder());
      }
    });
  }

  void _load() {
    _config = _service.config();
    _balances = _service.balances();
    _orders = _service.orders();
    _balances.catchError((Object error) => <String, String>{});
    _orders.catchError((Object error) => <KoraOrder>[]);
  }

  Future<void> _restore() async {
    try {
      final pending = await _service.pendingAttempt();
      if (pending != null) {
        final orders = await _orders;
        KoraOrder? existing;
        for (final row in orders) {
          if (row.quote.id == pending['quoteId']) existing = row;
        }
        if (existing != null) {
          await _service.acknowledgeOrder(existing);
          if (mounted) setState(() => _order = existing);
        } else {
          final recovered =
              await _service.recoverOrderAttempt('${pending['quoteId']}');
          if (recovered != null) {
            if (mounted) setState(() => _order = recovered);
            return;
          }
          final quote = await _service.getQuote('${pending['quoteId']}');
          if (mounted) {
            setState(() {
              _quote = quote;
              _source = quote.sourceCurrency;
              _funding = quote.fundingSource;
              _pending = true;
              _step = 2;
            });
          }
        }
      } else {
        final momo = await _service.pendingMutation('kora-momo-create');
        if (momo?['orderId'] is String) {
          final existing = await _service.order(momo!['orderId'] as String);
          await _service.acknowledgeOrder(existing);
          if (mounted) setState(() => _order = existing);
        }
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _message = ghanaError(error);
          if (error is KoraQuoteExpired) {
            _quote = null;
            _pending = false;
            _step = 0;
          }
        });
      }
    } finally {
      if (mounted) setState(() => _restoreComplete = true);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground && widget.active && _order != null) {
      unawaited(_refreshOrder());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _amount.dispose();
    _recipient.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _top() {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_scroll.hasClients) {
      _scroll.animateTo(0,
          duration: const Duration(milliseconds: 180), curve: Curves.easeOut);
    }
  }

  Future<void> _run(Future<void> Function() operation) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await operation();
    } catch (error) {
      if (mounted) {
        setState(() {
          _message = ghanaError(error);
          if (error is KoraQuoteExpired) {
            _quote = null;
            _pending = false;
            _step = 0;
          }
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _continue() => _run(() async {
        if (_step == 0) {
          if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(_amount.text) ||
              RegExp(r'^0*(\.0*)?$').hasMatch(_amount.text)) {
            throw const FormatException(
                'Enter the amount you want to exchange.');
          }
          setState(() {
            _step = 1;
            _recipients =
                _source == 'GHS' ? _service.banks() : _service.operators();
          });
          _top();
          return;
        }
        if (_code == null) {
          throw FormatException(_source == 'GHS'
              ? 'Choose the receiving bank.'
              : 'Choose the MoMo network.');
        }
        final quote = await _service.quote(
            source: _source,
            funding: _funding,
            amount: _amount.text,
            code: _code!,
            number: _recipient.text);
        if (mounted) {
          setState(() {
            _quote = quote;
            _step = 2;
          });
        }
        _top();
      });
  Future<void> _withdraw() => _run(() async {
        if (!_restoreComplete || _quote == null) return;
        final pin = await (widget.authorize ?? requireGhanaPin)(context);
        if (pin == null || !mounted) return;
        final order = await _service.createOrder(_quote!, pin);
        if (!mounted) return;
        setState(() {
          _order = order;
          _pending = false;
          _orders = _service.orders();
        });
        walletRefreshSignal.bump();
        _top();
      });
  Future<void> _refreshOrder() async {
    final current = _order;
    if (current == null) return;
    try {
      final next = await _service.order(current.id);
      if (!mounted) return;
      if (next.status == 'REFUNDED' && current.status != 'REFUNDED') {
        walletRefreshSignal.bump();
      }
      setState(() => _order = next);
    } catch (error) {
      if (mounted) {
        setState(() {
          _message = ghanaError(error);
          if (error is KoraQuoteExpired) {
            _quote = null;
            _pending = false;
            _step = 0;
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
        backgroundColor: AppColors.background,
        appBar:
            widget.showBackButton ? const TpAppHeader(label: 'Exchange') : null,
        body: RefreshIndicator(
            onRefresh: () async {
              if (_order != null) {
                await _refreshOrder();
              } else {
                setState(_load);
              }
            },
            child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.all(20),
                children: [
                  if (_order != null)
                    ..._orderWidgets(_order!)
                  else ...[
                    Text(_source == 'GHS' ? 'Cedis to naira' : 'Naira to cedis',
                        style: AppTextStyles.headingL),
                    const SizedBox(height: 8),
                    Text('Choose an amount. We’ll show exactly what arrives.',
                        style: AppTextStyles.bodyM),
                    const SizedBox(height: 20),
                    Row(
                        children: List.generate(
                            3,
                            (index) => Expanded(
                                child: Container(
                                    margin: const EdgeInsets.only(right: 6),
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 10),
                                    decoration: BoxDecoration(
                                        color: index == _step
                                            ? AppColors.primary
                                            : AppColors.surface,
                                        borderRadius: BorderRadius.circular(8)),
                                    child: Text(
                                        [
                                          '1 Amount',
                                          '2 Receive',
                                          '3 Review'
                                        ][index],
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                            fontWeight: FontWeight.w700,
                                            color: index == _step
                                                ? Colors.white
                                                : AppColors.textSecondary)))))),
                    const SizedBox(height: 24),
                    FutureBuilder<Map<String, dynamic>>(
                        future: _config,
                        builder: (context, snapshot) {
                          if (snapshot.hasError) {
                            return _notice(
                                'Exchange availability could not load. Pull down to try again.');
                          }
                          if (!snapshot.hasData) {
                            return const Center(
                                child: CircularProgressIndicator());
                          }
                          if (snapshot.data!['enabled'] != true) {
                            return _notice(
                                'Exchange payments are being prepared. Your existing orders remain below.');
                          }
                          final ghana = snapshot.data!['ghana'] is Map
                              ? Map<String, dynamic>.from(
                                  snapshot.data!['ghana'] as Map)
                              : <String, dynamic>{};
                          return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (_step == 0) ...[
                                  Wrap(spacing: 8, runSpacing: 8, children: [
                                    ChoiceChip(
                                        label: const Text('Cedis → Naira'),
                                        selected: _source == 'GHS',
                                        onSelected: _busy
                                            ? null
                                            : (_) => setState(() {
                                                  _source = 'GHS';
                                                  _code = null;
                                                  _recipient.clear();
                                                })),
                                    ChoiceChip(
                                        label: const Text('Naira → Cedis'),
                                        selected: _source == 'NGN',
                                        onSelected: _busy ||
                                                ghana['momoPayouts'] != true
                                            ? null
                                            : (_) => setState(() {
                                                  _source = 'NGN';
                                                  _funding = 'WALLET';
                                                  _code = null;
                                                  _recipient.clear();
                                                }))
                                  ]),
                                  const SizedBox(height: 24),
                                  Text(
                                      'You pay in ${_source == 'GHS' ? 'cedis' : 'naira'}',
                                      style: AppTextStyles.headingM),
                                  const SizedBox(height: 12),
                                  TextField(
                                      key: const Key('exchange-amount'),
                                      controller: _amount,
                                      enabled: !_busy,
                                      keyboardType:
                                          const TextInputType.numberWithOptions(
                                              decimal: true),
                                      inputFormatters: [
                                        FilteringTextInputFormatter.allow(
                                            RegExp(r'[0-9.]'))
                                      ],
                                      style: const TextStyle(
                                          fontSize: 38,
                                          fontWeight: FontWeight.w800),
                                      decoration: InputDecoration(
                                          prefixText:
                                              _source == 'GHS' ? '₵ ' : '₦ ',
                                          hintText: '0.00',
                                          labelText: 'Amount')),
                                  const SizedBox(height: 12),
                                  FutureBuilder<Map<String, String>>(
                                      future: _balances,
                                      builder: (context, snapshot) => Text(
                                          snapshot.hasError
                                              ? 'Balance unavailable'
                                              : snapshot.hasData &&
                                                      snapshot.data![_source] !=
                                                          null
                                                  ? 'Available: ${koraMoney(snapshot.data![_source]!, _source)}'
                                                  : 'Checking available balance…',
                                          style: AppTextStyles.bodyS)),
                                  const SizedBox(height: 24),
                                  Text('Pay with',
                                      style: AppTextStyles.headingM),
                                  const SizedBox(height: 8),
                                  _choice(
                                      'TrustPay balance',
                                      'Use money already in your wallet.',
                                      'WALLET'),
                                  if (_source == 'GHS' &&
                                      ghana['momoCollections'] == true)
                                    _choice(
                                        'MoMo',
                                        'Approve a payment on your phone.',
                                        'EXTERNAL'),
                                  const SizedBox(height: 20),
                                  FilledButton(
                                      onPressed: _busy ? null : _continue,
                                      child: const Text('Continue')),
                                ],
                                if (_step == 1) ...[
                                  Text(
                                      _source == 'GHS'
                                          ? 'Where should the naira go?'
                                          : 'Where should the cedis go?',
                                      style: AppTextStyles.headingM),
                                  const SizedBox(height: 16),
                                  FutureBuilder<List<Map<String, dynamic>>>(
                                      future: _recipients,
                                      builder: (context, snapshot) {
                                        if (snapshot.hasError) {
                                          return _notice(
                                              'Recipients could not load. Go back and try again.');
                                        }
                                        if (!snapshot.hasData) {
                                          return const LinearProgressIndicator();
                                        }
                                        return DropdownButtonFormField<String>(
                                            key: const Key('exchange-bank'),
                                            initialValue: _code,
                                            isExpanded: true,
                                            decoration: InputDecoration(
                                                labelText: _source == 'GHS'
                                                    ? 'Receiving bank'
                                                    : 'MoMo network'),
                                            items: snapshot.data!
                                                .map((bank) => DropdownMenuItem(
                                                    value:
                                                        '${bank[_source == 'GHS' ? 'code' : 'slug']}',
                                                    child: Text(
                                                        '${bank['name']}',
                                                        overflow: TextOverflow
                                                            .ellipsis)))
                                                .toList(),
                                            onChanged: _busy
                                                ? null
                                                : (value) => setState(
                                                    () => _code = value));
                                      }),
                                  const SizedBox(height: 16),
                                  TextField(
                                      key: const Key('exchange-recipient'),
                                      controller: _recipient,
                                      enabled: !_busy,
                                      keyboardType: TextInputType.phone,
                                      decoration: InputDecoration(
                                          labelText: _source == 'GHS'
                                              ? 'Receiving account number'
                                              : 'Receiving MoMo number',
                                          hintText: _source == 'GHS'
                                              ? '10-digit account number'
                                              : '0241234567')),
                                  const SizedBox(height: 24),
                                  FilledButton(
                                      onPressed: _busy ? null : _continue,
                                      child: Text(_busy
                                          ? 'Checking recipient…'
                                          : 'Review exchange')),
                                  TextButton(
                                      onPressed: _busy
                                          ? null
                                          : () => setState(() => _step = 0),
                                      child: const Text('Back')),
                                ],
                                if (_step == 2 && _quote != null) ...[
                                  ..._quoteWidgets(_quote!),
                                  const SizedBox(height: 20),
                                  if (_pending)
                                    _notice(
                                        'Your previous request is awaiting confirmation. Retry these same details; we will not create another debit.'),
                                  FilledButton(
                                      onPressed: _busy || !_restoreComplete
                                          ? null
                                          : _withdraw,
                                      child: Text(_busy
                                          ? 'Confirming…'
                                          : _pending
                                              ? 'Retry exchange'
                                              : 'Withdraw')),
                                  if (!_pending)
                                    TextButton(
                                        onPressed: _busy
                                            ? null
                                            : () => setState(() {
                                                  _step = 1;
                                                  _quote = null;
                                                }),
                                        child: const Text('Change recipient')),
                                ],
                              ]);
                        }),
                  ],
                  if (_message != null) ...[
                    const SizedBox(height: 16),
                    _notice(_message!)
                  ],
                  const SizedBox(height: 28),
                  Text('Your exchanges', style: AppTextStyles.headingM),
                  TextButton(
                      onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(
                              builder: (_) => const ManualExchangeScreen())),
                      child: const Text('Earlier manual exchanges')),
                  const SizedBox(height: 12),
                  FutureBuilder<List<KoraOrder>>(
                      future: _orders,
                      builder: (context, snapshot) {
                        if (snapshot.hasError) {
                          return TextButton(
                              onPressed: () => setState(() {
                                    _orders = _service.orders();
                                  }),
                              child: const Text(
                                  'History could not load · Try again'));
                        }
                        if (!snapshot.hasData) {
                          return const Text('Loading history…');
                        }
                        if (snapshot.data!.isEmpty) {
                          return const Text('Your exchanges will appear here.');
                        }
                        return Column(
                            children: snapshot.data!
                                .map((order) => ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    title: Text(
                                        koraMoney(order.quote.targetAmount,
                                            order.quote.targetCurrency),
                                        style: const TextStyle(
                                            fontWeight: FontWeight.bold)),
                                    subtitle: Text(order.label),
                                    trailing: const Icon(Icons.chevron_right),
                                    onTap: () =>
                                        setState(() => _order = order)))
                                .toList());
                      }),
                ])));
  }

  Widget _choice(String title, String subtitle, String value) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
          onTap: _busy ? null : () => setState(() => _funding = value),
          borderRadius: BorderRadius.circular(12),
          child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                  border: Border.all(
                      color: _funding == value
                          ? AppColors.primary
                          : AppColors.border),
                  borderRadius: BorderRadius.circular(12)),
              child: Row(children: [
                Icon(
                    _funding == value
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    color: AppColors.primary),
                const SizedBox(width: 12),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(title,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(subtitle, style: AppTextStyles.bodyS)
                    ]))
              ]))));
  Widget _notice(String text) => Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: AppColors.surface,
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(12)),
      child: Text(text));
  List<Widget> _quoteWidgets(KoraQuote q) => [
        const Text('You receive',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Text(koraMoney(q.targetAmount, q.targetCurrency),
            style: const TextStyle(fontSize: 38, fontWeight: FontWeight.w800)),
        const SizedBox(height: 20),
        Text(q.destinationName, style: AppTextStyles.headingM),
        Text(q.destinationMasked, style: AppTextStyles.bodyM),
        const SizedBox(height: 24),
        _line('Amount', koraMoney(q.amount, q.sourceCurrency)),
        _line('Fee', koraMoney(q.fee, q.sourceCurrency)),
        const Divider(),
        _line('Total to pay', koraMoney(q.total, q.sourceCurrency)),
        const SizedBox(height: 12),
        Text('1 ${q.sourceCurrency} = ${q.rate} ${q.targetCurrency}',
            style: AppTextStyles.bodyS),
        const SizedBox(height: 8),
        const Text(
            'Check the amount and recipient. Your transaction PIN approves this request.'),
      ];
  Widget _line(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Expanded(child: Text(label)),
        Text(value,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17))
      ]));
  List<Widget> _orderWidgets(KoraOrder order) => [
        Icon(
            order.status == 'SENT'
                ? Icons.check_circle_rounded
                : Icons.schedule_rounded,
            size: 48,
            color: AppColors.primary),
        const SizedBox(height: 16),
        Text(order.label, style: AppTextStyles.headingL),
        const SizedBox(height: 12),
        Text(koraMoney(order.quote.targetAmount, order.quote.targetCurrency),
            style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        Text(order.quote.destinationName, style: AppTextStyles.headingM),
        Text(order.quote.destinationMasked),
        const SizedBox(height: 20),
        if (order.status == 'READY') ...[
          _notice('Waiting for admin'),
          const SizedBox(height: 8),
          const Text(
              'Your money is confirmed. Our team can now send it to your recipient.')
        ],
        if (order.status == 'PROCESSING')
          const Text(
              'Your payout is being processed. We will update this page when the provider confirms it.'),
        if (order.status == 'AWAITING_PAYMENT')
          KoraMomoPaymentCard(
              key: ValueKey(order.id),
              service: _service,
              orderId: order.id,
              initialPayment: order.payment,
              onConfirmed: () => unawaited(_refreshOrder())),
        const SizedBox(height: 20),
        SelectableText(order.reference, style: AppTextStyles.bodyS),
        const SizedBox(height: 12),
        OutlinedButton(
            onPressed: () => _run(() async {
                  final next = await _service.refreshOrder(order.id);
                  if (mounted) setState(() => _order = next);
                }),
            child: const Text('Check payment status')),
        if (!order.active)
          TextButton(
              onPressed: () => setState(() {
                    _order = null;
                    _quote = null;
                    _step = 0;
                    _amount.clear();
                  }),
              child: const Text('Make another exchange')),
      ];
}
