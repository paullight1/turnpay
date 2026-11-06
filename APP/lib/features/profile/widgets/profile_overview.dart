import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/state/exchange_visibility.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/home_data_service.dart';

class ProfileOverview extends StatelessWidget {
  final HomeUser user;
  final VoidCallback onLogout;
  const ProfileOverview(
      {super.key, required this.user, required this.onLogout});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return ListView(
      padding: const EdgeInsets.only(bottom: 100),
      children: [
        Text('My Profile',
            style:
                AppTextStyles.headingXL.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 28),
        Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => context.push(AppRoutes.profileAccount),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Row(children: [
                Stack(clipBehavior: Clip.none, children: [
                  Container(
                    width: 76,
                    height: 76,
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.primary, width: 2)),
                    child: CircleAvatar(
                        backgroundColor:
                            AppColors.primary.withValues(alpha: .12),
                        child: Text(user.initials,
                            style: AppTextStyles.headingL.copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w800))),
                  ),
                  Positioned(
                      right: -2,
                      bottom: -2,
                      child: Container(
                          width: 30,
                          height: 30,
                          decoration: BoxDecoration(
                              color: AppColors.surfaceVariant,
                              shape: BoxShape.circle,
                              border: Border.all(
                                  color: AppColors.surface, width: 2)),
                          child: Icon(Icons.edit_outlined,
                              color: AppColors.primary, size: 16))),
                ]),
                const SizedBox(width: 20),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(user.displayName, style: AppTextStyles.headingM),
                      const SizedBox(height: 6),
                      Text(user.email, style: AppTextStyles.bodyM),
                    ])),
              ]),
            ),
          ),
        ),
        const SizedBox(height: 28),
        _sectionLabel('Account'),
        const SizedBox(height: 12),
        _ProfileGroup(children: [
          _ProfileMenuTile(
              icon: Icons.person_outline_rounded,
              label: 'Account Details',
              onTap: () => context.push(AppRoutes.profileAccount)),
          _ProfileMenuTile(
              icon: Icons.shield_outlined,
              label: 'Security & Limits',
              onTap: () => context.push(AppRoutes.profileSecurity)),
          _ProfileMenuTile(
              icon: Icons.headset_mic_outlined,
              label: 'Help & Support',
              onTap: () => context.push(AppRoutes.profileSupport)),
          _ProfileMenuTile(
              icon: Icons.card_giftcard_outlined,
              label: 'Invite friends',
              onTap: () => context.push(AppRoutes.profileReferrals)),
          _ProfileMenuTile(
              icon: Icons.receipt_long_outlined,
              label: 'Transactions',
              onTap: () => context.push(AppRoutes.activity)),
          _ProfileMenuTile(
              icon: Icons.notifications_none_rounded,
              label: 'Notifications',
              onTap: () => context.push(AppRoutes.notifications)),
        ]),
        const SizedBox(height: 28),
        _sectionLabel('Preferences'),
        const SizedBox(height: 12),
        _ProfileGroup(children: [
          _ProfileMenuTile(
              icon: Icons.dark_mode_outlined,
              label: 'Appearance',
              onTap: () => context.push(AppRoutes.profileAppearance)),
          ValueListenableBuilder<bool>(
            valueListenable: exchangeServicesEnabled,
            builder: (context, enabled, _) => SwitchListTile.adaptive(
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              secondary:
                  const _ProfileMenuIcon(icon: Icons.currency_exchange_rounded),
              title: Text('Exchange services',
                  style: AppTextStyles.labelL
                      .copyWith(fontWeight: FontWeight.w600)),
              value: enabled,
              onChanged: setExchangeServicesEnabled,
            ),
          ),
        ]),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          onPressed: onLogout,
          style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.error,
              side: BorderSide(color: AppColors.error.withValues(alpha: .3))),
          icon: const Icon(Icons.logout_rounded, size: 20),
          label: const Text('Log Out'),
        ),
      ],
    );
  }

  Widget _sectionLabel(String label) => Text(label,
      style: AppTextStyles.labelL.copyWith(fontWeight: FontWeight.w600));
}

class _ProfileGroup extends StatelessWidget {
  final List<Widget> children;
  const _ProfileGroup({required this.children});
  @override
  Widget build(BuildContext context) => Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        clipBehavior: Clip.antiAlias,
        child: Column(children: children),
      );
}

class _ProfileMenuIcon extends StatelessWidget {
  final IconData icon;
  const _ProfileMenuIcon({required this.icon});
  @override
  Widget build(BuildContext context) => Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
          color: AppColors.surfaceVariant, shape: BoxShape.circle),
      child: Icon(icon, color: AppColors.textSecondary, size: 21));
}

class _ProfileMenuTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _ProfileMenuTile(
      {required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 66),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(children: [
              _ProfileMenuIcon(icon: icon),
              const SizedBox(width: 16),
              Expanded(
                  child: Text(label,
                      style: AppTextStyles.labelL
                          .copyWith(fontWeight: FontWeight.w600))),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded,
                  color: AppColors.textHint, size: 22),
            ]),
          ),
        ),
      );
}
