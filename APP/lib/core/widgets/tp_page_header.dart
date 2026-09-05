import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../theme/app_theme.dart';

class TpPageMenuAction {
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const TpPageMenuAction({
    required this.label,
    required this.icon,
    required this.onTap,
  });
}

class TpPageHeader extends StatelessWidget {
  final String label;
  final bool showBackButton;
  final VoidCallback? onBack;
  final VoidCallback? onMenu;
  final List<TpPageMenuAction> menuActions;
  final bool edgeToEdge;

  const TpPageHeader({
    super.key,
    required this.label,
    this.showBackButton = true,
    this.onBack,
    this.onMenu,
    this.menuActions = const [],
    this.edgeToEdge = true,
  });

  VoidCallback _resolveBackAction(BuildContext context) {
    if (onBack != null) return onBack!;
    return () {
      if (context.canPop()) {
        context.pop();
      } else {
        context.go(AppRoutes.home);
      }
    };
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final width = MediaQuery.sizeOf(context).width;
    final handleBack = _resolveBackAction(context);

    final header = Container(
      width: edgeToEdge ? width : double.infinity,
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(color: AppColors.primary),
      child: Row(
        children: [
          if (showBackButton)
            _HeaderIconButton(
              icon: Icons.arrow_back_ios_new_rounded,
              tooltip: 'Back',
              onTap: handleBack,
            ),
          if (showBackButton) const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              label,
              style: AppTextStyles.headingM.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                letterSpacing: 0,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          _HeaderIconButton(
            icon: Icons.more_horiz_rounded,
            tooltip: 'Menu',
            onTap: onMenu ?? () => _showPageMenu(context),
          ),
        ],
      ),
    );

    if (!edgeToEdge) return header;

    return SizedBox(
      height: 58,
      child: OverflowBox(
        alignment: Alignment.center,
        minWidth: width,
        maxWidth: width,
        minHeight: 58,
        maxHeight: 58,
        child: Transform.translate(
          offset: const Offset(0, -AppSpacing.md),
          child: header,
        ),
      ),
    );
  }

  void _showPageMenu(BuildContext context) {
    final actions = [
      if (showBackButton)
        TpPageMenuAction(
          label: 'Back',
          icon: Icons.arrow_back_rounded,
          onTap: _resolveBackAction(context),
        ),
      ...menuActions,
      TpPageMenuAction(
        label: 'Home',
        icon: Icons.home_rounded,
        onTap: () => context.go(AppRoutes.home),
      ),
    ];

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppRadius.lg),
        ),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: actions.map((action) {
                return ListTile(
                  leading: Icon(action.icon, color: AppColors.primary),
                  title: Text(action.label, style: AppTextStyles.labelM),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    action.onTap();
                  },
                );
              }).toList(),
            ),
          ),
        );
      },
    );
  }
}

class TpAppHeader extends StatelessWidget implements PreferredSizeWidget {
  final String label;
  final VoidCallback? onBack;
  final List<TpPageMenuAction> menuActions;

  const TpAppHeader({
    super.key,
    required this.label,
    this.onBack,
    this.menuActions = const [],
  });

  @override
  Size get preferredSize => const Size.fromHeight(58);

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Material(
      color: AppColors.primary,
      child: SafeArea(
        bottom: false,
        child: TpPageHeader(
          label: label,
          onBack: onBack,
          menuActions: menuActions,
          edgeToEdge: false,
        ),
      ),
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  const _HeaderIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.full),
          onTap: onTap,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, color: Colors.white, size: 23),
          ),
        ),
      ),
    );
  }
}
