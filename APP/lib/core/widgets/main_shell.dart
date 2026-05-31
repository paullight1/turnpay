import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../features/analytics/screens/analytics_screen.dart';
import '../../features/home/screens/dashboard_detail_screen.dart';
import '../../features/home/screens/home_screen.dart';
import '../../features/home/screens/money_action_screen.dart';
import 'micro_interactions.dart';

class _NavItem {
  final String label;
  final IconData icon;
  final IconData activeIcon;

  const _NavItem({
    required this.label,
    required this.icon,
    required this.activeIcon,
  });
}

const _navItems = [
  _NavItem(
    label: 'Home',
    icon: Icons.home_outlined,
    activeIcon: Icons.home_rounded,
  ),
  _NavItem(
    label: 'Exchange',
    icon: Icons.currency_exchange_rounded,
    activeIcon: Icons.currency_exchange_rounded,
  ),
  _NavItem(
    label: 'History',
    icon: Icons.pie_chart_outline_rounded,
    activeIcon: Icons.pie_chart_rounded,
  ),
  _NavItem(
    label: 'Profile',
    icon: Icons.person_outline_rounded,
    activeIcon: Icons.person_rounded,
  ),
];

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _selectedIndex = 0;

  static const _screens = [
    HomeScreen(),
    MoneyActionScreen(
      kind: MoneyActionKind.exchange,
      showBackButton: false,
    ),
    AnalyticsScreen(),
    DashboardProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      backgroundColor: AppColors.background,
      body: IndexedStack(
        index: _selectedIndex,
        children: _screens,
      ),
      bottomNavigationBar: _TrustPayBottomNav(
        selectedIndex: _selectedIndex,
        onTap: (i) => setState(() => _selectedIndex = i),
      ),
    );
  }
}

class _TrustPayBottomNav extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onTap;

  const _TrustPayBottomNav({
    required this.selectedIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: SizedBox(
        height: 76,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final itemWidth = constraints.maxWidth / _navItems.length;
            final pillWidth = itemWidth - 10;

            return Stack(
              children: [
                AnimatedPositioned(
                  duration: const Duration(milliseconds: 260),
                  curve: Curves.easeOutCubic,
                  left: selectedIndex * itemWidth + 5,
                  top: 8,
                  width: pillWidth,
                  height: 60,
                  child: const _LiquidGlassPill(),
                ),
                Row(
                  children: List.generate(_navItems.length, (index) {
                    final item = _navItems[index];
                    final isActive = index == selectedIndex;

                    return Expanded(
                      child: _NavBarItem(
                        item: item,
                        isActive: isActive,
                        onTap: () => onTap(index),
                      ),
                    );
                  }),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _LiquidGlassPill extends StatelessWidget {
  const _LiquidGlassPill();

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.full);

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: radius,
            color: Colors.white.withValues(alpha: 0.34),
            border: Border.all(
              color: Colors.white.withValues(alpha: 0.86),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.16),
                blurRadius: 22,
                offset: const Offset(0, 10),
              ),
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.82),
                blurRadius: 2,
                offset: const Offset(0, -1),
              ),
            ],
            gradient: LinearGradient(
              begin: const Alignment(-0.82, -1),
              end: const Alignment(0.88, 1),
              colors: [
                Colors.white.withValues(alpha: 0.92),
                Colors.white.withValues(alpha: 0.26),
                Colors.white.withValues(alpha: 0.56),
              ],
              stops: const [0, 0.52, 1],
            ),
          ),
          child: Stack(
            children: [
              Positioned(
                left: 18,
                right: 18,
                top: 5,
                child: Container(
                  height: 2,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    gradient: LinearGradient(
                      colors: [
                        Colors.white.withValues(alpha: 0),
                        Colors.white.withValues(alpha: 0.96),
                        Colors.white.withValues(alpha: 0),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 8,
                top: 10,
                child: Container(
                  width: 18,
                  height: 28,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    color: Colors.white.withValues(alpha: 0.22),
                  ),
                ),
              ),
              Positioned(
                right: 10,
                bottom: 7,
                child: Container(
                  width: 30,
                  height: 13,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    color: AppColors.primaryLight.withValues(alpha: 0.10),
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

class _NavBarItem extends StatelessWidget {
  final _NavItem item;
  final bool isActive;
  final VoidCallback onTap;

  const _NavBarItem({
    required this.item,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isActive ? AppColors.primary : AppColors.textSecondary;
    final borderRadius = BorderRadius.circular(AppRadius.full);

    return Tooltip(
      message: item.label,
      child: Semantics(
        button: true,
        selected: isActive,
        label: item.label,
        child: TapScale(
          onTap: onTap,
          borderRadius: borderRadius,
          pressedScale: 0.94,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            margin: const EdgeInsets.symmetric(horizontal: 5, vertical: 8),
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              borderRadius: borderRadius,
              color: Colors.transparent,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  isActive ? item.activeIcon : item.icon,
                  color: color,
                  size: isActive ? 23 : 22,
                ),
                const SizedBox(height: 3),
                Text(
                  item.label,
                  style: AppTextStyles.caption.copyWith(
                    color: color,
                    fontWeight: isActive ? FontWeight.w800 : FontWeight.w500,
                    letterSpacing: 0,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
