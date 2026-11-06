import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/money/money_value.dart';
import '../../../core/money/amount_words.dart';
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
  bool _adminRateMissing = false;
  bool _rateDirectionInvalid = false;
  int _generation = 0;
  Timer? _refreshDebounce;
  DateTime? _lastRateCheck;
  bool _editingReceive = false;
  String get _target => widget.source == 'NGN' ? 'GHS' : 'NGN';
  String _group(String value) {
    final c = value.replaceAll(',', '');
    if (!RegExp(r'^\d*(?:\.\d*)?$').hasMatch(c)) return value;
    final p = c.split('.');
    final digits = (p.first.isEmpty ? '0' : p.first)
        .replaceFirst(RegExp(r'^0+(?=\d)'), '');
    final g = digits.replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (match) => '${match[1]},');
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
      _refreshDebounce?.cancel();
      _editingReceive = false;
      _lastRateCheck = null;
      _rate = null;
      _receive.clear();
      _load();
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _adminRateMissing = false;
      _rateDirectionInvalid = false;
    });
    try {
      final data = await widget.service.previewRate(widget.source);
      if (data['blockedReason'] == 'EXCHANGE_RATE_PAIR_CONFLICT') {
        if (!mounted || generation != _generation) return;
        setState(() {
          _rateDirectionInvalid = true;
          _rate = null;
          _receive.clear();
        });
        return;
      }
      if (data['configured'] == false) {
        if (!mounted || generation != _generation) return;
        setState(() {
          _adminRateMissing = true;
          _rate = null;
          if (!_editingReceive) _receive.clear();
        });
        return;
      }
      final raw = data['effectiveRate'].toString();
      if (!RegExp(r'^\d+(?:\.\d+)?$').hasMatch(raw)) {
        throw const FormatException('Rate unavailable');
      }
      final parts = raw.split('.');
      final rate =
          '${parts.first}.${(parts.length == 2 ? parts[1] : '').padRight(6, '0').substring(0, 6)}';
      final whole = BigInt.parse(parts.first);
      final inverted = widget.source == 'NGN'
          ? whole >= BigInt.one
          : whole < BigInt.one ||
              (whole == BigInt.one &&
                  !RegExp(r'[1-9]')
                      .hasMatch(parts.length == 2 ? parts[1] : ''));
      if (inverted) {
        if (!mounted || generation != _generation) return;
        setState(() {
          _rateDirectionInvalid = true;
          _rate = null;
          _receive.clear();
        });
        return;
      }
      convertExchangePreview('1', rate);
      if (!mounted || generation != _generation) return;
      setState(() {
        _rate = rate;
        _stale = data['isStale'] != false;
      });
      _lastRateCheck = DateTime.now();
      _sync(_editingReceive);
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _rate = null;
        if (!_editingReceive) _receive.clear();
      });
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  void _sync(bool inverse) {
    final output = inverse ? widget.amount : _receive;
    try {
      output.text = _group(convertExchangePreview(
          inverse ? _receive.text : widget.amount.text, _rate!,
          inverse: inverse));
    } catch (_) {
      output.clear();
    }
  }

  // Local conversion is immediate. Refresh the read-only rate in the background
  // after typing pauses, without sending a request for each keystroke.
  void _refreshAfterEditing() {
    _refreshDebounce?.cancel();
    final recentlyChecked = _lastRateCheck != null &&
        DateTime.now().difference(_lastRateCheck!) <
            const Duration(seconds: 30);
    if (_loading || (_rate != null && !_stale && recentlyChecked)) return;
    _refreshDebounce = Timer(const Duration(milliseconds: 450), () {
      if (mounted && widget.enabled) _load();
    });
  }

  @override
  void dispose() {
    _refreshDebounce?.cancel();
    _receive.dispose();
    super.dispose();
  }

  String _currencyName(String code) =>
      code == 'NGN' ? 'Nigerian naira' : 'Ghanaian cedi';

  Widget _amountCard({required bool receiving}) {
    final code = receiving ? _target : widget.source;
    final label = receiving ? 'You get' : 'You send';
    final controller = receiving ? _receive : widget.amount;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: receiving
            ? AppColors.primary.withValues(alpha: 0.04)
            : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
            color: receiving
                ? AppColors.primary.withValues(alpha: 0.3)
                : AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(label, style: AppTextStyles.labelM)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              ExcludeSemantics(
                  child: Text(code == 'NGN' ? '🇳🇬' : '🇬🇭',
                      style: const TextStyle(fontSize: 18))),
              const SizedBox(width: 6),
              Text(code, style: AppTextStyles.labelM),
            ]),
          ),
        ]),
        const SizedBox(height: 4),
        Semantics(
          label: '$label in ${_currencyName(code)} ($code)',
          child: TextFormField(
            controller: controller,
            enabled: widget.enabled && (!receiving || _rate != null),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textInputAction: TextInputAction.done,
            style: AppTextStyles.displayMedium,
            decoration: InputDecoration(
              hintText: receiving && _rate == null ? '—' : '0.00',
              hintStyle: AppTextStyles.displayMedium
                  .copyWith(color: AppColors.textHint),
              filled: false,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 2),
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              disabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              errorBorder: InputBorder.none,
              focusedErrorBorder: InputBorder.none,
            ),
            onChanged: (value) {
              _editingReceive = receiving;
              if (receiving) {
                _sync(true);
                _refreshAfterEditing();
                return;
              }
              final grouped = _group(value);
              if (grouped != value) {
                widget.amount.value = TextEditingValue(
                    text: grouped,
                    selection: TextSelection.collapsed(offset: grouped.length));
              }
              if (_rate != null) _sync(false);
              _refreshAfterEditing();
            },
            validator: receiving
                ? null
                : (value) {
                    if (_rate == null) {
                      return 'A valid exchange rate is required to continue.';
                    }
                    try {
                      if (((value ?? '').replaceAll(',', '').length) > 16 ||
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
        ),
        const SizedBox(height: 4),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (context, value, _) => Text(
            moneyAmountInWords(value.text, code) ?? 'Enter an amount',
            style: AppTextStyles.bodyS,
          ),
        ),
        if (receiving) ...[
          const SizedBox(height: 8),
          Text(
              _loading
                  ? 'Updating estimate…'
                  : _rate == null
                      ? (_rateDirectionInvalid
                          ? 'This exchange rate is being corrected. Please try again shortly.'
                          : _adminRateMissing
                              ? 'This exchange rate is not set yet.'
                              : 'Estimate unavailable. Edit your amount to try again.')
                      : _stale
                          ? 'Estimate · final price confirmed next'
                          : 'Estimate',
              style: AppTextStyles.caption),
        ],
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _amountCard(receiving: false),
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          Expanded(child: Divider(color: AppColors.border)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: IconButton.outlined(
              tooltip: 'Swap currencies',
              onPressed: widget.enabled ? widget.onSwap : null,
              style: IconButton.styleFrom(
                minimumSize: const Size(48, 48),
                backgroundColor: AppColors.surface,
                foregroundColor: AppColors.primary,
                side: BorderSide(color: AppColors.border),
              ),
              icon: const Icon(Icons.swap_vert_rounded),
            ),
          ),
          Expanded(child: Divider(color: AppColors.border)),
        ]),
      ),
      _amountCard(receiving: true),
    ]);
  }
}
