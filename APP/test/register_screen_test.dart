import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/auth/screens/register_screen.dart';

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
}
