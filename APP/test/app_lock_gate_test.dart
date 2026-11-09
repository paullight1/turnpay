import 'dart:async';
import 'dart:ui' show SemanticsAction, SemanticsActionEvent;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:trustpay_app/core/auth/auth_state.dart';
import 'package:trustpay_app/core/widgets/app_lock_gate.dart';
import 'package:trustpay_app/services/auth_service.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    authStateNotifier.reset();
  });

  testWidgets('app lock gate requires a PIN to unlock the app', (tester) async {
    final semantics = tester.ensureSemantics();
    // The lock overlay is a full-height portrait screen; the default 800x600
    // test surface clips the PIN keypad off-screen. Use a phone-sized surface
    // so the digit keys are hittable.
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: AppLockGate(
            securityService: securityService,
            child: const Scaffold(
              body: Center(child: Text('Protected content')),
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.bySemanticsLabel('Protected content'), findsNothing);
    expect(find.text('Enter your app-unlock PIN to continue.'), findsOneWidget);

    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }

    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsNothing);
    expect(find.text('Enter your app-unlock PIN to continue.'), findsNothing);
    expect(find.bySemanticsLabel('Protected content'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets(
      'phone-security-only lock stays closed after cancelled OS authentication',
      (tester) async {
    _usePhoneSurface(tester);
    setMockSecureStorage(refreshToken: 'refresh-token');
    final service = _FakeAppLockSecurityService(
        config: const TransactionSecurityConfig(
            hasPin: false,
            pinLength: 4,
            biometricEnabled: true,
            canUseBiometrics: true,
            hasBiometric: false,
            biometricLabel: 'Phone security'),
        approvedPin: '2468',
        biometricResult: false);
    await tester.pumpWidget(ProviderScope(
        child: MaterialApp(
            home: AppLockGate(
                securityService: service,
                child: const Scaffold(body: Text('Protected content'))))));
    await tester.pumpAndSettle();
    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('1'), findsNothing);
    await tester.tap(find.text('Use phone security'));
    await tester.pumpAndSettle();
    expect(service.biometricCalls, 1);
    expect(find.text('Unlock TrustPay'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('app lock remains usable on a short screen at large text',
      (tester) async {
    tester.view.physicalSize = const Size(360, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    setMockSecureStorage(refreshToken: 'refresh-token');
    final service = _FakeAppLockSecurityService(
        config: const TransactionSecurityConfig(
            hasPin: true,
            pinLength: 6,
            biometricEnabled: false,
            canUseBiometrics: false,
            hasBiometric: false,
            biometricLabel: 'Phone security'),
        approvedPin: '864208');
    await tester.pumpWidget(ProviderScope(
        child: MaterialApp(
            home: MediaQuery(
                data: const MediaQueryData(
                    size: Size(360, 600), textScaler: TextScaler.linear(2)),
                child: AppLockGate(
                    securityService: service,
                    child: const Scaffold(body: Text('Protected')))))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Use account password'));
    expect(find.text('Use account password'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
      'first app PIN activates inactivity locking without a lifecycle change',
      (tester) async {
    _usePhoneSurface(tester);
    setMockSecureStorage(refreshToken: 'refresh-token');
    var config = const TransactionSecurityConfig(
        hasPin: false,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Phone security');
    final service = _FakeAppLockSecurityService(
        config: config, approvedPin: '2468', configLoader: () async => config);
    var now = DateTime.utc(2026, 11, 3, 12);
    await tester.pumpWidget(ProviderScope(
        child: MaterialApp(
            home: AppLockGate(
                securityService: service,
                clock: () => now,
                inactivityTimeout: const Duration(minutes: 1),
                child: const Scaffold(body: Text('Protected content'))))));
    await tester.pumpAndSettle();
    expect(find.text('Unlock TrustPay'), findsNothing);
    config = const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Phone security');
    TransactionSecurityService.changes.value++;
    await tester.pumpAndSettle();
    now = now.add(const Duration(minutes: 2));
    await tester.pump(const Duration(minutes: 1));
    await tester.pumpAndSettle();
    expect(find.text('Unlock TrustPay'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
      'PIN approval started before background cannot unlock a newer resume lock',
      (tester) async {
    _usePhoneSurface(tester);
    setMockSecureStorage(refreshToken: 'refresh-token');
    final proof = Completer<PinVerificationResult>();
    final service = _HeldPinService(proof);
    await tester.pumpWidget(ProviderScope(
        child: MaterialApp(
            home: AppLockGate(
                securityService: service,
                child: const Scaffold(body: Text('Protected content'))))));
    await tester.pumpAndSettle();
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    proof.complete(const PinVerificationResult.approved());
    await tester.pumpAndSettle();
    expect(find.text('Unlock TrustPay'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('app lock gate stays open when no pin is saved', (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: false,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: AppLockGate(
            securityService: securityService,
            child: const Scaffold(
              body: Center(child: Text('Protected content')),
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsNothing);
    expect(find.text('Enter your app-unlock PIN to continue.'), findsNothing);
    expect(find.text('Protected content'), findsOneWidget);
  });

  testWidgets('offers phone security only after the existing app PIN succeeds',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: true,
        hasBiometric: false,
        biometricLabel: 'Phone security',
      ),
      approvedPin: '2468',
      biometricResult: true,
    );

    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          navigatorKey: navigatorKey,
          builder: (context, child) => AppLockGate(
            navigatorKey: navigatorKey,
            securityService: securityService,
            child: child!,
          ),
          home: const Scaffold(
            body: Center(child: Text('Protected content')),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('Unlock with phone security'), findsNothing);
    for (final digit in ['1', '3', '5', '7']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.text('Incorrect PIN. Try again.'), findsOneWidget);
    expect(find.text('Unlock with phone security'), findsNothing);
    expect(securityService.biometricCalls, 0);

    await _enterPin(tester);
    expect(find.text('Unlock with phone security'), findsOneWidget);
    await tester.tap(find.text('Set up'));
    await tester.pumpAndSettle();

    expect(securityService.biometricPromptSeen, isTrue);
    expect(securityService.biometricCalls, 1);
    expect(find.text('Unlock TrustPay'), findsNothing);
    expect(find.text('Protected content'), findsOneWidget);
  });

  testWidgets(
      'skipping phone security keeps the PIN unlock and saves the choice',
      (tester) async {
    _usePhoneSurface(tester);
    setMockSecureStorage(refreshToken: 'refresh-token');
    final service = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: true,
        hasBiometric: true,
        biometricLabel: 'Fingerprint',
      ),
      approvedPin: '2468',
    );
    await _pumpGate(tester, service);
    await _enterPin(tester);
    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();
    expect(service.biometricPromptSeen, isTrue);
    expect(service.biometricCalls, 0);
    expect(find.text('Unlock TrustPay'), findsNothing);
    expect(find.text('Protected content'), findsOneWidget);
  });

  testWidgets('keeps the first frame opaque until the lock state is known',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final configCompleter = Completer<TransactionSecurityConfig>();
    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
      configLoader: () => configCompleter.future,
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: AppLockGate(
            securityService: securityService,
            child: const Scaffold(
              body: Center(child: Text('Protected content')),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
        find.byKey(const ValueKey('app-lock-readiness-cover')), findsOneWidget);
    expect(find.text('Unlock TrustPay'), findsNothing);

    configCompleter.complete(securityService.config);
    await tester.pumpAndSettle();

    expect(
        find.byKey(const ValueKey('app-lock-readiness-cover')), findsNothing);
    expect(find.text('Unlock TrustPay'), findsOneWidget);
  });

  testWidgets('locks synchronously before checking state after resume',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
    );

    await _pumpGate(tester, securityService);
    await _enterPin(tester);
    expect(find.text('Unlock TrustPay'), findsNothing);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(
        find.byKey(const ValueKey('app-lock-readiness-cover')), findsOneWidget);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    // The gate must remain covered immediately after the lifecycle callback;
    // the asynchronous storage check is allowed to complete afterwards.
    expect(
        find.byKey(const ValueKey('app-lock-readiness-cover')), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('Unlock TrustPay'), findsOneWidget);
  });

  testWidgets('expires after fifteen minutes of foreground inactivity',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    var now = DateTime.utc(2026, 9, 5, 12);
    final activitySignal = AppLockActivitySignal();
    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
    );

    await _pumpGate(
      tester,
      securityService,
      activitySignal: activitySignal,
      clock: () => now,
    );
    await _enterPin(tester);
    expect(find.text('Unlock TrustPay'), findsNothing);

    now = now.add(const Duration(minutes: 14));
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    now = now.add(const Duration(minutes: 14));
    tester.binding.platformDispatcher.onSemanticsActionEvent!(
      SemanticsActionEvent(
          type: SemanticsAction.tap, viewId: tester.view.viewId, nodeId: 0),
    );
    await tester.pump();
    expect(find.text('Unlock TrustPay'), findsNothing);
    now = now.add(const Duration(minutes: 15, seconds: 1));
    activitySignal.markActivity();
    await tester.pump();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('Enter your app-unlock PIN to continue.'), findsOneWidget);
  });

  testWidgets('keeps the lock closed when PIN verification throws',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
      throwOnPinVerification: true,
    );

    await _pumpGate(tester, securityService);
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('Unable to verify your PIN. Try again or log out.'),
        findsOneWidget);
  });

  testWidgets('keeps the lock closed when biometric authentication fails',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: true,
        canUseBiometrics: true,
        hasBiometric: true,
        biometricLabel: 'Fingerprint',
      ),
      approvedPin: '2468',
      biometricResult: false,
    );

    await _pumpGate(tester, securityService);
    await tester.tap(find.byIcon(Icons.fingerprint_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('Biometric check was not completed.'), findsOneWidget);
  });

  testWidgets('does not relock while a biometric prompt is in progress',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final biometricCompleter = Completer<bool>();
    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: true,
        canUseBiometrics: true,
        hasBiometric: true,
        biometricLabel: 'Fingerprint',
      ),
      approvedPin: '2468',
      biometricLoader: () => biometricCompleter.future,
    );

    await _pumpGate(tester, securityService);
    await tester.tap(find.byIcon(Icons.fingerprint_rounded));
    await tester.pump();

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();

    biometricCompleter.complete(true);
    await tester.pumpAndSettle();

    expect(securityService.biometricCalls, 1);
    expect(find.text('Unlock TrustPay'), findsNothing);
    expect(find.text('Protected content'), findsOneWidget);
  });

  testWidgets('keeps a cancelled biometric prompt recoverable after resume',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final biometricCompleter = Completer<bool>();
    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: true,
        canUseBiometrics: true,
        hasBiometric: true,
        biometricLabel: 'Fingerprint',
      ),
      approvedPin: '2468',
      biometricLoader: () => biometricCompleter.future,
    );

    await _pumpGate(tester, securityService);
    await tester.tap(find.byIcon(Icons.fingerprint_rounded));
    await tester.pump();

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();

    biometricCompleter.complete(false);
    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('Biometric check was not completed.'), findsOneWidget);
    expect(find.text('Log out'), findsOneWidget);
  });

  testWidgets('keeps logout usable when secure cleanup fails', (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
    );

    await _pumpGate(
      tester,
      securityService,
      authService: _ThrowingLogoutAuthService(),
    );
    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();

    expect(find.text('Unlock TrustPay'), findsOneWidget);
    expect(find.text('Could not log out securely. Try again.'), findsOneWidget);
    expect(find.text('Log out'), findsOneWidget);
  });

  testWidgets('releases the lock after the server revokes the session',
      (tester) async {
    _usePhoneSurface(tester);
    FlutterSecureStorage.setMockInitialValues({});
    setMockSecureStorage(refreshToken: 'refresh-token');

    final securityService = _FakeAppLockSecurityService(
      config: const TransactionSecurityConfig(
        hasPin: true,
        pinLength: 4,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric app unlock',
      ),
      approvedPin: '2468',
    );

    await _pumpGate(tester, securityService);
    expect(find.text('Unlock TrustPay'), findsOneWidget);

    authStateNotifier.markExpired();
    await tester.pump();

    expect(find.text('Unlock TrustPay'), findsNothing);
    expect(find.text('Protected content'), findsOneWidget);
  });
}

Future<void> _pumpGate(
  WidgetTester tester,
  _FakeAppLockSecurityService securityService, {
  AppLockActivitySignal? activitySignal,
  AppLockClock? clock,
  AuthService? authService,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: AppLockGate(
          securityService: securityService,
          activitySignal: activitySignal,
          clock: clock,
          authService: authService,
          child: const Scaffold(
            body: Center(child: Text('Protected content')),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _enterPin(WidgetTester tester) async {
  for (final digit in ['2', '4', '6', '8']) {
    await tester.tap(find.text(digit));
    await tester.pump();
  }
  await tester.pumpAndSettle();
}

void _usePhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

class _FakeAppLockSecurityService extends TransactionSecurityService {
  final TransactionSecurityConfig config;
  final String approvedPin;
  final bool biometricResult;
  final Future<TransactionSecurityConfig> Function()? configLoader;
  final Future<bool> Function()? biometricLoader;
  final bool throwOnPinVerification;
  bool biometricPromptSeen = false;
  int biometricCalls = 0;

  _FakeAppLockSecurityService({
    required this.config,
    required this.approvedPin,
    this.biometricResult = false,
    this.configLoader,
    this.biometricLoader,
    this.throwOnPinVerification = false,
  });

  @override
  Future<TransactionSecurityConfig> getConfig() async =>
      configLoader == null ? config : await configLoader!();

  @override
  Future<PinVerificationResult> verifyPinWithLockout(String pin) async {
    if (throwOnPinVerification) {
      throw StateError('secure storage unavailable');
    }

    if (pin == approvedPin) {
      return const PinVerificationResult.approved();
    }

    return const PinVerificationResult.rejected(
      failedAttempts: 1,
    );
  }

  @override
  Future<bool> authenticateBiometric({
    required String reason,
  }) async {
    biometricCalls += 1;
    return biometricLoader == null ? biometricResult : await biometricLoader!();
  }

  @override
  Future<bool> hasSeenBiometricPrompt() async => biometricPromptSeen;

  @override
  Future<void> markBiometricPromptSeen() async {
    biometricPromptSeen = true;
  }
}

class _ThrowingLogoutAuthService extends AuthService {
  @override
  Future<void> logout() async {
    throw StateError('secure storage unavailable');
  }
}

class _HeldPinService extends _FakeAppLockSecurityService {
  final Completer<PinVerificationResult> proof;
  _HeldPinService(this.proof)
      : super(
            config: const TransactionSecurityConfig(
                hasPin: true,
                pinLength: 4,
                biometricEnabled: false,
                canUseBiometrics: false,
                hasBiometric: false,
                biometricLabel: 'Phone security'),
            approvedPin: '2468');
  @override
  Future<PinVerificationResult> verifyPinWithLockout(String pin) =>
      proof.future;
}
