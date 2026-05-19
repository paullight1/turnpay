import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/auth_service.dart';
import '../../../services/api_client.dart';
import '../../../services/transaction_security_service.dart';
import '../../security/screens/transaction_security_screen.dart';

enum MoneyActionKind {
  fund,
  send,
  withdraw,
  exchange,
  airtime,
  data,
  electricity,
}

class MoneyActionScreen extends StatefulWidget {
  final MoneyActionKind kind;
  final bool showBackButton;

  const MoneyActionScreen({
    super.key,
    required this.kind,
    this.showBackButton = true,
  });

  @override
  State<MoneyActionScreen> createState() => _MoneyActionScreenState();
}

class _MoneyActionScreenState extends State<MoneyActionScreen> {
  final _apiClient = ApiClient();
  final _transactionSecurityService = TransactionSecurityService();
  final _amountController = TextEditingController();
  final _recipientController = TextEditingController();
  final _accountNumberController = TextEditingController();
  final _accountNameController = TextEditingController();
  final _bankCodeController = TextEditingController();
  final _noteController = TextEditingController();

  String _currency = 'NGN';
  String _exchangeFrom = 'GHS';
  String _exchangeTo = 'NGN';
  String _provider = 'paystack';
  String _vtuProvider = 'mtn';
  String? _message;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _amountController.dispose();
    _recipientController.dispose();
    _accountNumberController.dispose();
    _accountNameController.dispose();
    _bankCodeController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (widget.kind == MoneyActionKind.exchange) {
      await _submitExchange();
      return;
    }

    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _message = 'Enter a valid amount.');
      return;
    }

    if (widget.kind == MoneyActionKind.withdraw) {
      final approved = await _requireTransactionApproval(
        title: 'Enter your transaction PIN',
        subtitle: 'Approve this withdrawal before it is submitted.',
      );
      if (!approved) {
        return;
      }
    }

    setState(() {
      _isSubmitting = true;
      _message = null;
    });

    try {
      final response = await _request(amount);
      setState(() {
        _message = _successMessage(response.data);
      });
    } catch (error) {
      setState(() {
        _message = authErrorMessage(error, 'Request failed');
      });
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _submitExchange() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _message = 'Enter a valid amount to exchange.');
      return;
    }

    if (_exchangeFrom == _exchangeTo) {
      setState(() => _message = 'Choose two different currencies.');
      return;
    }

    final approved = await _requireTransactionApproval(
      title: 'Enter your transaction PIN',
      subtitle: 'Approve this exchange request before the quote is created.',
    );
    if (!approved) {
      return;
    }

    setState(() {
      _isSubmitting = true;
      _message = null;
    });

    try {
      final response = await _apiClient.client.post(
        '/api/exchange/quote',
        data: {
          'from': _exchangeFrom,
          'to': _exchangeTo,
          'amount': amount,
        },
      );

      if (!mounted) return;

      final data = Map<String, dynamic>.from(response.data as Map);
      final receipt = ExchangeReceipt.fromApi(
        data,
        destinationLabel: _defaultDestinationLabel(_exchangeTo),
        destinationAccount: 'To be added',
        destinationInstitution: _defaultDestinationInstitution(_exchangeTo),
        note: '',
      );
      context.push(AppRoutes.exchangeSettlement, extra: receipt);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _message = authErrorMessage(error, 'Could not create exchange quote');
      });
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<dynamic> _request(double amount) {
    switch (widget.kind) {
      case MoneyActionKind.fund:
        return _apiClient.client.post(
          '/api/payments/fund',
          data: {
            'amount': amount,
            'currency': _currency,
            'provider': _provider,
            'channel': 'card',
          },
        );
      case MoneyActionKind.send:
        return _apiClient.client.post(
          '/api/transfers/internal',
          data: {
            'recipientEmail': _recipientController.text.trim(),
            'amount': amount,
            'currency': _currency,
            if (_noteController.text.trim().isNotEmpty)
              'note': _noteController.text.trim(),
          },
        );
      case MoneyActionKind.withdraw:
        return _apiClient.client.post(
          '/api/payments/withdraw',
          data: {
            'amount': amount,
            'currency': _currency,
            'provider': _provider,
            'bankCode': _bankCodeController.text.trim(),
            'accountNumber': _accountNumberController.text.trim(),
            'accountName': _accountNameController.text.trim(),
          },
        );
      case MoneyActionKind.exchange:
        return _apiClient.client.post(
          '/api/exchange/quote',
          data: {
            'from': _currency,
            'to': _currency == 'NGN' ? 'GHS' : 'NGN',
            'amount': amount,
          },
        );
      case MoneyActionKind.airtime:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          data: {
            'type': 'airtime',
            'provider': _vtuProvider,
            'recipientNumber': _recipientController.text.trim(),
            'amount': amount,
          },
        );
      case MoneyActionKind.data:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          data: {
            'type': 'data',
            'provider': _vtuProvider,
            'recipientNumber': _recipientController.text.trim(),
            'amount': amount,
          },
        );
      case MoneyActionKind.electricity:
        return _apiClient.client.post(
          '/api/vtu/purchase',
          data: {
            'type': 'electricity',
            'provider': 'ikedc',
            'recipientNumber': _recipientController.text.trim(),
            'meterNumber': _recipientController.text.trim(),
            'amount': amount,
          },
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.kind == MoneyActionKind.exchange) {
      return _buildExchangeScaffold(context);
    }

    final config = _configFor(widget.kind);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xxl,
              ),
              sliver: SliverList.list(
                children: [
                  Row(
                    children: [
                      if (widget.showBackButton)
                        _IconButton(
                          icon: Icons.arrow_back_ios_new_rounded,
                          onTap: () => context.pop(),
                        ),
                      const Spacer(),
                      _StatusPill(label: config.status),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceVariant,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child:
                        Icon(config.icon, color: AppColors.primary, size: 26),
                  ),
                  SizedBox(height: AppSpacing.lg),
                  Text(config.title, style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(config.subtitle, style: AppTextStyles.bodyL),
                  SizedBox(height: AppSpacing.xl),
                  _CurrencySelector(
                    value: _currency,
                    onChanged: (value) => setState(() => _currency = value),
                  ),
                  SizedBox(height: AppSpacing.md),
                  _InputField(
                    controller: _amountController,
                    label: 'Amount',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                  ),
                  ..._extraFields(),
                  SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    onPressed: _isSubmitting ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: AppColors.textPrimary,
                      minimumSize: const Size.fromHeight(54),
                    ),
                    child: _isSubmitting
                        ? SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.textPrimary,
                            ),
                          )
                        : Text(config.buttonLabel),
                  ),
                  if (_message != null) ...[
                    SizedBox(height: AppSpacing.md),
                    _MessagePanel(message: _message!),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildExchangeScaffold(BuildContext context) {
    final amount = double.tryParse(_amountController.text.trim()) ?? 0;
    final estimatedReceive = _estimateReceiveAmount(amount);
    final config = _configFor(MoneyActionKind.exchange);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xxl,
              ),
              sliver: SliverList.list(
                children: [
                  Row(
                    children: [
                      if (widget.showBackButton)
                        _IconButton(
                          icon: Icons.arrow_back_ios_new_rounded,
                          onTap: () => context.pop(),
                        ),
                      const Spacer(),
                      const _StatusPill(label: 'Quote request'),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Text(config.title, style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Convert between NGN and GHS. Submit the quote, then add the destination for review.',
                    style: AppTextStyles.bodyL,
                  ),
                  SizedBox(height: AppSpacing.xl),
                  _ExchangeSwapPanel(
                    fromCurrency: _exchangeFrom,
                    toCurrency: _exchangeTo,
                    amountController: _amountController,
                    estimatedReceive: estimatedReceive,
                    onFromChanged: (value) {
                      setState(() {
                        _exchangeFrom = value;
                        if (_exchangeTo == value) {
                          _exchangeTo = value == 'NGN' ? 'GHS' : 'NGN';
                        }
                      });
                    },
                    onToChanged: (value) {
                      setState(() {
                        _exchangeTo = value;
                        if (_exchangeFrom == value) {
                          _exchangeFrom = value == 'NGN' ? 'GHS' : 'NGN';
                        }
                      });
                    },
                    onSwap: () {
                      setState(() {
                        final nextFrom = _exchangeTo;
                        _exchangeTo = _exchangeFrom;
                        _exchangeFrom = nextFrom;
                      });
                    },
                  ),
                  SizedBox(height: AppSpacing.lg),
                  _ExchangeRatePanel(
                    fromCurrency: _exchangeFrom,
                    toCurrency: _exchangeTo,
                    amount: amount,
                    estimatedReceive: estimatedReceive,
                  ),
                  SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    onPressed: _isSubmitting ? null : _submitExchange,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(56),
                    ),
                    child: _isSubmitting
                        ? SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Submit for review'),
                  ),
                  SizedBox(height: AppSpacing.md),
                  const _InfoPanel(
                    text:
                        'After the quote is created, you will add where the converted payout should be sent.',
                  ),
                  if (_message != null) ...[
                    SizedBox(height: AppSpacing.md),
                    _MessagePanel(message: _message!),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  double _estimateReceiveAmount(double amount) {
    if (amount <= 0) return 0;
    final rate = _exchangeFrom == 'GHS' ? 17.85 : 0.056;
    return amount * rate;
  }

  String _defaultDestinationLabel(String currency) {
    return currency == 'NGN' ? 'Naira payout account' : 'Cedi payout wallet';
  }

  String _defaultDestinationInstitution(String currency) {
    return currency == 'NGN' ? 'Bank account' : 'Mobile money wallet';
  }

  Future<bool> _requireTransactionApproval({
    required String title,
    required String subtitle,
  }) async {
    final config = await _transactionSecurityService.getConfig();

    if (!mounted) {
      return false;
    }

    if (!config.hasPin) {
      final shouldSetup = await showDialog<bool>(
            context: context,
            builder: (dialogContext) {
              return AlertDialog(
                backgroundColor: AppColors.surface,
                title:
                    Text('Set transaction PIN', style: AppTextStyles.headingM),
                content: Text(
                  'Withdraw and exchange require a transaction PIN. Set it up in Security & Limits first.',
                  style: AppTextStyles.bodyM,
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: Text(
                      'Cancel',
                      style: AppTextStyles.labelM.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(dialogContext).pop(true),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                    ),
                    child: const Text('Set up'),
                  ),
                ],
              );
            },
          ) ??
          false;

      if (shouldSetup && mounted) {
        await context.push(AppRoutes.transactionSecurity);
      }
      return false;
    }

    final approved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TransactionPinScreen.verify(
          pinLength: config.pinLength,
          allowBiometric: config.shouldOfferBiometrics,
          title: title,
          subtitle: subtitle,
        ),
        fullscreenDialog: true,
      ),
    );

    return approved == true;
  }

  List<Widget> _extraFields() {
    switch (widget.kind) {
      case MoneyActionKind.fund:
        return [
          SizedBox(height: AppSpacing.md),
          _ProviderSelector(
            value: _provider,
            onChanged: (value) => setState(() => _provider = value),
          ),
        ];
      case MoneyActionKind.send:
        return [
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _recipientController,
            label: 'Recipient email',
            keyboardType: TextInputType.emailAddress,
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(controller: _noteController, label: 'Note optional'),
        ];
      case MoneyActionKind.withdraw:
        return [
          SizedBox(height: AppSpacing.md),
          _ProviderSelector(
            value: _provider,
            onChanged: (value) => setState(() => _provider = value),
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(controller: _bankCodeController, label: 'Bank code'),
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _accountNumberController,
            label: 'Account number',
            keyboardType: TextInputType.number,
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(
              controller: _accountNameController, label: 'Account name'),
        ];
      case MoneyActionKind.exchange:
        return const [
          SizedBox(height: AppSpacing.md),
          _InfoPanel(
            text:
                'This creates a live exchange quote. Quote execution will be wired to a confirmation step before wallet debit.',
          ),
        ];
      case MoneyActionKind.airtime:
        return [
          SizedBox(height: AppSpacing.md),
          _VtuProviderSelector(
            value: _vtuProvider,
            onChanged: (value) => setState(() => _vtuProvider = value),
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _recipientController,
            label: 'Phone number',
            keyboardType: TextInputType.phone,
          ),
        ];
      case MoneyActionKind.data:
        return [
          SizedBox(height: AppSpacing.md),
          _VtuProviderSelector(
            value: _vtuProvider,
            onChanged: (value) => setState(() => _vtuProvider = value),
          ),
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _recipientController,
            label: 'Phone number',
            keyboardType: TextInputType.phone,
          ),
          SizedBox(height: AppSpacing.md),
          const _InfoPanel(
            text:
                'Data plans require provider package IDs. This submits a basic provider request; we still need package selection for production UX.',
          ),
        ];
      case MoneyActionKind.electricity:
        return [
          SizedBox(height: AppSpacing.md),
          _InputField(
            controller: _recipientController,
            label: 'Meter number',
            keyboardType: TextInputType.number,
          ),
        ];
    }
  }
}

class _CurrencySelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _CurrencySelector({
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return _ChoiceRow(
      label: 'Currency',
      value: value,
      values: const ['NGN', 'GHS'],
      onChanged: onChanged,
    );
  }
}

class _ProviderSelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _ProviderSelector({
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return _ChoiceRow(
      label: 'Provider',
      value: value,
      values: const ['paystack', 'flutterwave'],
      onChanged: onChanged,
    );
  }
}

class _VtuProviderSelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _VtuProviderSelector({
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return _ChoiceRow(
      label: 'Network',
      value: value,
      values: const ['mtn', 'airtel', 'glo'],
      onChanged: onChanged,
    );
  }
}

class _ChoiceRow extends StatelessWidget {
  final String label;
  final String value;
  final List<String> values;
  final ValueChanged<String> onChanged;

  const _ChoiceRow({
    required this.label,
    required this.value,
    required this.values,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      items: values
          .map((item) => DropdownMenuItem(value: item, child: Text(item)))
          .toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
      dropdownColor: AppColors.surface,
      decoration: _inputDecoration(label),
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
    );
  }
}

class _InputField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final TextInputType? keyboardType;

  const _InputField({
    required this.controller,
    required this.label,
    this.keyboardType,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      style: AppTextStyles.bodyM.copyWith(color: AppColors.textPrimary),
      decoration: _inputDecoration(label),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  final String text;

  const _InfoPanel({required this.text});

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Text(
        text,
        style: AppTextStyles.bodyS.copyWith(color: AppColors.textPrimary),
      ),
    );
  }
}

class _MessagePanel extends StatelessWidget {
  final String message;

  const _MessagePanel({required this.message});

  @override
  Widget build(BuildContext context) {
    return _Panel(child: Text(message, style: AppTextStyles.bodyM));
  }
}

class _Panel extends StatelessWidget {
  final Widget child;

  const _Panel({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String label;

  const _StatusPill({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(label, style: AppTextStyles.labelS),
    );
  }
}

class ExchangeSettlementScreen extends StatefulWidget {
  final ExchangeReceipt? receipt;

  const ExchangeSettlementScreen({super.key, required this.receipt});

  @override
  State<ExchangeSettlementScreen> createState() =>
      _ExchangeSettlementScreenState();
}

class _ExchangeSettlementScreenState extends State<ExchangeSettlementScreen> {
  final _destinationNameController = TextEditingController();
  final _destinationAccountController = TextEditingController();
  final _destinationInstitutionController = TextEditingController();
  final _noteController = TextEditingController();
  ExchangeReceipt? _submittedReceipt;

  ExchangeReceipt? get _receipt => widget.receipt;

  @override
  void initState() {
    super.initState();
    final receipt = _receipt;
    if (receipt != null) {
      _destinationNameController.text = receipt.destinationLabel;
      _destinationInstitutionController.text = receipt.destinationInstitution;
    }
  }

  @override
  void dispose() {
    _destinationNameController.dispose();
    _destinationAccountController.dispose();
    _destinationInstitutionController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _submitDestination() {
    final receipt = _receipt;
    if (receipt == null) return;

    final destinationName = _destinationNameController.text.trim();
    final destinationAccount = _destinationAccountController.text.trim();
    final destinationInstitution =
        _destinationInstitutionController.text.trim();

    if (destinationName.isEmpty ||
        destinationAccount.isEmpty ||
        destinationInstitution.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Add the destination name, account, and institution.'),
        ),
      );
      return;
    }

    setState(() {
      _submittedReceipt = receipt.copyWith(
        destinationLabel: destinationName,
        destinationAccount: destinationAccount,
        destinationInstitution: destinationInstitution,
        note: _noteController.text.trim(),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final receipt = _submittedReceipt ?? _receipt;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xxl,
              ),
              sliver: SliverList.list(
                children: [
                  Row(
                    children: [
                      _IconButton(
                        icon: Icons.arrow_back_ios_new_rounded,
                        onTap: () => context.pop(),
                      ),
                      const Spacer(),
                      const _StatusPill(label: 'Destination'),
                    ],
                  ),
                  SizedBox(height: AppSpacing.xl),
                  Text('Settlement destination',
                      style: AppTextStyles.displayMedium),
                  SizedBox(height: AppSpacing.sm),
                  Text(
                    'Add where the converted payout should be sent.',
                    style: AppTextStyles.bodyL,
                  ),
                  SizedBox(height: AppSpacing.xl),
                  if (receipt == null) ...[
                    const _InfoPanel(
                      text:
                          'Create an exchange quote first, then add the settlement destination.',
                    ),
                    SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: () => context.go(AppRoutes.exchange),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(56),
                      ),
                      child: const Text('Create quote'),
                    ),
                  ] else ...[
                    _Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _ReceiptMetricRow(
                            label: 'Quote',
                            value:
                                '${receipt.sendAmount} ${receipt.fromCurrency} to ${receipt.receiveAmount} ${receipt.toCurrency}',
                          ),
                          _ReceiptMetricRow(
                            label: 'Reference',
                            value: receipt.id,
                            showDivider: false,
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: AppSpacing.lg),
                    _Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _InputField(
                            controller: _destinationNameController,
                            label: receipt.toCurrency == 'NGN'
                                ? 'Recipient name'
                                : 'Wallet holder',
                          ),
                          SizedBox(height: AppSpacing.md),
                          _InputField(
                            controller: _destinationAccountController,
                            label: receipt.toCurrency == 'NGN'
                                ? 'Bank account number'
                                : 'Mobile money or account number',
                            keyboardType: TextInputType.number,
                          ),
                          SizedBox(height: AppSpacing.md),
                          _InputField(
                            controller: _destinationInstitutionController,
                            label: receipt.toCurrency == 'NGN'
                                ? 'Bank name or code'
                                : 'Bank or mobile money provider',
                          ),
                          SizedBox(height: AppSpacing.md),
                          _InputField(
                            controller: _noteController,
                            label: 'Instruction note optional',
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: _submitDestination,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(56),
                      ),
                      child: const Text('Submit for review'),
                    ),
                    if (_submittedReceipt != null) ...[
                      SizedBox(height: AppSpacing.lg),
                      _ExchangeReceiptCard(receipt: _submittedReceipt!),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExchangeSwapPanel extends StatelessWidget {
  final String fromCurrency;
  final String toCurrency;
  final TextEditingController amountController;
  final double estimatedReceive;
  final ValueChanged<String> onFromChanged;
  final ValueChanged<String> onToChanged;
  final VoidCallback onSwap;

  const _ExchangeSwapPanel({
    required this.fromCurrency,
    required this.toCurrency,
    required this.amountController,
    required this.estimatedReceive,
    required this.onFromChanged,
    required this.onToChanged,
    required this.onSwap,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.surface,
                AppColors.surfaceVariant,
              ],
            ),
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              _ExchangeLegCard(
                title: 'You send',
                currency: fromCurrency,
                selectorLabel: 'Debit wallet',
                amountController: amountController,
                onCurrencyChanged: onFromChanged,
                trailing: 'Wallet balance',
              ),
              SizedBox(height: 58),
              _ExchangeLegResultCard(
                title: 'You receive',
                currency: toCurrency,
                amount: estimatedReceive,
                onCurrencyChanged: onToChanged,
              ),
            ],
          ),
        ),
        Positioned(
          child: GestureDetector(
            onTap: onSwap,
            child: Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.border, width: 6),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.overlayLight,
                    blurRadius: 14,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Icon(
                Icons.swap_vert_rounded,
                color: AppColors.primary,
                size: 28,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ExchangeLegCard extends StatelessWidget {
  final String title;
  final String currency;
  final String selectorLabel;
  final String trailing;
  final TextEditingController amountController;
  final ValueChanged<String> onCurrencyChanged;

  const _ExchangeLegCard({
    required this.title,
    required this.currency,
    required this.selectorLabel,
    required this.trailing,
    required this.amountController,
    required this.onCurrencyChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: AppTextStyles.bodyM),
              const Spacer(),
              Text(trailing, style: AppTextStyles.bodyS),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          Row(
            children: [
              _ExchangeCurrencyPill(
                currency: currency,
                onChanged: onCurrencyChanged,
              ),
              SizedBox(width: AppSpacing.sm),
              Expanded(
                child: TextField(
                  controller: amountController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  textAlign: TextAlign.right,
                  style: AppTextStyles.displayMedium.copyWith(fontSize: 26),
                  decoration: InputDecoration(
                    hintText: '0.00',
                    hintStyle: AppTextStyles.displayMedium.copyWith(
                      fontSize: 26,
                      color: AppColors.textHint,
                    ),
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: AppSpacing.sm),
          Text(selectorLabel, style: AppTextStyles.bodyS),
        ],
      ),
    );
  }
}

class _ExchangeLegResultCard extends StatelessWidget {
  final String title;
  final String currency;
  final double amount;
  final ValueChanged<String> onCurrencyChanged;

  const _ExchangeLegResultCard({
    required this.title,
    required this.currency,
    required this.amount,
    required this.onCurrencyChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(AppRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.bodyM),
          SizedBox(height: AppSpacing.md),
          Row(
            children: [
              _ExchangeCurrencyPill(
                currency: currency,
                onChanged: onCurrencyChanged,
              ),
              SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  amount <= 0 ? '0.00' : amount.toStringAsFixed(2),
                  textAlign: TextAlign.right,
                  style: AppTextStyles.displayMedium.copyWith(fontSize: 26),
                ),
              ),
            ],
          ),
          SizedBox(height: AppSpacing.sm),
          Text(
            'Estimated payout after quote creation',
            style: AppTextStyles.bodyS,
          ),
        ],
      ),
    );
  }
}

class _ExchangeCurrencyPill extends StatelessWidget {
  final String currency;
  final ValueChanged<String> onChanged;

  const _ExchangeCurrencyPill({
    required this.currency,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 6,
      ),
      constraints: const BoxConstraints(minWidth: 92),
      decoration: BoxDecoration(
        color: AppColors.inputFill,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: currency,
          isDense: true,
          dropdownColor: AppColors.surface,
          iconEnabledColor: AppColors.textPrimary,
          style: AppTextStyles.labelM.copyWith(color: AppColors.textPrimary),
          items: const ['NGN', 'GHS']
              .map(
                (item) => DropdownMenuItem<String>(
                  value: item,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_currencyFlag(item)),
                      SizedBox(width: 6),
                      Text(item),
                    ],
                  ),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
      ),
    );
  }
}

class _ExchangeRatePanel extends StatelessWidget {
  final String fromCurrency;
  final String toCurrency;
  final double amount;
  final double estimatedReceive;

  const _ExchangeRatePanel({
    required this.fromCurrency,
    required this.toCurrency,
    required this.amount,
    required this.estimatedReceive,
  });

  @override
  Widget build(BuildContext context) {
    final fee = amount <= 0 ? 0.0 : amount * 0.015;
    final rate = amount <= 0 ? 0.0 : estimatedReceive / amount;

    return _Panel(
      child: Column(
        children: [
          _ReceiptMetricRow(
            label: 'Direction',
            value: '$fromCurrency to $toCurrency',
          ),
          _ReceiptMetricRow(
            label: 'Service fee',
            value: '${fee.toStringAsFixed(2)} $fromCurrency',
          ),
          _ReceiptMetricRow(
            label: 'Indicative rate',
            value: amount <= 0
                ? '--'
                : '1 $fromCurrency = ${rate.toStringAsFixed(4)} $toCurrency',
          ),
          _ReceiptMetricRow(
            label: 'Settlement flow',
            value: 'Submit for review',
            showDivider: false,
          ),
        ],
      ),
    );
  }
}

class _ExchangeReceiptCard extends StatelessWidget {
  final ExchangeReceipt receipt;

  const _ExchangeReceiptCard({required this.receipt});

  @override
  Widget build(BuildContext context) {
    final formatter = DateFormat('dd MMM yyyy â€¢ HH:mm');
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.overlayLight,
            blurRadius: 24,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Column(
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        AppColors.primaryLight.withValues(alpha: 0.88),
                        AppColors.primary.withValues(alpha: 0.88),
                      ],
                    ),
                  ),
                  child: Icon(
                    Icons.receipt_long_rounded,
                    color: Colors.white,
                    size: 34,
                  ),
                ),
                SizedBox(height: AppSpacing.md),
                Text('Exchange quote created', style: AppTextStyles.headingL),
                SizedBox(height: AppSpacing.xs),
                Text(
                  'Receipt prepared. Review the details before payout.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyM,
                ),
              ],
            ),
          ),
          const _ReceiptCutLine(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'Receipt ID',
                        value: receipt.id,
                      ),
                    ),
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'Status',
                        value: receipt.status,
                        alignEnd: true,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: AppSpacing.lg),
                Row(
                  children: [
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'You send',
                        value: '${receipt.sendAmount} ${receipt.fromCurrency}',
                      ),
                    ),
                    Expanded(
                      child: _ReceiptMetricColumn(
                        label: 'You receive',
                        value: '${receipt.receiveAmount} ${receipt.toCurrency}',
                        alignEnd: true,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: AppSpacing.lg),
                _ReceiptMetricRow(
                  label: 'Date & time',
                  value: formatter.format(receipt.createdAt),
                ),
                _ReceiptMetricRow(
                  label: 'Exchange rate',
                  value:
                      '1 ${receipt.fromCurrency} = ${receipt.rate} ${receipt.toCurrency}',
                ),
                _ReceiptMetricRow(
                  label: 'Fee',
                  value: '${receipt.fee} ${receipt.fromCurrency}',
                ),
                _ReceiptMetricRow(
                  label: 'Destination',
                  value: receipt.destinationLabel,
                ),
                _ReceiptMetricRow(
                  label: 'Account',
                  value: receipt.destinationAccount,
                ),
                _ReceiptMetricRow(
                  label: 'Institution',
                  value: receipt.destinationInstitution,
                  showDivider: receipt.note.isEmpty,
                ),
                if (receipt.note.isNotEmpty)
                  _ReceiptMetricRow(
                    label: 'Instruction',
                    value: receipt.note,
                    showDivider: false,
                  ),
              ],
            ),
          ),
          const _ReceiptCutLine(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            child: Column(
              children: [
                Text(
                  'SUBMITTED FOR REVIEW',
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                SizedBox(height: AppSpacing.sm),
                Text(
                  'Your exchange request is ready for payout processing.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyS,
                ),
                SizedBox(height: AppSpacing.md),
                Container(
                  width: double.infinity,
                  height: 56,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: AppColors.border,
                      style: BorderStyle.solid,
                    ),
                  ),
                  child: CustomPaint(
                    painter: _BarcodePainter(),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReceiptMetricColumn extends StatelessWidget {
  final String label;
  final String value;
  final bool alignEnd;

  const _ReceiptMetricColumn({
    required this.label,
    required this.value,
    this.alignEnd = false,
  });

  @override
  Widget build(BuildContext context) {
    final alignment =
        alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Column(
      crossAxisAlignment: alignment,
      children: [
        Text(label, style: AppTextStyles.bodyS),
        SizedBox(height: AppSpacing.xs),
        Text(
          value,
          textAlign: alignEnd ? TextAlign.right : TextAlign.left,
          style: AppTextStyles.headingM.copyWith(letterSpacing: 0),
        ),
      ],
    );
  }
}

class _ReceiptMetricRow extends StatelessWidget {
  final String label;
  final String value;
  final bool showDivider;

  const _ReceiptMetricRow({
    required this.label,
    required this.value,
    this.showDivider = true,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(label, style: AppTextStyles.bodyS)),
            SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: AppTextStyles.labelM.copyWith(letterSpacing: 0),
              ),
            ),
          ],
        ),
        if (showDivider) ...[
          SizedBox(height: AppSpacing.sm),
          Divider(color: AppColors.divider, height: 1),
          SizedBox(height: AppSpacing.sm),
        ],
      ],
    );
  }
}

class _ReceiptCutLine extends StatelessWidget {
  const _ReceiptCutLine();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 24,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned(
            left: -12,
            child: Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            right: -12,
            child: Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: AppColors.background,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned.fill(
            child: Center(
              child: Container(
                height: 1,
                margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(
                      color: AppColors.border,
                      width: 1,
                      style: BorderStyle.solid,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BarcodePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = AppColors.textPrimary;
    double x = 14;
    const pattern = [
      2.0,
      1.0,
      3.0,
      2.0,
      1.5,
      4.0,
      1.0,
      2.5,
      1.0,
      3.5,
      2.0,
      1.0,
      2.0,
      4.0,
      1.0,
      2.5,
      3.0,
      1.0,
      2.0,
      1.5,
    ];

    for (var i = 0; x < size.width - 14; i++) {
      final width = pattern[i % pattern.length];
      canvas.drawRect(
        Rect.fromLTWH(x, 8, width, size.height - 16),
        paint,
      );
      x += width + ((i % 3) + 1);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _IconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _IconButton({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, color: AppColors.textPrimary, size: 18),
        ),
      ),
    );
  }
}

InputDecoration _inputDecoration(String label) {
  return InputDecoration(
    labelText: label,
    labelStyle: AppTextStyles.bodyM,
    filled: true,
    fillColor: AppColors.surfaceVariant,
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: AppColors.border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: AppColors.primary),
    ),
  );
}

_ActionConfig _configFor(MoneyActionKind kind) {
  switch (kind) {
    case MoneyActionKind.fund:
      return const _ActionConfig(
        title: 'Fund wallet',
        subtitle: 'Initialize a provider payment for your wallet.',
        buttonLabel: 'Initialize funding',
        status: 'Live endpoint',
        icon: Icons.add_card_rounded,
      );
    case MoneyActionKind.send:
      return const _ActionConfig(
        title: 'Send money',
        subtitle: 'Send to another TRUSTPAY user by email.',
        buttonLabel: 'Send transfer',
        status: 'KYC gated',
        icon: Icons.near_me_rounded,
      );
    case MoneyActionKind.withdraw:
      return const _ActionConfig(
        title: 'Withdraw',
        subtitle: 'Send wallet funds to a bank account.',
        buttonLabel: 'Submit withdrawal',
        status: 'KYC gated',
        icon: Icons.account_balance_rounded,
      );
    case MoneyActionKind.exchange:
      return const _ActionConfig(
        title: 'Exchange',
        subtitle: 'Create a cross-currency settlement request.',
        buttonLabel: 'Submit for review',
        status: 'Quote request',
        icon: Icons.currency_exchange_rounded,
      );
    case MoneyActionKind.airtime:
      return const _ActionConfig(
        title: 'Airtime',
        subtitle: 'Buy airtime from your NGN wallet.',
        buttonLabel: 'Buy airtime',
        status: 'Live endpoint',
        icon: Icons.phone_android_rounded,
      );
    case MoneyActionKind.data:
      return const _ActionConfig(
        title: 'Data',
        subtitle: 'Buy mobile data from your NGN wallet.',
        buttonLabel: 'Buy data',
        status: 'Live endpoint',
        icon: Icons.signal_cellular_alt_rounded,
      );
    case MoneyActionKind.electricity:
      return const _ActionConfig(
        title: 'Electricity',
        subtitle: 'Recharge prepaid electricity from your phone.',
        buttonLabel: 'Recharge meter',
        status: 'Live endpoint',
        icon: Icons.bolt_rounded,
      );
  }
}

String _successMessage(dynamic data) {
  if (data is Map<String, dynamic>) {
    final reference = data['reference'] ?? data['id'];
    final message = data['message'];
    if (message is String && reference != null) {
      return '$message\nReference: $reference';
    }
    if (reference != null) return 'Request created.\nReference: $reference';
    return 'Request completed: $data';
  }
  return 'Request completed.';
}

class _ActionConfig {
  final String title;
  final String subtitle;
  final String buttonLabel;
  final String status;
  final IconData icon;

  const _ActionConfig({
    required this.title,
    required this.subtitle,
    required this.buttonLabel,
    required this.status,
    required this.icon,
  });
}

class ExchangeReceipt {
  final String id;
  final String fromCurrency;
  final String toCurrency;
  final String sendAmount;
  final String receiveAmount;
  final String rate;
  final String fee;
  final DateTime createdAt;
  final String status;
  final String destinationLabel;
  final String destinationAccount;
  final String destinationInstitution;
  final String note;

  const ExchangeReceipt({
    required this.id,
    required this.fromCurrency,
    required this.toCurrency,
    required this.sendAmount,
    required this.receiveAmount,
    required this.rate,
    required this.fee,
    required this.createdAt,
    required this.status,
    required this.destinationLabel,
    required this.destinationAccount,
    required this.destinationInstitution,
    required this.note,
  });

  factory ExchangeReceipt.fromApi(
    Map<String, dynamic> data, {
    required String destinationLabel,
    required String destinationAccount,
    required String destinationInstitution,
    required String note,
  }) {
    String formatAmount(dynamic value) {
      if (value is num) return value.toStringAsFixed(2);
      final parsed = double.tryParse('$value') ?? 0;
      return parsed.toStringAsFixed(2);
    }

    return ExchangeReceipt(
      id: '${data['id'] ?? 'QUOTE'}',
      fromCurrency: '${data['from'] ?? 'GHS'}',
      toCurrency: '${data['to'] ?? 'NGN'}',
      sendAmount: formatAmount(data['sendAmount'] ?? data['amount']),
      receiveAmount: formatAmount(data['receiveAmount'] ?? 0),
      rate: formatAmount(data['rate'] ?? 0),
      fee: formatAmount(data['fee'] ?? 0),
      createdAt: DateTime.tryParse('${data['createdAt']}') ?? DateTime.now(),
      status: 'Pending review',
      destinationLabel: destinationLabel,
      destinationAccount: destinationAccount,
      destinationInstitution: destinationInstitution,
      note: note,
    );
  }

  ExchangeReceipt copyWith({
    String? destinationLabel,
    String? destinationAccount,
    String? destinationInstitution,
    String? note,
  }) {
    return ExchangeReceipt(
      id: id,
      fromCurrency: fromCurrency,
      toCurrency: toCurrency,
      sendAmount: sendAmount,
      receiveAmount: receiveAmount,
      rate: rate,
      fee: fee,
      createdAt: createdAt,
      status: status,
      destinationLabel: destinationLabel ?? this.destinationLabel,
      destinationAccount: destinationAccount ?? this.destinationAccount,
      destinationInstitution:
          destinationInstitution ?? this.destinationInstitution,
      note: note ?? this.note,
    );
  }
}

String _currencyFlag(String currency) {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return '🇳🇬';
    case 'GHS':
      return '🇬🇭';
    default:
      return '';
  }
}
