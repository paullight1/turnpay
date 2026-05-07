import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

class TransactionsScreen extends StatelessWidget {
  const TransactionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: Text('Transactions', style: AppTextStyles.displayMedium),
        ),
      ),
    );
  }
}
