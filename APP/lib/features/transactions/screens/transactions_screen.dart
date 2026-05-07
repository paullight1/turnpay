import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

/// Transactions history screen (stub - full implementation is Phase 4 task list)
class TransactionsScreen extends StatelessWidget {
  const TransactionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('History', style: AppTextStyles.headingXL),
              const SizedBox(height: AppSpacing.lg),
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.receipt_long_rounded,
                        size: 56,
                        color: AppColors.textHint,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        'Transaction history',
                        style: AppTextStyles.headingM,
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'All your transfers, VTU, and\nbill payments will appear here.',
                        style: AppTextStyles.bodyM,
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
