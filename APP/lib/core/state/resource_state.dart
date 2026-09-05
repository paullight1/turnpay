/// The states a remote resource can occupy while preserving the difference
/// between no records and a failed refresh.
enum ResourceStatus {
  loading,
  value,
  empty,
  unavailable,
  stale,
  error,
  authRequired,
}

/// Alias useful to callers that prefer the longer name.
typedef ResourceStateStatus = ResourceStatus;
typedef ResourceStateKind = ResourceStatus;

/// Immutable state for API-backed data.
///
/// A list returned successfully with no records is [ResourceState.empty].  A
/// transport failure is [ResourceState.unavailable], while a malformed
/// payload is [ResourceState.error].  [ResourceState.stale] retains the last
/// known value and records why refresh did not complete.  Authentication
/// rejection is represented separately as [ResourceStatus.authRequired] so a
/// caller can route to session handling rather than render an empty state.
class ResourceState<T> {
  const ResourceState._({
    required this.status,
    this.value,
    this.error,
    this.stackTrace,
    this.lastUpdated,
  });

  const ResourceState.loading({
    T? previousValue,
    DateTime? lastUpdated,
  }) : this._(
          status: ResourceStatus.loading,
          value: previousValue,
          lastUpdated: lastUpdated,
        );

  const ResourceState.value(
    T value, {
    DateTime? refreshedAt,
  }) : this._(
          status: ResourceStatus.value,
          value: value,
          lastUpdated: refreshedAt,
        );

  const ResourceState.empty({
    DateTime? refreshedAt,
  }) : this._(
          status: ResourceStatus.empty,
          lastUpdated: refreshedAt,
        );

  const ResourceState.unavailable(
    Object error, {
    T? previousValue,
    DateTime? lastUpdated,
    StackTrace? stackTrace,
  }) : this._(
          status: ResourceStatus.unavailable,
          value: previousValue,
          error: error,
          stackTrace: stackTrace,
          lastUpdated: lastUpdated,
        );

  const ResourceState.stale(
    T value, {
    Object? error,
    DateTime? lastUpdated,
    StackTrace? stackTrace,
  }) : this._(
          status: ResourceStatus.stale,
          value: value,
          error: error,
          stackTrace: stackTrace,
          lastUpdated: lastUpdated,
        );

  const ResourceState.error(
    Object error, {
    T? previousValue,
    DateTime? lastUpdated,
    StackTrace? stackTrace,
  }) : this._(
          status: ResourceStatus.error,
          value: previousValue,
          error: error,
          stackTrace: stackTrace,
          lastUpdated: lastUpdated,
        );

  const ResourceState.authRequired({
    Object? error,
    T? previousValue,
    DateTime? lastUpdated,
    StackTrace? stackTrace,
  }) : this._(
          status: ResourceStatus.authRequired,
          value: previousValue,
          error: error,
          stackTrace: stackTrace,
          lastUpdated: lastUpdated,
        );

  final ResourceStatus status;
  final T? value;
  final Object? error;
  final StackTrace? stackTrace;
  final DateTime? lastUpdated;

  /// Alias for consumers that use `data` terminology.
  T? get data => value;

  /// Alias for callers that record refresh time rather than data time.
  DateTime? get refreshedAt => lastUpdated;
  DateTime? get lastRefreshAt => lastUpdated;

  bool get isLoading => status == ResourceStatus.loading;
  bool get hasValue => value != null;
  bool get isValue => status == ResourceStatus.value;
  bool get isEmpty => status == ResourceStatus.empty;
  bool get isUnavailable => status == ResourceStatus.unavailable;
  bool get isStale => status == ResourceStatus.stale;
  bool get hasError => status == ResourceStatus.error;
  bool get isAuthRequired => status == ResourceStatus.authRequired;

  /// Returns data only when this state contains a value.
  T requireValue() {
    final current = value;
    if (current == null) {
      throw StateError('Resource state $status has no value.');
    }
    return current;
  }

  ResourceState<R> map<R>(R Function(T value) transform) {
    final current = value;
    if (current == null) {
      return ResourceState<R>._(
        status: status,
        error: error,
        stackTrace: stackTrace,
        lastUpdated: lastUpdated,
      );
    }
    return ResourceState<R>._(
      status: status,
      value: transform(current),
      error: error,
      stackTrace: stackTrace,
      lastUpdated: lastUpdated,
    );
  }
}

/// Converts a completed load into the empty/value distinction used by the
/// resource state contract.
ResourceState<T> resourceValueOrEmpty<T>(
  T value, {
  required bool isEmpty,
  DateTime? refreshedAt,
}) {
  return isEmpty
      ? ResourceState<T>.empty(refreshedAt: refreshedAt)
      : ResourceState<T>.value(value, refreshedAt: refreshedAt);
}
