import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';

import 'package:trustpay_app/features/auth/screens/register_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  Future<void> pumpRegisterScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: RegisterScreen(),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapContinue(WidgetTester tester) async {
    final button = find.text('Continue');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  Future<void> advanceToPhoneStep(WidgetTester tester) async {
    await tester.enterText(find.byType(TextFormField), 'John Mensah');
    await tapContinue(tester);
    await tester.enterText(find.byType(TextFormField), 'john@example.com');
    await tapContinue(tester);
  }

  testWidgets('shows only the current registration question', (tester) async {
    await pumpRegisterScreen(tester);

    expect(find.text('Step 1 of 8'), findsOneWidget);
    expect(find.text('Full name'), findsOneWidget);
    expect(find.byType(TextFormField), findsOneWidget);
    expect(find.text('Email address'), findsNothing);
    expect(find.text('Phone number'), findsNothing);
  });

  testWidgets('keeps the user on a question until its answer is valid',
      (tester) async {
    await pumpRegisterScreen(tester);

    await tapContinue(tester);

    expect(find.text('Enter your full name'), findsOneWidget);
    expect(find.text('Step 1 of 8'), findsOneWidget);
    expect(find.text('Email address'), findsNothing);
  });

  testWidgets('back navigation preserves the previous answer', (tester) async {
    await pumpRegisterScreen(tester);

    await tester.enterText(find.byType(TextFormField), 'John Mensah');
    await tapContinue(tester);
    expect(find.text('Step 2 of 8'), findsOneWidget);
    expect(find.text('Email address'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back_ios_new_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Step 1 of 8'), findsOneWidget);
    expect(find.byType(TextFormField), findsOneWidget);
    final fullNameField = tester.widget<TextFormField>(
      find.byType(TextFormField),
    );
    expect(fullNameField.controller?.text, 'John Mensah');
  });

  testWidgets('asks each remaining question before final consent',
      (tester) async {
    await pumpRegisterScreen(tester);

    const answers = <String>[
      'John Mensah',
      'john@example.com',
      '+2348000000000',
      'Password1',
      'Password1',
      '1234',
    ];
    const expectedLabels = <String>[
      'Email address',
      'Phone number',
      'Password',
      'Confirm password',
      'Transaction PIN (4 digits)',
      'Referral code (optional)',
    ];

    for (var index = 0; index < answers.length; index += 1) {
      await tester.enterText(find.byType(TextFormField), answers[index]);
      await tapContinue(tester);

      expect(find.text('Step ${index + 2} of 8'), findsOneWidget);
      expect(find.text(expectedLabels[index]), findsOneWidget);
      expect(find.byType(TextFormField), findsOneWidget);
    }

    await tester.ensureVisible(find.text('Skip for now'));
    await tester.tap(find.text('Skip for now'));
    await tester.pumpAndSettle();

    expect(find.text('Step 8 of 8'), findsOneWidget);
    expect(find.textContaining('I agree to the'), findsOneWidget);
    expect(find.byType(Checkbox), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    expect(find.text('Create account'), findsOneWidget);
  });

  testWidgets('phone step lets the user choose Nigeria or Ghana',
      (tester) async {
    await pumpRegisterScreen(tester);
    await advanceToPhoneStep(tester);

    expect(find.text('🇳🇬'), findsOneWidget);
    expect(find.text('+234'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('phone-country-selector')));
    await tester.pumpAndSettle();

    expect(find.text('Choose your country'), findsOneWidget);
    expect(find.text('Nigeria'), findsOneWidget);
    expect(find.text('Ghana'), findsOneWidget);

    await tester.tap(find.text('Ghana'));
    await tester.pumpAndSettle();

    expect(find.text('🇬🇭'), findsOneWidget);
    expect(find.text('+233'), findsOneWidget);
  });

  testWidgets('country selector exposes an accessible tap action',
      (tester) async {
    final semantics = tester.ensureSemantics();

    await pumpRegisterScreen(tester);
    await advanceToPhoneStep(tester);

    expect(
      tester.getSemantics(
        find.bySemanticsLabel(
          'Select country code. Current Nigeria +234',
        ),
      ),
      matchesSemantics(
        label: 'Select country code. Current Nigeria +234',
        isButton: true,
        hasTapAction: true,
      ),
    );
    semantics.dispose();
  });

  testWidgets('phone step normalizes a local number before verification',
      (tester) async {
    await pumpRegisterScreen(tester);
    await advanceToPhoneStep(tester);

    await tester.enterText(find.byType(TextFormField), '08012345678');
    await tester.pump();

    expect(find.text('Number to verify: +2348012345678'), findsOneWidget);

    await tapContinue(tester);

    expect(find.text('Step 4 of 8'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
  });

  testWidgets('Ghana selection normalizes a Ghana local number',
      (tester) async {
    await pumpRegisterScreen(tester);
    await advanceToPhoneStep(tester);

    await tester.tap(find.byKey(const ValueKey('phone-country-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ghana'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '0241234567');
    await tester.pump();

    expect(find.text('Number to verify: +233241234567'), findsOneWidget);

    await tapContinue(tester);
    expect(find.text('Step 4 of 8'), findsOneWidget);
  });

  testWidgets('country-specific validation rejects a mismatched number',
      (tester) async {
    await pumpRegisterScreen(tester);
    await advanceToPhoneStep(tester);

    await tester.tap(find.byKey(const ValueKey('phone-country-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ghana'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '08012345678');
    await tapContinue(tester);

    expect(find.text('Enter a valid Ghana phone number'), findsOneWidget);
    expect(find.text('Step 3 of 8'), findsOneWidget);
  });

  testWidgets('country-specific validation rejects unsupported mobile prefixes',
      (tester) async {
    await pumpRegisterScreen(tester);
    await advanceToPhoneStep(tester);

    await tester.enterText(find.byType(TextFormField), '01234567890');
    await tapContinue(tester);

    expect(find.text('Enter a valid Nigeria phone number'), findsOneWidget);
    expect(find.text('Step 3 of 8'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('phone-country-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ghana'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '0123456789');
    await tapContinue(tester);

    expect(find.text('Enter a valid Ghana phone number'), findsOneWidget);
    expect(find.text('Step 3 of 8'), findsOneWidget);
  });

  testWidgets('registration receives the normalized E.164 phone number',
      (tester) async {
    final authService = _RecordingAuthService();
    final router = GoRouter(
      initialLocation: '/register',
      routes: [
        GoRoute(
          path: '/register',
          builder: (context, state) => RegisterScreen(
            authService: authService,
            securityService: _FakeTransactionSecurityService(),
          ),
        ),
        GoRoute(
          path: '/home',
          builder: (context, state) => const Scaffold(
            body: Text('Home'),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();

    const answers = <String>[
      'John Mensah',
      'john@example.com',
      '08012345678',
      'Password1',
      'Password1',
      '1234',
    ];
    for (final answer in answers) {
      await tester.enterText(find.byType(TextFormField), answer);
      await tapContinue(tester);
    }

    await tester.tap(find.text('Skip for now'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();

    expect(authService.registeredPhone, '+2348012345678');
    expect(find.text('Home'), findsOneWidget);
  });

  testWidgets(
      'an existing account message is shown before redirecting to login',
      (tester) async {
    final router = GoRouter(
      initialLocation: '/register',
      routes: [
        GoRoute(
          path: '/register',
          builder: (context, state) => RegisterScreen(
            authService: _ConflictAuthService(),
            securityService: _FakeTransactionSecurityService(),
          ),
        ),
        GoRoute(
          path: '/login',
          builder: (context, state) => const Scaffold(
            body: Text('Login destination'),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();

    const answers = <String>[
      'John Mensah',
      'john@example.com',
      '08012345678',
      'Password1',
      'Password1',
      '1234',
    ];
    for (final answer in answers) {
      await tester.enterText(find.byType(TextFormField), answer);
      await tapContinue(tester);
    }

    await tester.tap(find.text('Skip for now'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Checkbox));
    await tester.tap(find.text('Create account'));
    await tester.pump();

    expect(
      find.text(
        'An account already exists with these details. Taking you to log in…',
      ),
      findsOneWidget,
    );

    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.text('Login destination'), findsOneWidget);
  });
}

class _RecordingAuthService extends AuthService {
  String? registeredPhone;

  @override
  Future<bool> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    required String transactionPin,
    String? referralCode,
  }) async {
    registeredPhone = phone;
    return true;
  }
}

class _ConflictAuthService extends AuthService {
  @override
  Future<bool> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    required String transactionPin,
    String? referralCode,
  }) async {
    final request = RequestOptions(path: '/api/auth/register');
    throw DioException(
      requestOptions: request,
      response: Response<dynamic>(
        requestOptions: request,
        statusCode: 409,
      ),
    );
  }
}

class _FakeTransactionSecurityService extends TransactionSecurityService {
  @override
  Future<void> savePin(String pin, {required int pinLength}) async {}

  @override
  Future<TransactionSecurityConfig> getConfig() async {
    return const TransactionSecurityConfig(
      hasPin: true,
      pinLength: 4,
      biometricEnabled: false,
      canUseBiometrics: false,
      hasBiometric: false,
      biometricLabel: 'Biometric approval',
    );
  }
}
