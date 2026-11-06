import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_theme.dart';
import '../services/manual_exchange_service.dart';

class ReviewReminderButton extends StatefulWidget {
  final ManualExchangeOrder order;
  final ManualExchangeService service;
  const ReviewReminderButton(
      {super.key, required this.order, required this.service});
  @override
  State<ReviewReminderButton> createState() => _ReviewReminderButtonState();
}

class _ReviewReminderButtonState extends State<ReviewReminderButton> {
  bool _busy = false, _unavailable = false;
  DateTime? _nextAllowedAt;
  String? _message;
  Timer? _cooldownTimer;
  @override
  void initState() {
    super.initState();
    _nextAllowedAt = widget.order.reviewReminderNextAllowedAt;
    _scheduleCooldown();
  }

  @override
  void didUpdateWidget(covariant ReviewReminderButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    final serverNext = widget.order.reviewReminderNextAllowedAt;
    if (serverNext != null &&
        (_nextAllowedAt == null || serverNext.isAfter(_nextAllowedAt!))) {
      _nextAllowedAt = serverNext;
      _scheduleCooldown();
    }
  }

  void _scheduleCooldown() {
    _cooldownTimer?.cancel();
    final delay = _nextAllowedAt?.difference(DateTime.now().toUtc());
    if (delay != null && delay > Duration.zero) {
      _cooldownTimer = Timer(delay, () {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    super.dispose();
  }

  bool get _coolingDown =>
      _nextAllowedAt?.isAfter(DateTime.now().toUtc()) == true;
  Future<void> _request() async {
    if (_busy || _coolingDown || _unavailable) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final result =
          await widget.service.requestReviewReminder(widget.order.id);
      if (!mounted) return;
      setState(() {
        _nextAllowedAt = result.nextAllowedAt;
        _message = 'Reminder sent. Your payment status is unchanged.';
      });
      _scheduleCooldown();
    } catch (error) {
      if (!mounted) return;
      final next = ManualExchangeReminder.cooldownFromError(error);
      setState(() {
        if (error is DioException &&
            error.response?.statusCode == 429 &&
            next != null) {
          _nextAllowedAt = next;
          _message =
              'A review alert was sent recently. Please wait before reminding again.';
        } else if (error is DioException && error.response?.statusCode == 404) {
          _unavailable = true;
          _message =
              'Review reminders are not available yet. Refresh the exchange status or contact support.';
        } else {
          _message =
              'We could not confirm this reminder. Retry when connected; your payment will not be repeated.';
        }
      });
      _scheduleCooldown();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    if (!widget.order.canRequestReviewReminder) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 12),
      OutlinedButton.icon(
          onPressed: _busy || _coolingDown || _unavailable ? null : _request,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.notifications_active_outlined, size: 20),
          label: Text(_busy
              ? 'Sending reminder…'
              : _coolingDown
                  ? 'Reminder recently sent'
                  : 'Remind admin')),
      if (_message != null) ...[
        const SizedBox(height: 8),
        Text(_message!, style: AppTextStyles.bodyS)
      ],
      if (_coolingDown) ...[
        const SizedBox(height: 6),
        Text(
            'Available again at ${DateFormat('HH:mm').format(_nextAllowedAt!.toLocal())}. You can start another exchange while this one is reviewed.',
            style: AppTextStyles.bodyS)
      ],
    ]);
  }
}
