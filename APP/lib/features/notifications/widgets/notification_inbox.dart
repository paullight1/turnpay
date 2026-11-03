import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/tp_empty_state.dart';
import '../../../core/widgets/tp_illustration.dart';
import '../../../core/widgets/tp_page_header.dart';
import '../services/notifications_service.dart';

/// Full-screen customer notification route.
class NotificationInboxScreen extends StatefulWidget {
  final NotificationsService service;
  final Duration pollInterval;

  NotificationInboxScreen({
    super.key,
    NotificationsService? service,
    this.pollInterval = const Duration(seconds: 30),
  }) : service = service ?? NotificationsService();

  @override
  State<NotificationInboxScreen> createState() =>
      _NotificationInboxScreenState();
}

class _NotificationInboxScreenState extends State<NotificationInboxScreen> {
  final _inboxKey = GlobalKey<_NotificationInboxState>();

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: TpAppHeader(
        label: 'Notifications',
        menuActions: [
          TpPageMenuAction(
            label: 'Refresh',
            icon: Icons.refresh_rounded,
            onTap: () => _inboxKey.currentState?.refresh(),
          ),
        ],
      ),
      body: NotificationInbox(
        key: _inboxKey,
        service: widget.service,
        pollInterval: widget.pollInterval,
      ),
    );
  }
}

/// Server-backed, durable customer notification list.
class NotificationInbox extends StatefulWidget {
  final NotificationsService service;
  final Duration pollInterval;

  const NotificationInbox({
    super.key,
    required this.service,
    this.pollInterval = const Duration(seconds: 30),
  });

  @override
  State<NotificationInbox> createState() => _NotificationInboxState();
}

class _NotificationInboxState extends State<NotificationInbox>
    with WidgetsBindingObserver, RouteAware {
  List<TrustPayNotification>? _notifications;
  final Set<String> _markingRead = <String>{};
  final Map<String, String> _readErrors = <String, String>{};
  Timer? _pollTimer;
  Object? _loadError;
  String? _syncError;
  bool _requestInFlight = false;
  bool _refreshing = false;
  bool _foreground = true;
  bool _routeVisible = true;
  ModalRoute<dynamic>? _subscribedRoute;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load(explicit: false);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) {
      _pollTimer?.cancel();
      _pollTimer = null;
      if (_notificationPollingEnabled) _load(explicit: false);
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route == _subscribedRoute) return;
    if (_subscribedRoute != null) appRouteObserver.unsubscribe(this);
    if (route != null) appRouteObserver.subscribe(this, route);
    _subscribedRoute = route;
  }

  @override
  void didPush() {
    _routeVisible = true;
    _schedulePoll();
  }

  @override
  void didPopNext() {
    _routeVisible = true;
    if (_notificationPollingEnabled) _load(explicit: false);
  }

  @override
  void didPushNext() {
    _routeVisible = false;
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  @override
  void didPop() {
    _routeVisible = false;
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  @override
  void dispose() {
    if (_subscribedRoute != null) {
      appRouteObserver.unsubscribe(this);
      _subscribedRoute = null;
    }
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load({required bool explicit}) async {
    if (_requestInFlight || !mounted) return;

    final isInitial = _notifications == null;
    _requestInFlight = true;
    if (mounted) {
      setState(() {
        if (isInitial) _loadError = null;
        if (explicit && !isInitial) _refreshing = true;
      });
    }

    try {
      final notifications = await widget.service.fetchNotifications();
      if (!mounted) return;
      setState(() {
        _notifications = notifications;
        _loadError = null;
        _syncError = null;
        _refreshing = false;
        // A server refresh can replace an item with its persisted read state.
        // Clear any stale local error once the server confirms that read, as
        // well as errors for IDs no longer in the response.
        final notificationIds =
            notifications.map((notification) => notification.id).toSet();
        final readIds = notifications
            .where((notification) => notification.isRead)
            .map((notification) => notification.id)
            .toSet();
        _readErrors.removeWhere(
          (id, _) => !notificationIds.contains(id) || readIds.contains(id),
        );
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (isInitial) {
          _loadError = error;
        } else {
          // Keep durable cards on screen during a transient poll outage. No
          // toast is emitted, so refresh does not produce duplicate alerts.
          _syncError =
              'Updates are unavailable. Pull to refresh and try again.';
        }
        _refreshing = false;
      });
    } finally {
      _requestInFlight = false;
      if (mounted) _schedulePoll();
    }
  }

  void _schedulePoll() {
    _pollTimer?.cancel();
    if (!_notificationPollingEnabled || widget.pollInterval <= Duration.zero) {
      return;
    }
    _pollTimer = Timer(widget.pollInterval, () {
      _pollTimer = null;
      _load(explicit: false);
    });
  }

  bool get _notificationPollingEnabled =>
      mounted && _foreground && _routeVisible;

  Future<void> _refresh() => _load(explicit: true);

  Future<void> refresh() => _refresh();

  Future<bool> _markRead(TrustPayNotification notification) async {
    final current = _notifications;
    TrustPayNotification? currentNotification;
    if (current != null) {
      for (final item in current) {
        if (item.id == notification.id) {
          currentNotification = item;
          break;
        }
      }
    }
    if (currentNotification?.isRead ?? notification.isRead) return true;
    if (_markingRead.contains(notification.id)) return false;

    setState(() {
      _markingRead.add(notification.id);
      _readErrors.remove(notification.id);
    });

    try {
      final record = await widget.service.markRead(notification.id);
      if (!mounted) return false;
      setState(() {
        final current = _notifications;
        if (current == null) return;
        final index = current.indexWhere((item) => item.id == notification.id);
        if (index == -1) return;
        final updated = [...current];
        updated[index] = current[index].copyWith(readAt: record.readAt);
        _notifications = updated;
      });
      return true;
    } catch (_) {
      if (!mounted) return false;
      setState(() {
        // Keep the item and its unread state. A failed read must be retryable
        // and must not be treated as a local dismissal.
        _readErrors[notification.id] =
            'Could not save this as read. Try again.';
      });
      return false;
    } finally {
      if (mounted) {
        setState(() => _markingRead.remove(notification.id));
      }
    }
  }

  Future<void> _open(TrustPayNotification notification) async {
    final read = await _markRead(notification);
    if (!read || !mounted) return;
    context.push(notificationRouteFor(notification));
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: _refresh,
      child: _buildList(context),
    );
  }

  Widget _buildList(BuildContext context) {
    final notifications = _notifications;
    if (notifications == null) {
      if (_loadError != null) {
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.58,
              child: _InboxErrorState(onRetry: _refresh),
            ),
          ],
        );
      }
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        children: const [
          SizedBox(
            height: 280,
            child: Center(child: CircularProgressIndicator()),
          ),
        ],
      );
    }

    if (notifications.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.lg,
          AppSpacing.lg,
          AppSpacing.xxl,
        ),
        children: [
          if (_refreshing)
            const Padding(
              padding: EdgeInsets.only(bottom: AppSpacing.sm),
              child: LinearProgressIndicator(minHeight: 2),
            ),
          if (_syncError != null) ...[
            _SyncErrorBanner(message: _syncError!),
            const SizedBox(height: AppSpacing.sm),
          ],
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.62,
            child: const TpEmptyState(
              variant: TpIllustrationVariant.emptyNotifications,
              title: 'No notifications',
              message:
                  'Account and payment updates will appear here when they are ready.',
              illustrationSize: 190,
            ),
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xxl,
      ),
      children: [
        if (_refreshing)
          const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.sm),
            child: LinearProgressIndicator(minHeight: 2),
          ),
        if (_syncError != null) ...[
          _SyncErrorBanner(message: _syncError!),
          const SizedBox(height: AppSpacing.sm),
        ],
        Text(
          'Payment confirmations and payout updates.',
          style: AppTextStyles.bodyM,
        ),
        const SizedBox(height: AppSpacing.md),
        for (final notification in notifications)
          _NotificationCard(
            notification: notification,
            isMarkingRead: _markingRead.contains(notification.id),
            readError: _readErrors[notification.id],
            onOpen: () => _open(notification),
            onMarkRead: () => _markRead(notification),
          ),
      ],
    );
  }
}

class _NotificationCard extends StatelessWidget {
  final TrustPayNotification notification;
  final bool isMarkingRead;
  final String? readError;
  final VoidCallback onOpen;
  final VoidCallback onMarkRead;

  const _NotificationCard({
    required this.notification,
    required this.isMarkingRead,
    required this.readError,
    required this.onOpen,
    required this.onMarkRead,
  });

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final tone = _notificationTone(notification);
    final date = DateFormat('dd MMM yyyy, HH:mm')
        .format(notification.createdAt.toLocal());
    final detail = notification.isExchangeUpdate && notification.orderId != null
        ? 'Tap to view your exchange'
        : 'Account update';

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Semantics(
        container: true,
        label:
            '${notification.title}, ${notification.isRead ? 'read' : 'unread'}',
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: InkWell(
            onTap: isMarkingRead ? null : onOpen,
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: notification.isRead
                    ? AppColors.surface
                    : AppColors.primary.withValues(alpha: 0.055),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                  color: notification.isRead
                      ? AppColors.border
                      : AppColors.primary.withValues(alpha: 0.28),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: tone.background,
                          shape: BoxShape.circle,
                        ),
                        child:
                            Icon(tone.icon, color: tone.foreground, size: 22),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                if (!notification.isRead) ...[
                                  Container(
                                    width: 7,
                                    height: 7,
                                    margin: const EdgeInsets.only(right: 6),
                                    decoration: BoxDecoration(
                                      color: AppColors.primary,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                ],
                                Expanded(
                                  child: Text(
                                    notification.title,
                                    style: AppTextStyles.labelM.copyWith(
                                      fontWeight: notification.isRead
                                          ? FontWeight.w600
                                          : FontWeight.w900,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(detail, style: AppTextStyles.bodyS),
                            const SizedBox(height: 2),
                            Text(date, style: AppTextStyles.caption),
                          ],
                        ),
                      ),
                      if (!notification.isRead)
                        IconButton(
                          tooltip: 'Mark as read',
                          onPressed: isMarkingRead ? null : onMarkRead,
                          icon: isMarkingRead
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  Icons.mark_email_read_outlined,
                                  color: AppColors.primary,
                                ),
                        ),
                    ],
                  ),
                  if (readError != null) ...[
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            readError!,
                            style: AppTextStyles.bodyS.copyWith(
                              color: AppColors.error,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: isMarkingRead ? null : onMarkRead,
                          child: const Text('Try again'),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _InboxErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _InboxErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_off_rounded, color: AppColors.warning, size: 44),
          const SizedBox(height: AppSpacing.md),
          Text('Could not load notifications', style: AppTextStyles.headingM),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Check your connection and try again.',
            style: AppTextStyles.bodyM,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

class _SyncErrorBanner extends StatelessWidget {
  final String message;

  const _SyncErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(Icons.sync_problem_rounded, color: AppColors.warning, size: 19),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(message, style: AppTextStyles.bodyS)),
        ],
      ),
    );
  }
}

class _NotificationTone {
  final IconData icon;
  final Color foreground;
  final Color background;

  const _NotificationTone({
    required this.icon,
    required this.foreground,
    required this.background,
  });
}

_NotificationTone _notificationTone(TrustPayNotification notification) {
  final key = notification.eventKey.toUpperCase();
  if (key.contains('COMPLET') ||
      key.contains('SENT') ||
      key.contains('SUCCESS')) {
    return _NotificationTone(
      icon: Icons.check_circle_outline_rounded,
      foreground: AppColors.success,
      background: AppColors.success.withValues(alpha: 0.12),
    );
  }
  if (key.contains('FAIL') ||
      key.contains('REJECT') ||
      key.contains('REVERSE')) {
    return _NotificationTone(
      icon: Icons.error_outline_rounded,
      foreground: AppColors.error,
      background: AppColors.error.withValues(alpha: 0.12),
    );
  }
  return _NotificationTone(
    icon: Icons.currency_exchange_rounded,
    foreground: AppColors.warning,
    background: AppColors.warning.withValues(alpha: 0.12),
  );
}

/// Builds only routes that the customer app owns. IDs are encoded by
/// [AppRoutes.exchangeOrderFor] and additionally restricted to a path-safe
/// character set; malformed or generic activity falls back to Exchange.
String notificationRouteFor(TrustPayNotification notification) {
  if (_hasSafeEventId(notification.eventKey, 'kyc:bvn-verified')) {
    return AppRoutes.kyc;
  }
  if (_hasSafeEventId(notification.eventKey, 'banking:account-ready')) {
    return AppRoutes.receiveMoney;
  }

  final orderId = notification.orderId;
  if (notification.isExchangeUpdate &&
      orderId != null &&
      RegExp(r'^[A-Za-z0-9_-]{1,128}$').hasMatch(orderId)) {
    return AppRoutes.exchangeOrderFor(orderId);
  }
  return AppRoutes.exchange;
}

bool _hasSafeEventId(String eventKey, String prefix) {
  final value = eventKey.trim();
  final normalizedPrefix = prefix.toUpperCase();
  final normalizedValue = value.toUpperCase();
  final marker = '$normalizedPrefix:';
  if (!normalizedValue.startsWith(marker)) return false;
  final id = value.substring(marker.length);
  return RegExp(r'^[A-Za-z0-9_-]{1,128}$').hasMatch(id);
}
