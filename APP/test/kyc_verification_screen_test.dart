import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/kyc_verification_screen.dart';
import 'package:trustpay_app/services/kyc_service.dart';

void main() {
  test('Ninja result reads the safe backend response', () {
    final result = KycVerificationResult.fromJson({
      'provider': 'NINJA',
      'verificationStatus': 'VERIFIED',
      'reference': 'ninja-verification-1',
    });

    expect(result.provider, 'Ninja');
    expect(result.status, 'VERIFIED');
    expect(result.reference, 'ninja-verification-1');
  });

  testWidgets('shows a focused Nigeria-only form and useful empty state',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: KycVerificationScreen(initialOverview: _pendingOverview),
      ),
    );
    await tester.pump();

    expect(find.text('KYC verification'), findsOneWidget);
    expect(find.textContaining('Nigerian identity details'), findsOneWidget);
    expect(find.text('Nigeria'), findsOneWidget);
    expect(find.text('Ghana'), findsNothing);
    expect(find.text('BVN'), findsOneWidget);
    expect(find.text('NIN'), findsOneWidget);
    expect(find.text('Date of birth'), findsOneWidget);
    expect(find.textContaining('shared securely with Ninja'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('No identity checks yet.'),
      320,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('No identity checks yet.'), findsOneWidget);
    expect(find.text('Choose BVN or NIN above to begin.'), findsOneWidget);
  });

  testWidgets('submits the identifier and exact date of birth', (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(
      MaterialApp(
        home: KycVerificationScreen(
          service: service,
          initialOverview: _pendingOverview,
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(
      find.byKey(const ValueKey('kyc-identity-number')),
      '77777777777',
    );
    await tester.enterText(
      find.byKey(const ValueKey('kyc-date-of-birth')),
      '1975-01-01',
    );
    tester.testTextInput.hide();
    await tester.pump();
    await tester.scrollUntilVisible(
      find.byType(Checkbox),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Checkbox));
    await tester.scrollUntilVisible(
      find.text('Verify BVN'),
      160,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Verify BVN'));
    await tester.pumpAndSettle();

    expect(service.submittedIdNumber, '77777777777');
    expect(service.submittedDateOfBirth, '1975-01-01');
    expect(service.submittedCountry, 'NG');
    expect(service.submittedType, 'BVN');
    expect(service.submittedConsent, isTrue);
    expect(find.text('Identity verified successfully.'), findsOneWidget);
  });

  for (final state in <String, String>{
    'REVIEW_REQUIRED': 'Your identity check needs a manual review.',
    'REJECTED': 'We could not match those identity details.',
    'FAILED': 'The identity service could not complete your check.',
  }.entries) {
    testWidgets('shows recovery guidance for ${state.key}', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: KycVerificationScreen(
            initialOverview: KycOverview(
              status: state.key,
              tier: 'TIER_0',
              provider: 'Ninja',
              reference: 'ninja-state',
              failureReason: '',
              verificationUri: null,
              updatedAt: null,
              documents: const [],
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text(state.value), findsOneWidget);
      expect(find.text('Verify BVN'), findsOneWidget);
    });
  }

  testWidgets('shows a quiet completion state and hides the form at Tier 2',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: KycVerificationScreen(
          initialOverview: KycOverview(
            status: 'VERIFIED',
            tier: 'TIER_2',
            provider: 'Ninja',
            reference: 'ninja-complete',
            failureReason: '',
            verificationUri: null,
            updatedAt: null,
            documents: [
              KycDocumentSummary(
                type: 'BVN',
                status: 'VERIFIED',
                updatedAt: null,
              ),
              KycDocumentSummary(
                type: 'NIN',
                status: 'VERIFIED',
                updatedAt: null,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Identity verification complete'), findsOneWidget);
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsNothing);
  });
}

const _pendingOverview = KycOverview(
  status: 'PENDING',
  tier: 'TIER_0',
  provider: 'Ninja',
  reference: '',
  failureReason: '',
  verificationUri: null,
  updatedAt: null,
  documents: [],
);

class _FakeKycService extends KycService {
  String? submittedIdNumber;
  String? submittedDateOfBirth;
  String? submittedCountry;
  String? submittedType;
  bool? submittedConsent;

  @override
  Future<KycOverview> fetchOverview() async => _pendingOverview;

  @override
  Future<KycVerificationResult> verifyIdentity({
    required String idempotencyKey,
    required String idNumber,
    required String dateOfBirth,
    required bool consentAccepted,
    String country = 'NG',
    String type = 'BVN',
  }) async {
    submittedIdNumber = idNumber;
    submittedDateOfBirth = dateOfBirth;
    submittedCountry = country;
    submittedType = type;
    submittedConsent = consentAccepted;
    return const KycVerificationResult(
      status: 'VERIFIED',
      provider: 'Ninja',
      reference: 'ninja-verification-1',
    );
  }
}
