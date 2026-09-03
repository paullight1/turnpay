import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/widgets/micro_interactions.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../services/wallet_service.dart';

// ─── SPEND CATEGORY MODEL ─────────────────────────────────────────────────────
class SpendCategory {
  final String name;
  final double amount;
  final double percentage;
  final Color color;

  const SpendCategory({
    required this.name,
    required this.amount,
    required this.percentage,
    required this.color,
  });
}

const _weekdayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

String _money(String currency, double amount) {
  return NumberFormat.currency(
    name: currency,
    symbol: '$currency ',
    decimalDigits: 2,
  ).format(amount);
}

String _categoryLabel(String type) {
  switch (type.toUpperCase()) {
    case 'AIRTIME':
    case 'DATA':
    case 'CABLE':
    case 'ELECTRICITY':
      return 'Bills & VTU';
    case 'INTERNAL_TRANSFER':
    case 'TRANSFER':
      return 'Transfers';
    case 'WITHDRAW':
      return 'Withdrawals';
    case 'EXCHANGE':
      return 'Exchange';
    default:
      return 'Other';
  }
}

Color _categoryColor(String label) {
  switch (label) {
    case 'Bills & VTU':
      return AppColors.warning;
    case 'Transfers':
      return AppColors.primary;
    case 'Withdrawals':
      return AppColors.error;
    case 'Exchange':
      return AppColors.success;
    default:
      return AppColors.primaryLight;
  }
}

// ─── SPEND ANALYTICS ──────────────────────────────────────────────────────────
/// Analytics derived client-side from the transactions API.
///
/// Only settled (SUCCESS) transactions count. FUND is the single credit type
/// and everything else is treated as an outflow, mirroring how the rest of the
/// app classifies transactions. Amounts are grouped by currency and the screen
/// reports the currency with the most settled activity this month; spend in
/// other currencies is surfaced separately instead of being mixed in.
class SpendAnalytics {
  final String currency;
  final double monthSpend;
  final double monthIncome;
  final List<SpendCategory> categories;
  final List<double> weeklySpend;
  final List<double> weeklyIncome;
  final List<String> weekLabels;
  final Map<String, double> otherCurrencySpend;

  const SpendAnalytics({
    required this.currency,
    required this.monthSpend,
    required this.monthIncome,
    required this.categories,
    required this.weeklySpend,
    required this.weeklyIncome,
    required this.weekLabels,
    required this.otherCurrencySpend,
  });

  bool get hasSpend => categories.isNotEmpty;

  factory SpendAnalytics.fromTransactions(
    List<TransactionSummary> transactions, {
    DateTime? now,
  }) {
    final reference = (now ?? DateTime.now()).toLocal();
    final today = DateTime(reference.year, reference.month, reference.day);
    final monthStart = DateTime(reference.year, reference.month, 1);

    bool isCredit(TransactionSummary tx) => tx.type.toUpperCase() == 'FUND';

    final settled = transactions
        .where((tx) =>
            tx.status.toUpperCase() == 'SUCCESS' && tx.createdAt != null)
        .toList();

    bool inMonth(TransactionSummary tx) {
      return !tx.createdAt!.toLocal().isBefore(monthStart);
    }

    final monthOutflows =
        settled.where((tx) => !isCredit(tx) && inMonth(tx)).toList();
    final monthInflows =
        settled.where((tx) => isCredit(tx) && inMonth(tx)).toList();

    // The currency the user actually transacted in the most this month —
    // spending takes priority over income when picking it.
    final currency = monthOutflows.isNotEmpty
        ? _dominantCurrency(monthOutflows)
        : _dominantCurrency(monthInflows);

    final totalsByCategory = <String, double>{};
    for (final tx in monthOutflows) {
      if (tx.currency.toUpperCase() != currency) continue;
      final label = _categoryLabel(tx.type);
      totalsByCategory[label] = (totalsByCategory[label] ?? 0) + tx.amount;
    }

    final monthSpend =
        totalsByCategory.values.fold<double>(0, (sum, value) => sum + value);

    final categories = totalsByCategory.entries.map((entry) {
      return SpendCategory(
        name: entry.key,
        amount: entry.value,
        percentage: monthSpend <= 0 ? 0 : (entry.value / monthSpend) * 100,
        color: _categoryColor(entry.key),
      );
    }).toList()
      ..sort((a, b) => b.amount.compareTo(a.amount));

    var monthIncome = 0.0;
    for (final tx in monthInflows) {
      if (tx.currency.toUpperCase() == currency) monthIncome += tx.amount;
    }

    final otherCurrencySpend = <String, double>{};
    for (final tx in monthOutflows) {
      final txCurrency = tx.currency.toUpperCase();
      if (txCurrency == currency) continue;
      otherCurrencySpend[txCurrency] =
          (otherCurrencySpend[txCurrency] ?? 0) + tx.amount;
    }

    // Last 7 calendar days, ending today.
    final windowDays = List<DateTime>.generate(
      7,
      (i) => DateTime(today.year, today.month, today.day - (6 - i)),
    );
    final weekLabels =
        windowDays.map((day) => _weekdayLetters[day.weekday - 1]).toList();
    final weeklySpend = List<double>.filled(7, 0);
    final weeklyIncome = List<double>.filled(7, 0);

    for (final tx in settled) {
      if (tx.currency.toUpperCase() != currency) continue;
      final at = tx.createdAt!.toLocal();
      final index = windowDays.indexWhere(
        (day) =>
            day.year == at.year && day.month == at.month && day.day == at.day,
      );
      if (index == -1) continue;
      if (isCredit(tx)) {
        weeklyIncome[index] += tx.amount;
      } else {
        weeklySpend[index] += tx.amount;
      }
    }

    return SpendAnalytics(
      currency: currency,
      monthSpend: monthSpend,
      monthIncome: monthIncome,
      categories: categories,
      weeklySpend: weeklySpend,
      weeklyIncome: weeklyIncome,
      weekLabels: weekLabels,
      otherCurrencySpend: otherCurrencySpend,
    );
  }

  static String _dominantCurrency(List<TransactionSummary> transactions) {
    final counts = <String, int>{};
    final totals = <String, double>{};
    for (final tx in transactions) {
      final currency = tx.currency.toUpperCase();
      counts[currency] = (counts[currency] ?? 0) + 1;
      totals[currency] = (totals[currency] ?? 0) + tx.amount;
    }

    var best = '';
    for (final currency in counts.keys) {
      if (best.isEmpty) {
        best = currency;
        continue;
      }
      final byCount = counts[currency]!.compareTo(counts[best]!);
      if (byCount > 0 || (byCount == 0 && totals[currency]! > totals[best]!)) {
        best = currency;
      }
    }
    return best;
  }
}

// ─── ANALYTICS SCREEN ─────────────────────────────────────────────────────────
/// Matches the reference analytics screen:
/// - "History" header with back arrow and dots menu
/// - Income / Outcome pill toggle
/// - White summary card with bar chart
/// - Donut chart with center percentage
/// - Color legend
/// - Spend breakdown list
class AnalyticsScreen extends StatefulWidget {
  final WalletService walletService;
  final DateTime Function() clock;

  AnalyticsScreen({
    super.key,
    WalletService? walletService,
    DateTime Function()? clock,
  })  : walletService = walletService ?? WalletService(),
        clock = clock ?? DateTime.now;

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen>
    with SingleTickerProviderStateMixin {
  int _tabIndex = 0; // 0 = Income, 1 = Outcome
  late AnimationController _donutController;
  late Animation<double> _donutAnimation;
  late Future<SpendAnalytics> _analyticsFuture;

  @override
  void initState() {
    super.initState();
    _donutController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    _donutAnimation = CurvedAnimation(
      parent: _donutController,
      curve: Curves.easeOutCubic,
    );
    _loadAnalytics();
  }

  void _loadAnalytics() {
    final future = widget.walletService.fetchTransactions(limit: 100).then(
          (response) => SpendAnalytics.fromTransactions(
            response.transactions,
            now: widget.clock(),
          ),
        );
    _analyticsFuture = future;
    future.then<void>((_) {
      if (!mounted) return;
      _donutController
        ..reset()
        ..forward();
    }).catchError((Object _) {});
  }

  void _refresh() {
    setState(_loadAnalytics);
  }

  @override
  void dispose() {
    _donutController.dispose();
    super.dispose();
  }

  void _switchTab(int i) {
    setState(() => _tabIndex = i);
    _donutController
      ..reset()
      ..forward();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // ── Header ──
            _AnalyticsHeader(),
            const SizedBox(height: AppSpacing.md),

            Expanded(
              child: FutureBuilder<SpendAnalytics>(
                future: _analyticsFuture,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const _AnalyticsLoadingState();
                  }

                  if (snapshot.hasError || !snapshot.hasData) {
                    return _AnalyticsErrorState(onRetry: _refresh);
                  }

                  final analytics = snapshot.data!;

                  return RefreshIndicator(
                    color: AppColors.primary,
                    backgroundColor: AppColors.surface,
                    onRefresh: () async => _refresh(),
                    child: SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(
                        parent: BouncingScrollPhysics(),
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // ── Income / Outcome Toggle ──
                          _TabToggle(
                            selected: _tabIndex,
                            onSelect: _switchTab,
                          ),

                          const SizedBox(height: AppSpacing.lg),

                          // ── Summary Card with Bar Chart ──
                          _SummaryCard(
                            tabIndex: _tabIndex,
                            analytics: analytics,
                          ),

                          const SizedBox(height: AppSpacing.lg),

                          // ── Donut Chart ──
                          _DonutChartSection(
                            animation: _donutAnimation,
                            categories: analytics.categories,
                          ),

                          const SizedBox(height: AppSpacing.lg),

                          // ── Spend Breakdown ──
                          _SpendBreakdownCard(
                            categories: analytics.categories,
                            currency: analytics.currency,
                          ),

                          const SizedBox(height: AppSpacing.xxl),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
class _AnalyticsHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: () {
              Haptics.selection();
              Navigator.of(context).maybePop();
            },
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.surfaceVariant,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Icon(
                Icons.arrow_back_ios_new_rounded,
                size: 16,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          const Spacer(),
          Text('History', style: AppTextStyles.headingM),
          const Spacer(),
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(
              Icons.more_horiz_rounded,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── LOADING STATE ────────────────────────────────────────────────────────────
class _AnalyticsLoadingState extends StatelessWidget {
  const _AnalyticsLoadingState();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      children: [
        ShimmerBlock(
          width: double.infinity,
          height: 48,
          borderRadius: BorderRadius.circular(AppRadius.full),
        ),
        const SizedBox(height: AppSpacing.lg),
        ShimmerBlock(
          width: double.infinity,
          height: 140,
          borderRadius: BorderRadius.circular(AppRadius.xl),
        ),
        const SizedBox(height: AppSpacing.lg),
        Center(
          child: ShimmerBlock(
            width: 220,
            height: 220,
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        ShimmerBlock(
          width: double.infinity,
          height: 180,
          borderRadius: BorderRadius.circular(AppRadius.xl),
        ),
      ],
    );
  }
}

// ─── ERROR STATE ──────────────────────────────────────────────────────────────
class _AnalyticsErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _AnalyticsErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_rounded,
            color: AppColors.primary,
            size: 48,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Could not load analytics',
            style: AppTextStyles.labelM,
          ),
          const SizedBox(height: AppSpacing.lg),
          FilledButton(
            onPressed: onRetry,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

// ─── TAB TOGGLE ───────────────────────────────────────────────────────────────
class _TabToggle extends StatelessWidget {
  final int selected;
  final ValueChanged<int> onSelect;

  const _TabToggle({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      padding: const EdgeInsets.all(4),
      child: Row(
        children: [
          _ToggleTab(
            label: 'Income',
            isSelected: selected == 0,
            onTap: () => onSelect(0),
          ),
          _ToggleTab(
            label: 'Outcome',
            isSelected: selected == 1,
            onTap: () => onSelect(1),
          ),
        ],
      ),
    );
  }
}

class _ToggleTab extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _ToggleTab({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: () {
          if (!isSelected) Haptics.selection();
          onTap();
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOut,
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.full),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: 0.3),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Center(
            child: Text(
              label,
              style: AppTextStyles.labelM.copyWith(
                color: isSelected ? Colors.white : AppColors.textSecondary,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── SUMMARY CARD WITH BAR CHART ──────────────────────────────────────────────
class _SummaryCard extends StatelessWidget {
  final int tabIndex;
  final SpendAnalytics analytics;

  const _SummaryCard({
    required this.tabIndex,
    required this.analytics,
  });

  @override
  Widget build(BuildContext context) {
    final isIncome = tabIndex == 0;
    final hasCurrency = analytics.currency.isNotEmpty;
    final total = isIncome ? analytics.monthIncome : analytics.monthSpend;
    final amount = hasCurrency ? _money(analytics.currency, total) : '—';

    final otherSpendNote = !isIncome && analytics.otherCurrencySpend.isNotEmpty
        ? 'Also spent: ${analytics.otherCurrencySpend.entries.map((entry) => _money(entry.key, entry.value)).join(' · ')}'
        : null;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border, width: 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Left: Amount ──
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isIncome ? 'My Income' : 'My Spending',
                  style: AppTextStyles.bodyM,
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  amount,
                  style: AppTextStyles.headingXL.copyWith(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSpacing.xs),
                Row(
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      color: AppColors.textSecondary,
                      size: 14,
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        hasCurrency
                            ? 'This month · settled transactions only'
                            : 'Analytics will appear after transactions settle',
                        style: AppTextStyles.bodyS.copyWith(
                          color: AppColors.textSecondary,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                if (otherSpendNote != null) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    otherSpendNote,
                    style: AppTextStyles.bodyS.copyWith(
                      color: AppColors.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(width: AppSpacing.sm),

          // ── Right: Mini bar chart ──
          _MiniBarchart(
            data: isIncome ? analytics.weeklyIncome : analytics.weeklySpend,
            labels: analytics.weekLabels,
            activeIndex: 6, // Today is always the last bar.
          ),
        ],
      ),
    );
  }
}

// ─── MINI BAR CHART ───────────────────────────────────────────────────────────
class _MiniBarchart extends StatelessWidget {
  final List<double> data;
  final List<String> labels;
  final int activeIndex;

  const _MiniBarchart({
    required this.data,
    required this.labels,
    required this.activeIndex,
  });

  @override
  Widget build(BuildContext context) {
    final maxValue =
        data.fold<double>(0, (max, value) => value > max ? value : max);

    return SizedBox(
      width: 108,
      child: Column(
        children: [
          SizedBox(
            height: 60,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(data.length, (i) {
                final isActive = i == activeIndex;
                final scale =
                    maxValue <= 0 ? 0.0 : (data[i] / maxValue).clamp(0.0, 1.0);
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeOutBack,
                  width: 12,
                  height: scale <= 0 ? 3 : 60 * scale,
                  decoration: BoxDecoration(
                    color: isActive
                        ? AppColors.primary
                        : AppColors.primary.withValues(alpha: 0.22),
                    borderRadius: BorderRadius.circular(4),
                  ),
                );
              }),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(labels.length, (i) {
              final isActive = i == activeIndex;
              return Text(
                labels[i],
                style: AppTextStyles.caption.copyWith(
                  color: isActive ? AppColors.primary : AppColors.textHint,
                  fontWeight: isActive ? FontWeight.w700 : FontWeight.w400,
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

// ─── DONUT CHART SECTION ──────────────────────────────────────────────────────
class _DonutChartSection extends StatelessWidget {
  final Animation<double> animation;
  final List<SpendCategory> categories;

  const _DonutChartSection({
    required this.animation,
    required this.categories,
  });

  @override
  Widget build(BuildContext context) {
    final hasCategories = categories.isNotEmpty;
    final topCategory = hasCategories ? categories.first : null;

    return Column(
      children: [
        // Donut + center text
        AnimatedBuilder(
          animation: animation,
          builder: (context, child) {
            return SizedBox(
              height: 220,
              child: CustomPaint(
                painter: _DonutPainter(
                  categories: categories,
                  progress: animation.value,
                ),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        topCategory != null
                            ? '${topCategory.percentage.round()}%'
                            : 'No data',
                        style: AppTextStyles.displayMedium.copyWith(
                          fontWeight: FontWeight.w900,
                          fontSize: topCategory != null ? 38 : 28,
                        ),
                      ),
                      Text(
                        topCategory != null
                            ? topCategory.name
                            : 'No spending yet',
                        style: AppTextStyles.bodyM,
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),

        const SizedBox(height: AppSpacing.md),

        // Legend row
        if (hasCategories)
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.xs,
            alignment: WrapAlignment.center,
            children: categories.map((c) {
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: c.color,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(c.name, style: AppTextStyles.bodyS),
                ],
              );
            }).toList(),
          )
        else
          Text(
            'No spending categories yet',
            style: AppTextStyles.bodyS.copyWith(color: AppColors.textSecondary),
          ),
      ],
    );
  }
}

// ─── DONUT CUSTOM PAINTER ─────────────────────────────────────────────────────
class _DonutPainter extends CustomPainter {
  final List<SpendCategory> categories;
  final double progress;

  _DonutPainter({required this.categories, required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width < size.height ? size.width / 2 : size.height / 2;
    const strokeWidth = 28.0;
    final rect = Rect.fromCircle(
      center: center,
      radius: radius - strokeWidth / 2,
    );

    // Background ring first so the category arcs stay visible on top.
    final bgPaint = Paint()
      ..color = AppColors.surfaceVariant
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawCircle(center, radius - strokeWidth / 2, bgPaint);

    double startAngle = -90 * (3.14159 / 180); // Start from top

    for (final cat in categories) {
      final sweepAngle = (cat.percentage / 100) * 2 * 3.14159 * progress;
      final paint = Paint()
        ..color = cat.color
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round;

      canvas.drawArc(rect, startAngle, sweepAngle - 0.06, false, paint);
      startAngle += sweepAngle;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.progress != progress;
}

// ─── SPEND BREAKDOWN CARD ─────────────────────────────────────────────────────
class _SpendBreakdownCard extends StatelessWidget {
  final List<SpendCategory> categories;
  final String currency;

  const _SpendBreakdownCard({
    required this.categories,
    required this.currency,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.border, width: 1),
      ),
      child: Column(
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Spend Breakdown', style: AppTextStyles.headingM),
                Text(
                  'This month',
                  style: AppTextStyles.labelM.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),

          // Divider
          Divider(height: 1, color: AppColors.divider),

          if (categories.isEmpty)
            Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                children: [
                  const TpIllustration(
                    variant: TpIllustrationVariant.emptySearch,
                    size: 128,
                    semanticLabel: 'No spending activity yet',
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Your settled transfers, bills, and exchange activity will appear here.',
                    style: AppTextStyles.bodyM.copyWith(
                      color: AppColors.textSecondary,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            )
          else
            ...categories.asMap().entries.map((entry) {
              final i = entry.key;
              final cat = entry.value;
              return Column(
                children: [
                  _BreakdownRow(category: cat, currency: currency),
                  if (i < categories.length - 1)
                    Divider(
                      height: 1,
                      color: AppColors.divider,
                      indent: AppSpacing.lg,
                      endIndent: AppSpacing.lg,
                    ),
                ],
              );
            }),

          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }
}

class _BreakdownRow extends StatelessWidget {
  final SpendCategory category;
  final String currency;

  const _BreakdownRow({required this.category, required this.currency});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: [
          // Color dot
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: category.color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: AppSpacing.md),

          // Category name
          Expanded(
            child: Text(category.name, style: AppTextStyles.labelM),
          ),

          // Amount
          Text(
            _money(currency, category.amount),
            style: AppTextStyles.labelM.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),

          const SizedBox(width: AppSpacing.md),

          // Percentage badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: category.color,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            child: Text(
              '${category.percentage.round()}%',
              style: AppTextStyles.caption.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 11,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
