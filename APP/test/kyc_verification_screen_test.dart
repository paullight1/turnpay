import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/kyc_verification_screen.dart';
import 'package:trustpay_app/services/kyc_service.dart';

void main() {
  testWidgets('KYC verification screen paints first frame', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: KycVerificationScreen(
          initialOverview: KycOverview(
            status: 'PENDING',
            tier: 'TIER_0',
            provider: 'Smile ID',
            reference: '',
            failureReason: '',
            verificationUri: null,
            updatedAt: null,
            documents: [],
          ),
        ),
      ),
    );

    await tester.pump();

    expect(find.text('KYC verification'), findsOneWidget);
    expect(find.textContaining('Verify once with Smile ID'), findsOneWidget);
  });
}
