import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_theme.dart';
import '../widgets/home_header.dart';
import '../widgets/wallet_balance_card.dart';
import '../widgets/wallet_cards_row.dart';
import '../widgets/quick_actions_row.dart';
import '../widgets/recent_recipients.dart';
import '../widgets/recent_transactions_list.dart';

/// HOME SCREEN
/// Matches the reference design exactly:
/// - Greeting header with notification bell + badge
/// - Large wallet balance with show/hide toggle
/// - Horizontal scrolling wallet cards (GHS, NGN)
/// - Two quick-action pill buttons: Send | Exchange
/// - 2x2 recipients grid with "See all"
/// - Recent transactions list
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _balanceVisible = true;

  void _toggleBalance() {
    setState(() => _balanceVisible = !_balanceVisible);
    HapticFeedback.lightImpact();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            // ── Header: Greeting + Bell ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: AppSpacing.md,
                ),
                child: HomeHeader(notificationCount: 3),
              ),
            ),

            // ── Wallet Balance ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: WalletBalanceCard(
                  balanceGHS: 17298.92,
                  visible: _balanceVisible,
                  onToggleVisibility: _toggleBalance,
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.lg)),

            // ── Wallet Cards Horizontal Row ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(left: AppSpacing.lg),
                child: WalletCardsRow(),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.lg)),

            // ── Quick Actions: Send | Exchange ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: QuickActionsRow(),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),

            // ── Recent Recipients ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: RecentRecipients(),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.md)),

            // ── Recent Transactions ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: RecentTransactionsList(),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
          ],
        ),
      ),
    );
  }
}
