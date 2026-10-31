import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/features/auth/screens/otp_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';

class _EmailAuth extends AuthService {
  String? verifiedEmail;
  String? verifiedCode;
  @override
  Future<void> verifyOtp({required String email, required String otp}) async {
    verifiedEmail = email;
    verifiedCode = otp;
  }
}

void main() {
  testWidgets(
      'email code screen explains expiry and verifies email before returning to sign in',
      (tester) async {
    final auth = _EmailAuth();
    final router = GoRouter(initialLocation: '/otp', routes: [
      GoRoute(
          path: '/otp',
          builder: (_, __) => OtpScreen(
              email: 'ada@example.com', purpose: 'verify', authService: auth)),
      GoRoute(
          path: '/login',
          builder: (_, state) => const Scaffold(body: Text('Sign in again'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('5 minutes'), findsOneWidget);
    expect(find.textContaining('a•••@example.com'), findsOneWidget);
    expect(find.text('Check your\nemail.'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '123456');
    await tester.pump();
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();
    expect(auth.verifiedEmail, 'ada@example.com');
    expect(auth.verifiedCode, '123456');
    expect(find.text('Sign in again'), findsOneWidget);
  });
}
