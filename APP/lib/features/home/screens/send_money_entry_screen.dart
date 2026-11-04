import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/api_client.dart';
import 'money_action_screen.dart';

/// Choose a destination before loading the corresponding transfer form.
class SendMoneyEntryScreen extends StatelessWidget {
  final ApiClient? apiClient;
  const SendMoneyEntryScreen({super.key, this.apiClient});

  void _open(BuildContext context, MoneyActionKind kind) {
    Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => MoneyActionScreen(kind: kind, apiClient: apiClient)));
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
          title: const Text('Send money'),
          leading: BackButton(onPressed: () {
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            } else {
              context.go(AppRoutes.home);
            }
          })),
      body: SafeArea(
        child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 552),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const SizedBox(height: 32),
                          Text('Where are you sending money?',
                              style: AppTextStyles.headingXL),
                          const SizedBox(height: 12),
                          Text('Choose a destination to get started.',
                              style: AppTextStyles.bodyM),
                          const SizedBox(height: 32),
                          _destination(
                              context,
                              'TrustPay',
                              'Send by TrustPay account number or email',
                              Icons.people_outline_rounded,
                              MoneyActionKind.send),
                          const SizedBox(height: 16),
                          _destination(
                              context,
                              'Bank account',
                              'Send to a Nigerian bank account',
                              Icons.account_balance_outlined,
                              MoneyActionKind.withdraw),
                        ])))),
      ),
    );
  }

  Widget _destination(BuildContext context, String title, String subtitle,
          IconData icon, MoneyActionKind kind) =>
      Material(
          color: AppColors.surface,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(22),
              side: BorderSide(color: AppColors.border)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
              onTap: () => _open(context, kind),
              child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Row(children: [
                    Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: .09),
                            borderRadius: BorderRadius.circular(16)),
                        child: Icon(icon, color: AppColors.primary, size: 28)),
                    const SizedBox(width: 18),
                    Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                          Text(title, style: AppTextStyles.headingM),
                          const SizedBox(height: 6),
                          Text(subtitle, style: AppTextStyles.bodyS)
                        ])),
                    const SizedBox(width: 8),
                    const Icon(Icons.arrow_forward_rounded, size: 22),
                  ]))));
}
