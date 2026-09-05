import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/money/money_value.dart';
import '../../../core/theme/app_theme.dart';
import '../services/manual_exchange_service.dart';

/// Exact rational arithmetic for a display estimate; the server freezes the quote.
String convertExchangePreview(String amount, String rate,
    {bool inverse = false}) {
  if (!RegExp(r'^\d+(?:\.\d+)?$').hasMatch(rate)) {
    throw const FormatException('Rate unavailable');
  }
  final parts = rate.split('.');
  final numerator = BigInt.parse(parts.join());
  final denominator =
      BigInt.from(10).pow(parts.length == 2 ? parts[1].length : 0);
  if (numerator <= BigInt.zero) throw const FormatException('Rate unavailable');
  final minor = MoneyValue.parse(amount.replaceAll(',', '')).minorUnits;
  if (minor < BigInt.zero) throw const FormatException('Invalid amount');
  final top = minor * (inverse ? denominator : numerator);
  final bottom = inverse ? numerator : denominator;
  // Reverse entry rounds up so the displayed source covers the requested target.
  final result =
      inverse ? (top + bottom - BigInt.one) ~/ bottom : top ~/ bottom;
  return MoneyValue.fromMinorUnits(result).decimalString;
}

class ExchangeConverter extends StatefulWidget {
  final String source;
  final TextEditingController amount;
  final ManualExchangeService service;
  final VoidCallback? onSwap;
  final bool enabled;
  const ExchangeConverter(
      {super.key,
      required this.source,
      required this.amount,
      required this.service,
      required this.onSwap,
      required this.enabled});
  @override
  State<ExchangeConverter> createState() => _ExchangeConverterState();
}

class _ExchangeConverterState extends State<ExchangeConverter> {
  final _receive = TextEditingController();
  String? _rate;
  bool _loading = true;
  bool _stale = false;
  int _generation = 0;
  String get _target => widget.source == 'NGN' ? 'GHS' : 'NGN';
  String _words(int n) {
    const o = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen'
    ];
    const t = [
      '',
      '',
      'twenty',
      'thirty',
      'forty',
      'fifty',
      'sixty',
      'seventy',
      'eighty',
      'ninety'
    ];
    if (n < 20) return o[n];
    if (n < 100) return '${t[n ~/ 10]}${n % 10 == 0 ? '' : ' ${o[n % 10]}'}';
    if (n < 1000) {
      return '${o[n ~/ 100]} hundred${n % 100 == 0 ? '' : ' ${_words(n % 100)}'}';
    }
    for (final e in [
      [1000000000, 'billion'],
      [1000000, 'million'],
      [1000, 'thousand']
    ]) {
      final u = e[0] as int;
      if (n >= u) {
        return '${_words(n ~/ u)} ${e[1]}${n % u == 0 ? '' : ' ${_words(n % u)}'}';
      }
    }
    return '$n';
  }

  String _amountWords(String value, String currency) {
    final n = double.tryParse(value.replaceAll(',', ''));
    return n == null || n <= 0 ? '' : '${_words(n.floor())} $currency';
  }

  String _group(String value) {
    final c = value.replaceAll(',', '');
    if (!RegExp(r'^\d*(?:\.\d*)?$').hasMatch(c)) return value;
    final p = c.split('.');
    final g = NumberFormat('#,##0')
        .format(int.tryParse(p.first.isEmpty ? '0' : p.first) ?? 0);
    return p.length == 1 ? g : '$g.${p[1]}';
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ExchangeConverter oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.source != widget.source) {
      _receive.clear();
      _load();
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _rate = null;
      _receive.clear();
    });
    try {
      final data = await widget.service.previewRate(widget.source);
      final raw = data['effectiveRate'].toString();
      if (!RegExp(r'^\d+(?:\.\d+)?$').hasMatch(raw)) {
        throw const FormatException('Rate unavailable');
      }
      final parts = raw.split('.');
      final rate =
          '${parts.first}.${(parts.length == 2 ? parts[1] : '').padRight(6, '0').substring(0, 6)}';
      convertExchangePreview('1', rate);
      if (!mounted || generation != _generation) return;
      setState(() {
        _rate = rate;
        _stale = data['isStale'] != false;
      });
      _sync(false);
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() => _rate = null);
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  void _sync(bool inverse) {
    final output = inverse ? widget.amount : _receive;
    try {
      output.text = convertExchangePreview(
          inverse ? _receive.text : widget.amount.text, _rate!,
          inverse: inverse);
    } catch (_) {
      output.clear();
    }
  }

  @override
  void dispose() {
    _receive.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        TextFormField(
          controller: widget.amount,
          enabled: widget.enabled,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (value) {
            final grouped = _group(value);
            if (grouped != value) {
              widget.amount.value = TextEditingValue(
                  text: grouped,
                  selection: TextSelection.collapsed(offset: grouped.length));
            }
            if (_rate != null) _sync(false);
          },
          style: AppTextStyles.headingL,
          decoration: InputDecoration(
              labelText: 'You send',
              prefixText: '${widget.source} ',
              hintText: '0.00'),
          validator: (value) {
            try {
              if ((value?.length ?? 0) > 14 ||
                  MoneyValue.parse((value ?? '').replaceAll(',', ''))
                          .minorUnits <=
                      BigInt.zero) {
                return 'Enter a valid ${widget.source} amount.';
              }
            } catch (_) {
              return 'Enter a valid ${widget.source} amount.';
            }
            return null;
          },
        ),
        if (widget.amount.text.isNotEmpty)
          Align(
              alignment: Alignment.centerLeft,
              child: Text(_amountWords(widget.amount.text, widget.source),
                  style: AppTextStyles.caption)),
        Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: IconButton.filledTonal(
              tooltip: 'Swap currencies',
              onPressed: widget.enabled ? widget.onSwap : null,
              icon: const Icon(Icons.swap_vert_rounded),
            )),
        TextFormField(
          controller: _receive,
          enabled: widget.enabled && _rate != null,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => _sync(true),
          style: AppTextStyles.headingL,
          decoration: InputDecoration(
              labelText: 'You receive · estimate',
              prefixText: '$_target ',
              hintText: '0.00'),
        ),
        if (_receive.text.isNotEmpty)
          Align(
              alignment: Alignment.centerLeft,
              child: Text(_amountWords(_receive.text, _target),
                  style: AppTextStyles.caption)),
        const SizedBox(height: 12),
        Text(
            _loading
                ? 'Loading exchange rate…'
                : _rate == null
                    ? 'Rate unavailable. Please refresh.'
                    : '1 ${widget.source} = $_rate $_target',
            style: AppTextStyles.labelM),
        if (_rate != null)
          Text(
              _stale
                  ? 'Last available rate · awaiting an updated rate'
                  : 'Estimated amount. Final rate and fees are confirmed before transfer.',
              style: AppTextStyles.bodyS,
              textAlign: TextAlign.center),
      ]);
}
