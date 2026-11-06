import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../../services/auth_service.dart';
import '../../../services/vtu_service.dart';
import '../../../core/theme/app_theme.dart';
import '../widgets/vtu_purchase_widgets.dart';

const extendedVtuProviders = {
  'smile-airtime',
  'smile',
  'glo-sme',
  '9mobile-sme',
  'showmax',
  'foreign-airtime'
};

/// Submission, PIN approval and recovery remain in MoneyActionScreen.
class ExtendedVtuForm extends StatefulWidget {
  const ExtendedVtuForm(
      {super.key,
      required this.client,
      required this.provider,
      required this.type,
      required this.onReady,
      required this.disabled,
      this.onCountryMenuChanged});
  final Dio client;
  final String provider, type;
  final bool disabled;
  final ValueChanged<VtuCountryMenu>? onCountryMenuChanged;
  final Future<void> Function(
      Map<String, dynamic> payload, Map<String, String> review) onReady;
  @override
  State<ExtendedVtuForm> createState() => _ExtendedVtuFormState();
}

class _ExtendedVtuFormState extends State<ExtendedVtuForm> {
  final _email = TextEditingController(),
      _phone = TextEditingController(),
      _contact = TextEditingController(),
      _face = TextEditingController();
  List<Map<String, dynamic>> _countries = [],
      _operators = [],
      _plans = [],
      _accounts = [];
  String? _country, _operator, _plan, _account, _error;
  Map<String, dynamic>? _quote;
  bool _busy = false;
  bool get _foreign => widget.provider == 'foreign-airtime';
  bool get _smile =>
      widget.provider == 'smile' || widget.provider == 'smile-airtime';
  Map<String, dynamic>? get _selected {
    for (final item in _plans) {
      if (item['id'] == _plan) return item;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    for (final field in [_email, _phone, _contact, _face]) {
      field.dispose();
    }
    super.dispose();
  }

  List<Map<String, dynamic>> _rows(dynamic value) => (value as List)
      .map((item) => Map<String, dynamic>.from(item as Map))
      .toList();
  Future<dynamic> _get(String path, [Map<String, dynamic>? params]) async =>
      (await widget.client.get('/api/vtu/$path', queryParameters: params)).data;
  Future<void> _run(Future<void> Function() task) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    _publishCountryMenu();
    try {
      await task();
    } catch (error) {
      if (mounted) {
        setState(() => _error = authErrorMessage(
            error, 'Could not load service details. Try again.'));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        _publishCountryMenu();
      }
    }
  }

  Future<void> _loadInitial() => _run(() async {
        if (_foreign) {
          final rows = _rows(await _get('international/countries'));
          if (mounted) setState(() => _countries = rows);
        } else {
          await _loadPlans();
        }
      });
  VtuCountryMenu get _countryMenu => VtuCountryMenu(
          countries: {
            for (final row in _countries) '${row['code']}': '${row['name']}'
          },
          value: _country,
          enabled: !_busy && !widget.disabled,
          onChanged: _changeCountry);

  void _publishCountryMenu() {
    if (_foreign && mounted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onCountryMenuChanged?.call(_countryMenu);
      });
    }
  }

  void _changeCountry(String value) {
    if (_busy || widget.disabled || !mounted) return;
    setState(() {
      _country = value;
      _operator = null;
      _plan = null;
      _operators = [];
      _plans = [];
      _quote = null;
    });
    _run(() async {
      final rows =
          _rows(await _get('international/operators', {'countryCode': value}));
      if (mounted) setState(() => _operators = rows);
    });
  }

  Future<void> _loadPlans() async {
    final rows = _rows(await _get('packages', {
      'provider': widget.provider,
      if (_foreign) ...{'countryCode': _country, 'operatorId': _operator}
    }));
    if (mounted) {
      setState(() {
        _plans = rows;
        _plan = null;
        _quote = null;
      });
    }
  }

  String _normalize(String text) {
    final value = text.trim().replaceAll(RegExp(r'[\s()-]'), '');
    if (RegExp(r'^0[789]\d{9}$').hasMatch(value)) {
      return '+234${value.substring(1)}';
    }
    if (RegExp(r'^234[789]\d{9}$').hasMatch(value)) return '+$value';
    return value;
  }

  Future<void> _verify() => _run(() async {
        if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
            .hasMatch(_email.text.trim())) {
          setState(() => _error = 'Enter a valid Smile email.');
          return;
        }
        final response = await widget.client.post('/api/vtu/validate/smile',
            data: {'smileEmail': _email.text.trim()},
            options: Options(headers: {'Idempotency-Key': const Uuid().v4()}));
        if (mounted) {
          setState(() {
            _accounts = _rows((response.data as Map)['accounts']);
            _account = null;
          });
        }
      });
  Future<void> _review() => _run(() async {
        if (_selected == null) {
          setState(() => _error = 'Select a plan.');
          return;
        }
        if (!RegExp(r'^\+234[789]\d{9}$').hasMatch(_normalize(_contact.text))) {
          setState(() => _error = 'Enter a valid Nigerian contact number.');
          return;
        }
        if (_smile
            ? _account == null
            : !(_foreign
                    ? RegExp(r'^\+[1-9]\d{6,14}$')
                    : RegExp(r'^\+234[789]\d{9}$'))
                .hasMatch(_normalize(_phone.text))) {
          setState(() => _error = _smile
              ? 'Verify your Smile email and select an account.'
              : 'Enter a valid recipient phone number with country code.');
          return;
        }
        if (_selected?['fixedPrice'] == false &&
            !RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(_face.text)) {
          setState(() => _error = 'Enter the destination airtime amount.');
          return;
        }
        final result =
            Map<String, dynamic>.from(await _get('quote', _routing()));
        if (mounted) setState(() => _quote = result);
      });
  Map<String, dynamic> _routing() => {
        'provider': widget.provider,
        'type': widget.type,
        'packageId': _plan,
        if (_foreign) ...{'countryCode': _country, 'operatorId': _operator},
        if (_selected?['fixedPrice'] == false) 'faceValue': _face.text
      };
  void _invalidate() {
    setState(() {
      _quote = null;
      _error = null;
    });
  }

  Widget _select(
          String label,
          String? value,
          List<DropdownMenuItem<String>> items,
          void Function(String?) onChanged) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: DropdownButtonFormField<String>(
              key: ValueKey('$label-$value-${items.length}'),
              initialValue: value,
              isExpanded: true,
              decoration: InputDecoration(labelText: label),
              items: items,
              onChanged: _busy || widget.disabled ? null : onChanged));
  Widget _input(String label, TextEditingController controller,
          {TextInputType? keyboard, VoidCallback? changed}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: TextField(
              controller: controller,
              enabled: !_busy && !widget.disabled,
              keyboardType: keyboard,
              decoration: InputDecoration(labelText: label),
              onChanged: (_) {
                changed?.call();
                _invalidate();
              }));
  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_foreign && widget.onCountryMenuChanged == null)
          Align(
              alignment: Alignment.centerRight,
              child: VtuCountrySelector(menu: _countryMenu)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border)),
          child: Row(children: [
            VtuProviderLogo(id: widget.provider, size: 48),
            const SizedBox(width: 16),
            Expanded(
                child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_foreign ? 'Send airtime abroad' : 'Set up your purchase',
                    style: AppTextStyles.labelL),
                const SizedBox(height: 4),
                Text('Review the live price before payment approval.',
                    style: AppTextStyles.bodyS),
              ],
            )),
          ]),
        ),
        const VtuSectionLabel('Recipient details'),
        if (_foreign) ...[
          _select(
              'Operator',
              _operator,
              _operators
                  .map((item) => DropdownMenuItem(
                      value: '${item['id']}', child: Text('${item['name']}')))
                  .toList(), (value) {
            setState(() {
              _operator = value;
              _plan = null;
              _quote = null;
            });
            _run(_loadPlans);
          }),
        ],
        if (_smile) ...[
          _input('Smile account email', _email,
              keyboard: TextInputType.emailAddress, changed: () {
            _accounts = [];
            _account = null;
          }),
          OutlinedButton(
              onPressed: _busy || widget.disabled ? null : _verify,
              child: const Text('Verify Smile email')),
          _select(
              'Smile account',
              _account,
              _accounts
                  .map((item) => DropdownMenuItem(
                      value: '${item['id']}',
                      child: Text(
                          '${item['name']} · …${'${item['id']}'.substring('${item['id']}'.length - 4)}')))
                  .toList(), (value) {
            setState(() => _account = value);
            _invalidate();
          }),
        ] else
          _input(
              widget.provider == 'showmax'
                  ? 'ShowMax account phone number'
                  : 'Recipient phone number',
              _phone,
              keyboard: TextInputType.phone),
        if (_plans.isNotEmpty) ...[
          const VtuSectionLabel('Choose a plan'),
          VtuPlanPicker(
            key: ValueKey('${widget.provider}-$_country-$_operator'),
            value: _plan,
            packages: _plans.map(VtuPackageOption.fromJson).toList(),
            variablePriceIds: {
              for (final p in _plans)
                if (p['fixedPrice'] == false) '${p['id']}'
            },
            enabled: !_busy && !widget.disabled,
            onChanged: (value) {
              setState(() {
                _plan = value;
                _face.clear();
              });
              _invalidate();
            },
          ),
          const SizedBox(height: 16),
        ],
        if (_selected?['fixedPrice'] == false)
          _input('Airtime amount in destination currency', _face,
              keyboard: const TextInputType.numberWithOptions(decimal: true)),
        _input('Nigerian contact phone number', _contact,
            keyboard: TextInputType.phone),
        if (!_busy && _plans.isEmpty && (!_foreign || _operator != null))
          const Text('No priced plans are currently available.'),
        if (_busy) const LinearProgressIndicator(),
        if (_error != null) ...[
          Text(_error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error)),
          TextButton(
              onPressed: _busy
                  ? null
                  : () {
                      if (_foreign && _operator != null) {
                        _run(_loadPlans);
                      } else {
                        _loadInitial();
                      }
                    },
              child: const Text('Reload service options'))
        ],
        if (_quote != null)
          Container(
              margin: const EdgeInsets.symmetric(vertical: 16),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(
                  'Purchase: NGN ${_quote!['amount']}\nFee: NGN ${_quote!['fee']}\nTotal from NGN wallet: ${_quote!['totalDebit']}',
                  style: AppTextStyles.bodyM.copyWith(height: 1.9))),
        FilledButton(
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(56),
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
            ),
            onPressed: _busy || widget.disabled
                ? null
                : _quote == null
                    ? _review
                    : () => _run(() async {
                          final payload = {
                            ..._routing(),
                            'amount': '${_quote!['amount']}',
                            'expectedTotal': '${_quote!['totalDebit']}',
                            'contactPhone': _normalize(_contact.text),
                            if (_smile) ...{
                              'smileEmail': _email.text.trim(),
                              'smileAccountId': _account
                            } else
                              'recipientNumber': _normalize(_phone.text)
                          };
                          await widget.onReady(payload, {
                            'Plan': '${_selected!['name']}',
                            'Recipient': _smile
                                ? 'Smile account …${_account!.substring(_account!.length - 4)}'
                                : _normalize(_phone.text),
                            'Fee': 'NGN ${_quote!['fee']}',
                            'Total': 'NGN ${_quote!['totalDebit']}',
                            if (_foreign) 'Destination country': _country!
                          });
                        }),
            child: Text(_quote == null
                ? 'Review purchase'
                : 'Continue to payment approval')),
      ]);
}
