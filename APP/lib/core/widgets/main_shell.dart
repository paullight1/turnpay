import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../state/exchange_visibility.dart';
import '../../features/home/screens/dashboard_detail_screen.dart';
import '../../features/home/screens/home_screen.dart';
import '../../features/exchange/screens/kora_exchange_screen.dart';
import '../../features/notifications/services/notifications_service.dart';
import '../../services/home_data_service.dart';
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
  final HomeDataService homeDataService;
  final NotificationsService notificationsService;

  MainShell({
    super.key,
    HomeDataService? homeDataService,
    NotificationsService? notificationsService,
  })  : homeDataService = homeDataService ?? HomeDataService(),
        notificationsService = notificationsService ?? NotificationsService();

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _selectedIndex = 0;
  bool _exchangeVisited = false;

  @override
  void initState() {
    super.initState();
    exchangeServicesEnabled.addListener(_onExchangePreferenceChanged);
    loadExchangeServicesPreference();
  }

  @override
  void dispose() {
    exchangeServicesEnabled.removeListener(_onExchangePreferenceChanged);
    super.dispose();
  }

  void _onExchangePreferenceChanged() {
    if (!exchangeServicesEnabled.value && _selectedIndex == 1) {
      setState(() => _selectedIndex = 0);
    } else {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      extendBody: true,
      backgroundColor: AppColors.background,
      body: Stack(children: [
        Offstage(
          offstage: _selectedIndex != 0,
          child: TickerMode(
            enabled: _selectedIndex == 0,
            child: HomeScreen(
              homeDataService: widget.homeDataService,
              notificationsService: widget.notificationsService,
              isHomeTabActive: _selectedIndex == 0,
            ),
          ),
        ),
        if (_exchangeVisited)
          Offstage(
            offstage: _selectedIndex != 1,
            child: TickerMode(
                enabled: _selectedIndex == 1,
                child: ExchangeEntryScreen(
                    showBackButton: false, active: _selectedIndex == 1)),
          ),
        if (_selectedIndex > 1) _screenFor(_selectedIndex),
      ]),
      bottomNavigationBar: MediaQuery.viewInsetsOf(context).bottom > 0
          ? null
          : _TrustPayBottomNav(
              selectedIndex: _selectedIndex,
              exchangeEnabled: exchangeServicesEnabled.value,
              onTap: (i) {
                if (i == _selectedIndex) return;
                FocusManager.instance.primaryFocus?.unfocus();
                setState(() {
                  _selectedIndex = i;
                  if (i == 1) _exchangeVisited = true;
                });
              },
            ),
    );
  }

  Widget _screenFor(int index) {
    switch (index) {
      case 1:
        return const ExchangeEntryScreen(showBackButton: false);
      case 2:
        return DashboardTransactionsScreen(
          homeDataService: widget.homeDataService,
        );
      case 3:
        return DashboardProfileScreen(
          homeDataService: widget.homeDataService,
        );
      case 0:
      default:
        return HomeScreen(
          homeDataService: widget.homeDataService,
          notificationsService: widget.notificationsService,
          isHomeTabActive: _selectedIndex == 0,
        );
    }
  }
}

class _TrustPayBottomNav extends StatelessWidget {
  final int selectedIndex;
  final bool exchangeEnabled;
  final ValueChanged<int> onTap;

  const _TrustPayBottomNav({
    required this.selectedIndex,
    required this.exchangeEnabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final entries = [
      for (var index = 0; index < _navItems.length; index++)
        if (index != 1 || exchangeEnabled) (index, _navItems[index]),
    ];
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: SizedBox(
        height: 76,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final itemWidth = constraints.maxWidth / entries.length;
            final pillWidth = itemWidth - 10;

            return Stack(
              children: [
                AnimatedPositioned(
                  duration: const Duration(milliseconds: 260),
                  curve: Curves.easeOutCubic,
                  left:
                      entries.indexWhere((entry) => entry.$1 == selectedIndex) *
                              itemWidth +
                          5,
                  top: 8,
                  width: pillWidth,
                  height: 60,
                  child: const _LiquidGlassPill(),
                ),
                Row(
                  children: List.generate(entries.length, (position) {
                    final index = entries[position].$1;
                    final item = entries[position].$2;
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
    AppColors.watch(context);
    final radius = BorderRadius.circular(AppRadius.full);
    final isDark = AppColors.isDark;

    if (isDark) {
      return DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: radius,
          color: const Color(0xFF191C24),
          border: Border.all(color: const Color(0xFF2A2E38)),
        ),
      );
    }

    // Derive the "glass" tint from the active theme so the pill reads as frosted
    // light glass in day mode and a softly lit surface in dark mode.
    final Color glassHi = isDark
        ? Colors.white.withValues(alpha: 0.16)
        : Colors.white.withValues(alpha: 0.92);
    final Color glassMid = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white.withValues(alpha: 0.26);
    final Color glassLo = isDark
        ? AppColors.primary.withValues(alpha: 0.22)
        : Colors.white.withValues(alpha: 0.56);
    final Color rim = isDark
        ? Colors.white.withValues(alpha: 0.22)
        : Colors.white.withValues(alpha: 0.86);
    final Color topSheen = isDark
        ? Colors.white.withValues(alpha: 0.5)
        : Colors.white.withValues(alpha: 0.96);

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: radius,
            color: isDark
                ? AppColors.surfaceVariant.withValues(alpha: 0.55)
                : Colors.white.withValues(alpha: 0.34),
            border: Border.all(color: rim, width: 1.2),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.34 : 0.16),
                blurRadius: 22,
                offset: const Offset(0, 10),
              ),
              BoxShadow(
                color: topSheen.withValues(alpha: isDark ? 0.2 : 0.82),
                blurRadius: 2,
                offset: const Offset(0, -1),
              ),
            ],
            gradient: LinearGradient(
              begin: const Alignment(-0.82, -1),
              end: const Alignment(0.88, 1),
              colors: [glassHi, glassMid, glassLo],
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
                        topSheen.withValues(alpha: 0),
                        topSheen,
                        topSheen.withValues(alpha: 0),
                      ],
                    ),
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
    AppColors.watch(context);
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
