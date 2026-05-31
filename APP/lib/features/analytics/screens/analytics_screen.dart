import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

// â”€â”€â”€ SPEND CATEGORY MODEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

final _spendCategories = [
  SpendCategory(
    name: 'Transfers',
    amount: 2800.00,
    percentage: 43,
    color: Color(0xFF7C3AED),
  ),
  SpendCategory(
    name: 'VTU / Bills',
    amount: 960.50,
    percentage: 15,
    color: Color(0xFFF59E0B),
  ),
  SpendCategory(
    name: 'Exchange',
    amount: 1960.50,
    percentage: 30,
    color: Color(0xFF2563EB),
  ),
  SpendCategory(
    name: 'Other',
    amount: 780.00,
    percentage: 12,
    color: Color(0xFF059669),
  ),
];

final _weeklyData = [0.4, 0.6, 0.35, 1.0, 0.7, 0.5, 0.65]; // Normalized heights
final _weekLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// â”€â”€â”€ ANALYTICS SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/// Matches the reference analytics screen:
/// - "History" header with back arrow and dots menu
/// - Income / Outcome pill toggle
/// - White summary card with bar chart
/// - Donut chart with center percentage
/// - Color legend
/// - Spend breakdown list
class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen>
    with SingleTickerProviderStateMixin {
  int _tabIndex = 0; // 0 = Income, 1 = Outcome
  late AnimationController _donutController;
  late Animation<double> _donutAnimation;

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
    _donutController.forward();
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
            // â”€â”€ Header â”€â”€
            _AnalyticsHeader(),
            SizedBox(height: AppSpacing.md),

            Expanded(
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // â”€â”€ Income / Outcome Toggle â”€â”€
                    _TabToggle(
                      selected: _tabIndex,
                      onSelect: _switchTab,
                    ),

                    SizedBox(height: AppSpacing.lg),

                    // â”€â”€ Summary Card with Bar Chart â”€â”€
                    _SummaryCard(
                      tabIndex: _tabIndex,
                      weeklyData: _weeklyData,
                      weekLabels: _weekLabels,
                    ),

                    SizedBox(height: AppSpacing.lg),

                    // â”€â”€ Donut Chart â”€â”€
                    _DonutChartSection(
                      animation: _donutAnimation,
                      categories: _spendCategories,
                    ),

                    SizedBox(height: AppSpacing.lg),

                    // â”€â”€ Spend Breakdown â”€â”€
                    _SpendBreakdownCard(categories: _spendCategories),

                    SizedBox(height: AppSpacing.xxl),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// â”€â”€â”€ HEADER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            onTap: () => Navigator.of(context).maybePop(),
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

// â”€â”€â”€ TAB TOGGLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOut,
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.full),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: AppColors.primary.withOpacity(0.3),
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

// â”€â”€â”€ SUMMARY CARD WITH BAR CHART â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _SummaryCard extends StatelessWidget {
  final int tabIndex;
  final List<double> weeklyData;
  final List<String> weekLabels;

  const _SummaryCard({
    required this.tabIndex,
    required this.weeklyData,
    required this.weekLabels,
  });

  @override
  Widget build(BuildContext context) {
    final amount = tabIndex == 0 ? 'GHâ‚µ 6,542.18' : 'GHâ‚µ 4,501.00';
    final change =
        tabIndex == 0 ? '+4.9% From last week' : '-2.1% From last week';
    final isPositive = tabIndex == 0;

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
          // â”€â”€ Left: Amount â”€â”€
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  tabIndex == 0 ? 'My Income' : 'My Spending',
                  style: AppTextStyles.bodyM,
                ),
                SizedBox(height: AppSpacing.xs),
                Text(
                  amount,
                  style: AppTextStyles.headingXL.copyWith(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                SizedBox(height: AppSpacing.xs),
                Row(
                  children: [
                    Icon(
                      isPositive
                          ? Icons.arrow_upward_rounded
                          : Icons.arrow_downward_rounded,
                      color: isPositive ? AppColors.success : AppColors.error,
                      size: 14,
                    ),
                    SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        change,
                        style: AppTextStyles.bodyS.copyWith(
                          color:
                              isPositive ? AppColors.success : AppColors.error,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          SizedBox(width: AppSpacing.sm),

          // â”€â”€ Right: Mini bar chart â”€â”€
          _MiniBarchart(
            data: weeklyData,
            labels: weekLabels,
            activeIndex: 3, // Wednesday is always the current highlight
          ),
        ],
      ),
    );
  }
}

// â”€â”€â”€ MINI BAR CHART â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeOutBack,
                  width: 12,
                  height: 60 * data[i],
                  decoration: BoxDecoration(
                    color: isActive
                        ? AppColors.primary
                        : AppColors.primary.withOpacity(0.22),
                    borderRadius: BorderRadius.circular(4),
                  ),
                );
              }),
            ),
          ),
          SizedBox(height: 6),
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

// â”€â”€â”€ DONUT CHART SECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _DonutChartSection extends StatelessWidget {
  final Animation<double> animation;
  final List<SpendCategory> categories;

  const _DonutChartSection({
    required this.animation,
    required this.categories,
  });

  @override
  Widget build(BuildContext context) {
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
                        '73%',
                        style: AppTextStyles.displayMedium.copyWith(
                          fontWeight: FontWeight.w900,
                          fontSize: 38,
                        ),
                      ),
                      Text(
                        'Total Spend',
                        style: AppTextStyles.bodyM,
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),

        SizedBox(height: AppSpacing.md),

        // Legend row
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
                SizedBox(width: 6),
                Text(c.name, style: AppTextStyles.bodyS),
              ],
            );
          }).toList(),
        ),
      ],
    );
  }
}

// â”€â”€â”€ DONUT CUSTOM PAINTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Background ring
    final bgPaint = Paint()
      ..color = AppColors.surfaceVariant
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawCircle(center, radius - strokeWidth / 2, bgPaint);
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.progress != progress;
}

// â”€â”€â”€ SPEND BREAKDOWN CARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class _SpendBreakdownCard extends StatelessWidget {
  final List<SpendCategory> categories;

  const _SpendBreakdownCard({required this.categories});

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
                GestureDetector(
                  onTap: () {},
                  child: Text(
                    'See all',
                    style: AppTextStyles.labelM.copyWith(
                      color: AppColors.primary,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Divider
          Divider(height: 1, color: AppColors.divider),

          // Rows
          ...categories.asMap().entries.map((entry) {
            final i = entry.key;
            final cat = entry.value;
            return Column(
              children: [
                _BreakdownRow(category: cat),
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

          SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }
}

class _BreakdownRow extends StatelessWidget {
  final SpendCategory category;
  const _BreakdownRow({required this.category});

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
          SizedBox(width: AppSpacing.md),

          // Category name
          Expanded(
            child: Text(category.name, style: AppTextStyles.labelM),
          ),

          // Amount
          Text(
            'GHâ‚µ ${category.amount.toStringAsFixed(2)}',
            style: AppTextStyles.labelM.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),

          SizedBox(width: AppSpacing.md),

          // Percentage badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: category.color,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            child: Text(
              '${category.percentage.toInt()}%',
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
