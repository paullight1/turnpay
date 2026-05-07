import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// User profile and settings screen (stub)
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

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
              Text('Profile', style: AppTextStyles.headingXL),
              const SizedBox(height: AppSpacing.lg),
              
              // Profile Header
              Row(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                      child: Text(
                        'JA',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('John Appleseed', style: AppTextStyles.headingM),
                      Text('john@example.com', style: AppTextStyles.bodyM),
                    ],
                  ),
                ],
              ),
              
              const SizedBox(height: AppSpacing.xxl),
              
              // Settings List Stub
              _SettingsRow(icon: Icons.person_outline, label: 'Account Details'),
              _SettingsRow(icon: Icons.security_rounded, label: 'Security & Limits'),
              _SettingsRow(icon: Icons.notifications_outlined, label: 'Notifications'),
              _SettingsRow(icon: Icons.help_outline_rounded, label: 'Help & Support'),
              
              const Spacer(),
              
              Center(
                child: Text(
                  'Log Out',
                  style: AppTextStyles.labelL.copyWith(color: AppColors.error),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  final IconData icon;
  final String label;
  
  const _SettingsRow({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(icon, color: AppColors.textPrimary, size: 20),
          ),
          const SizedBox(width: AppSpacing.md),
          Text(label, style: AppTextStyles.labelM),
          const Spacer(),
          const Icon(Icons.chevron_right_rounded, color: AppColors.textHint, size: 20),
        ],
      ),
    );
  }
}
