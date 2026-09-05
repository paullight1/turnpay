import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/features/auth/screens/forgot_password_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';

void main() {
  testWidgets('login email is prefilled on the forgot password screen',
      (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    addTearDown(router.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go(AppRoutes.login);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byType(TextFormField).first,
      '  Ada@Example.com  ',
    );
    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();

    expect(router.state.matchedLocation, AppRoutes.forgotPassword);
    final emailField = tester.widget<TextFormField>(
      find.byType(TextFormField).first,
    );
    expect(emailField.controller?.text, 'ada@example.com');

    // Let the splash screen's already-scheduled startup timer complete before
    // the shared router is disposed.
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('password recovery confirmation does not promise email delivery',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ForgotPasswordScreen(
          initialEmail: 'missing@example.com',
          authService: _SuccessfulForgotPasswordService(),
        ),
      ),
    );

    await tester.tap(find.text('Send reset link'));
    await tester.pumpAndSettle();

    expect(find.text('Reset request received'), findsOneWidget);
    expect(
      find.text(
        'If an account exists for that email, a reset link will arrive shortly. Check your inbox and spam folder.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('missing@example.com'), findsNothing);
  });
}

class _SuccessfulForgotPasswordService extends AuthService {
  @override
  Future<void> forgotPassword(String email) async {}
}
