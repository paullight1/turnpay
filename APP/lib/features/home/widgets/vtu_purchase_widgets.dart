import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/vtu_service.dart';
import 'vtu_phone.dart';

class VtuPageHeader extends StatelessWidget {
  const VtuPageHeader(
      {super.key,
      required this.title,
      required this.onBack,
      this.showBackButton = true,
      this.trailing});
  final String title;
  final VoidCallback onBack;
  final bool showBackButton;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(children: [
        if (showBackButton) ...[
          IconButton(
              onPressed: onBack,
              tooltip: 'Back',
              style: IconButton.styleFrom(
                  backgroundColor: AppColors.surface,
                  minimumSize: const Size(48, 48)),
              icon: const Icon(Icons.arrow_back_rounded)),
          const SizedBox(width: 14),
        ],
        Expanded(
            child: Text(title,
                style: AppTextStyles.headingL,
                maxLines: 1,
                overflow: TextOverflow.ellipsis)),
        if (trailing != null) ...[const SizedBox(width: 8), trailing!],
      ]);
}

/// Country availability comes from the service, never from the flag itself.
class VtuCountryMenu {
  const VtuCountryMenu(
      {required this.countries,
      required this.value,
      required this.onChanged,
      this.disabledCountries = const {},
      this.enabled = true});
  final Map<String, String> countries;
  final String? value;
  final ValueChanged<String> onChanged;
  final Set<String> disabledCountries;
  final bool enabled;
}

class VtuCountrySelector extends StatelessWidget {
  const VtuCountrySelector(
      {super.key, required this.menu, this.enabled = true});
  final VtuCountryMenu menu;
  final bool enabled;

  static String flag(String code) {
    if (!RegExp(r'^[A-Z]{2}$').hasMatch(code)) return '🌍';
    return String.fromCharCodes(code.codeUnits.map((unit) => unit + 127397));
  }

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
        tooltip: 'Service country',
        enabled: enabled && menu.enabled && menu.countries.isNotEmpty,
        onSelected: menu.onChanged,
        itemBuilder: (_) => menu.countries.entries
            .map((entry) => PopupMenuItem<String>(
                  value: entry.key,
                  enabled: !menu.disabledCountries.contains(entry.key),
                  child: Row(children: [
                    ExcludeSemantics(
                        child: Text(flag(entry.key),
                            style: const TextStyle(fontSize: 22))),
                    const SizedBox(width: 12),
                    Expanded(
                        child: Text(
                            '${entry.value}${menu.disabledCountries.contains(entry.key) ? ' (coming soon)' : ''}')),
                    if (entry.key == menu.value)
                      const Icon(Icons.check_rounded, size: 20),
                  ]),
                ))
            .toList(),
        child: Semantics(
          label:
              'Service country: ${menu.countries[menu.value] ?? 'Choose country'}',
          button: true,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48, minWidth: 88),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: AppColors.border)),
            child: ExcludeSemantics(
                child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text(flag(menu.value ?? ''),
                  style: const TextStyle(fontSize: 22)),
              const SizedBox(width: 6),
              Text(menu.value ?? 'Country', style: AppTextStyles.labelM),
              const SizedBox(width: 4),
              const Icon(Icons.keyboard_arrow_down_rounded, size: 20),
            ])),
          ),
        ),
      );
}

class VtuProviderLogo extends StatelessWidget {
  const VtuProviderLogo({super.key, required this.id, this.size = 44});
  final String id;
  final double size;

  @override
  Widget build(BuildContext context) {
    final assetId = switch (id) {
      '9mobile' => 'etisalat',
      '9mobile-sme' => 'etisalat',
      'glo-sme' => 'glo',
      'smile' => 'smile-direct',
      'smile-airtime' => 'smile-direct',
      'ikedc' => 'ikeja-electric',
      'ekedc' => 'eko-electric',
      'aedc' => 'abuja-electric',
      'ibedc' => 'ibadan-electric',
      'phed' => 'portharcourt-electric',
      'jed' => 'jos-electric',
      'kedco' => 'kano-electric',
      'kaedco' => 'kaduna-electric',
      'eedc' => 'enugu-electric',
      'bedc' => 'benin-electric',
      'aba' => 'aba-electric',
      'yedc' => 'yola-electric',
      _ => id,
    };
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.asset(
        'assets/images/vtu/$assetId.jpg',
        width: size,
        height: size,
        fit: BoxFit.cover,
        excludeFromSemantics: true,
        errorBuilder: (_, __, ___) => Container(
          width: size,
          height: size,
          color: AppColors.surfaceVariant,
          child: Icon(
              id == 'foreign-airtime'
                  ? Icons.public_rounded
                  : Icons.receipt_long_rounded,
              color: AppColors.textSecondary),
        ),
      ),
    );
  }
}

class VtuNetworkPicker extends StatelessWidget {
  const VtuNetworkPicker(
      {super.key,
      required this.value,
      required this.providers,
      required this.onChanged,
      this.enabled = true});
  final String value;
  final List<VtuProviderOption> providers;
  final ValueChanged<String> onChanged;
  final bool enabled;
  static const _core = [
    'mtn',
    'airtel',
    'glo',
    '9mobile',
    'etisalat',
    'dstv',
    'gotv',
    'startimes'
  ];

  Future<void> _showMore(
      BuildContext context, List<VtuProviderOption> more) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AppColors.surface,
      builder: (context) => SafeArea(
          child: FractionallySizedBox(
        heightFactor: .65,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
              padding: const EdgeInsets.all(20),
              child: Text('More services', style: AppTextStyles.headingL)),
          Expanded(
              child: ListView(children: [
            for (final provider in more)
              ListTile(
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 6),
                leading: VtuProviderLogo(id: provider.id),
                title: Text(provider.name),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => Navigator.pop(context, provider.id),
              ),
          ])),
        ]),
      )),
    );
    if (selected != null) onChanged(selected);
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final core = providers.where((p) => _core.contains(p.id)).toList();
    final more = providers.where((p) => !_core.contains(p.id)).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (core.isNotEmpty)
        LayoutBuilder(builder: (context, constraints) {
          final columns = constraints.maxWidth < 300 ||
                  MediaQuery.textScalerOf(context).scale(14) > 20
              ? 2
              : 4;
          final width = (constraints.maxWidth - (columns - 1) * 8) / columns;
          return Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in core)
              SizedBox(
                  width: width,
                  child: Semantics(
                    selected: value == p.id,
                    child: OutlinedButton(
                      onPressed: enabled ? () => onChanged(p.id) : null,
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            vertical: 12, horizontal: 4),
                        minimumSize: const Size(48, 96),
                        backgroundColor: value == p.id
                            ? AppColors.primary.withValues(alpha: .06)
                            : AppColors.surface,
                        side: BorderSide(
                            color: value == p.id
                                ? AppColors.primary
                                : AppColors.border,
                            width: value == p.id ? 1.6 : 1),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16)),
                      ),
                      child: Semantics(
                          label: '${p.name} network',
                          excludeSemantics: true,
                          child:
                              Column(mainAxisSize: MainAxisSize.min, children: [
                            VtuProviderLogo(id: p.id, size: 40),
                            const SizedBox(height: 8),
                            Text(p.name.replaceAll(' Data', ''),
                                textAlign: TextAlign.center,
                                style: AppTextStyles.labelS
                                    .copyWith(color: AppColors.textPrimary)),
                          ])),
                    ),
                  )),
          ]);
        }),
      if (more.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: TextButton.icon(
            style: TextButton.styleFrom(
                foregroundColor: AppColors.isDark
                    ? AppColors.primaryLight
                    : AppColors.primaryDark),
            onPressed: enabled ? () => _showMore(context, more) : null,
            icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
            label: const Text('More services'),
          ),
        ),
    ]);
  }
}

class VtuPhoneFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    final cleaned = newValue.text.replaceAll(RegExp(r'[^0-9+]'), '');
    final normalized = VtuPhone.normalize(cleaned);
    if (normalized == newValue.text) return newValue;
    return TextEditingValue(
        text: normalized,
        selection: TextSelection.collapsed(offset: normalized.length));
  }
}

class VtuPhoneField extends StatelessWidget {
  const VtuPhoneField(
      {super.key,
      required this.controller,
      this.label = 'Phone number',
      this.enabled = true,
      this.showLabelAbove = false});
  final TextEditingController controller;
  final String label;
  final bool enabled;
  final bool showLabelAbove;

  @override
  Widget build(BuildContext context) {
    final field = TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.phone,
      textInputAction: TextInputAction.done,
      autofillHints: const [AutofillHints.telephoneNumberNational],
      inputFormatters: [
        VtuPhoneFormatter(),
        LengthLimitingTextInputFormatter(15)
      ],
      style: AppTextStyles.headingM.copyWith(letterSpacing: .5),
      decoration: InputDecoration(
        labelText: showLabelAbove ? null : label,
        hintText: '0803 123 4567',
        prefixIcon: Icon(Icons.phone_outlined, color: AppColors.textSecondary),
        helperText: 'Local and +234 numbers accepted',
        helperMaxLines: 2,
        helperStyle: AppTextStyles.bodyS,
        filled: true,
        fillColor: AppColors.surface,
      ),
    );

    if (!showLabelAbove) return field;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.labelM),
        const SizedBox(height: AppSpacing.sm),
        Semantics(
          container: true,
          textField: true,
          label: label,
          child: field,
        ),
      ],
    );
  }
}

class VtuSectionLabel extends StatelessWidget {
  const VtuSectionLabel(this.title, {super.key, this.detail});
  final String title;
  final String? detail;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 24, bottom: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: AppTextStyles.labelL),
          if (detail != null) ...[
            const SizedBox(height: 4),
            Text(detail!, style: AppTextStyles.bodyS)
          ],
        ]),
      );
}

class VtuProgress extends StatelessWidget {
  const VtuProgress({super.key, required this.step, required this.labels});
  final int step;
  final List<String> labels;
  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < labels.length; i++)
            Expanded(
                child: Padding(
              padding: EdgeInsets.only(right: i == labels.length - 1 ? 0 : 10),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                        height: 3,
                        decoration: BoxDecoration(
                            color: i <= step
                                ? AppColors.primary
                                : AppColors.border,
                            borderRadius: BorderRadius.circular(4))),
                    const SizedBox(height: 8),
                    Text('${i + 1}. ${labels[i]}',
                        style: AppTextStyles.labelS.copyWith(
                            color: i == step
                                ? AppColors.textPrimary
                                : AppColors.textSecondary)),
                  ]),
            ))
        ],
      );
}

class VtuPlanPicker extends StatefulWidget {
  const VtuPlanPicker(
      {super.key,
      required this.value,
      required this.packages,
      required this.onChanged,
      this.enabled = true,
      this.variablePriceIds = const {}});
  final String? value;
  final List<VtuPackageOption> packages;
  final ValueChanged<String> onChanged;
  final bool enabled;
  final Set<String> variablePriceIds;
  @override
  State<VtuPlanPicker> createState() => _VtuPlanPickerState();
}

class _VtuPlanPickerState extends State<VtuPlanPicker> {
  String _query = '';
  bool _showAll = false;
  final _search = TextEditingController();
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final filtered = widget.packages
        .where((p) =>
            '${p.name} ${p.validity} ${p.price}'.toLowerCase().contains(_query))
        .toList();
    final visible =
        _showAll || _query.isNotEmpty ? filtered : filtered.take(6).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (widget.packages.length > 6) ...[
        TextField(
            controller: _search,
            enabled: widget.enabled,
            onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
            decoration: InputDecoration(
                labelText: 'Find a plan',
                hintText: 'Search size, validity or price',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear search',
                        icon: const Icon(Icons.close_rounded),
                        onPressed: () {
                          _search.clear();
                          setState(() => _query = '');
                        }))),
        const SizedBox(height: 12),
      ],
      if (filtered.isEmpty)
        Padding(
            padding: const EdgeInsets.all(16),
            child: Text('No matching plans. Try another size or price.',
                style: AppTextStyles.bodyM)),
      for (final plan in visible)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Semantics(
            selected: plan.id == widget.value,
            child: OutlinedButton(
              onPressed:
                  widget.enabled ? () => widget.onChanged(plan.id) : null,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.all(16),
                backgroundColor: plan.id == widget.value
                    ? AppColors.primary.withValues(alpha: .06)
                    : AppColors.surface,
                side: BorderSide(
                    color: plan.id == widget.value
                        ? AppColors.primary
                        : AppColors.border),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
              ),
              child:
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Icon(
                        plan.id == widget.value
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                        size: 20,
                        color: plan.id == widget.value
                            ? AppColors.primary
                            : AppColors.textHint)),
                const SizedBox(width: 12),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(plan.name, style: AppTextStyles.labelM),
                      const SizedBox(height: 6),
                      Wrap(spacing: 12, runSpacing: 4, children: [
                        Text(
                            widget.variablePriceIds.contains(plan.id)
                                ? 'Choose amount'
                                : _price(plan.price),
                            style: AppTextStyles.labelM.copyWith(
                                color: AppColors.isDark
                                    ? AppColors.primaryLight
                                    : AppColors.primaryDark)),
                        if (plan.validity.trim().isNotEmpty)
                          Text(plan.validity, style: AppTextStyles.bodyS),
                      ]),
                    ])),
              ]),
            ),
          ),
        ),
      if (_query.isEmpty && filtered.length > 6)
        TextButton(
            style: TextButton.styleFrom(
                foregroundColor: AppColors.isDark
                    ? AppColors.primaryLight
                    : AppColors.primaryDark),
            onPressed: () => setState(() => _showAll = !_showAll),
            child: Text(_showAll
                ? 'Show fewer plans'
                : 'View all ${filtered.length} plans')),
    ]);
  }

  String _price(String raw) {
    // Formatting only: purchase amounts always use the original server string.
    final parts = raw.split('.');
    final whole = parts.first
        .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
    return '₦$whole${parts.length > 1 && parts[1] != '00' ? '.${parts[1]}' : ''}';
  }
}
