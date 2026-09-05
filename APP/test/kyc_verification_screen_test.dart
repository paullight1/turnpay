import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/kyc_verification_screen.dart';
import 'package:trustpay_app/services/kyc_service.dart';

void main() {
  testWidgets('pending review refreshes to approval without resubmission',
      (tester) async {
    final service = _FakeKycService();
    service.overview = const KycOverview(
      status: 'VERIFIED',
      tier: 'TIER_2',
      provider: 'Ninja',
      reference: 'review-result',
      failureReason: '',
      verificationUri: null,
      updatedAt: null,
      documents: [],
    );
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
      service: service,
      initialOverview: const KycOverview(
        status: 'SUBMITTED',
        tier: 'TIER_0',
        provider: 'Ninja',
        reference: 'review-result',
        failureReason: '',
        verificationUri: null,
        updatedAt: null,
        documents: [],
      ),
    )));
    await tester.pump();
    expect(find.text('Waiting for approval'), findsOneWidget);
    expect(find.text('Continue'), findsNothing);
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(service.fetchCount, 1);
    expect(find.text('Identity verification complete'), findsOneWidget,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((text) => text.data)
            .join(' | '));
    expect(find.text('Waiting for approval'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
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

  testWidgets('shows a focused form without redundant context', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: KycVerificationScreen(initialOverview: _pendingOverview),
      ),
    );
    await tester.pump();

    expect(find.text('KYC verification'), findsOneWidget);
    expect(
      find.text(
          'Verify your identity in a few short steps. No document upload is required.'),
      findsOneWidget,
    );
    expect(find.text('Country'), findsNothing);
    expect(find.text('Current access'), findsNothing);
    expect(find.text('Nigeria'), findsNothing);
    expect(find.text('Ghana'), findsNothing);
    expect(find.textContaining('Tier 1'), findsOneWidget);
    expect(find.text('NIN'), findsNothing);
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsNothing);
    await tester.enterText(find.byType(TextField).at(0), 'Ada');
    await tester.enterText(find.byType(TextField).at(1), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsOneWidget);
    expect(find.text('Date of birth'), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('kyc-identity-number')),
      '11111111111',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Date of birth'), findsOneWidget);
    expect(
        find.byKey(const ValueKey('kyc-date-of-birth-picker')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
    await tester.pumpAndSettle();
    expect(find.byType(CupertinoDatePicker), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.textContaining('shared securely with Ninja'), findsOneWidget);
    expect(
      find.text('I agree to share my identity details securely with Ninja.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('kyc-consent')), findsOneWidget);
    expect(find.text('View verification history'), findsNothing);
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

    await tester.enterText(find.byType(TextField).at(0), 'Ada');
    await tester.enterText(find.byType(TextField).at(1), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('kyc-identity-number')),
      '77777777777',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    tester.testTextInput.hide();
    await tester.pump();
    await tester.tap(find.byType(Checkbox));
    await tester.scrollUntilVisible(
      find.text('Verify NIN'),
      160,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Verify NIN'));
    await tester.pumpAndSettle();

    expect(service.submittedIdNumber, '77777777777');
    expect(service.submittedDateOfBirth, '1990-01-01');
    expect(service.submittedCountry, 'NG');
    expect(service.submittedType, 'NIN');
    expect(service.submittedConsent, isTrue);
    expect(find.text('Identity verified successfully.'), findsOneWidget);
  });

  for (final state in <String, String>{
    'REVIEW_REQUIRED': 'Waiting for approval',
    'REJECTED': 'Identity check not approved',
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
      expect(find.text('Confirm your legal name'),
          state.key == 'REVIEW_REQUIRED' ? findsNothing : findsOneWidget);
      expect(find.text('Continue'),
          state.key == 'REVIEW_REQUIRED' ? findsNothing : findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
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
  int fetchCount = 0;
  KycOverview overview = _pendingOverview;
  String? submittedIdNumber;
  String? submittedDateOfBirth;
  String? submittedCountry;
  String? submittedType;
  bool? submittedConsent;

  @override
  Future<KycOverview> fetchOverview() async {
    fetchCount++;
    return overview;
  }

  @override
  Future<KycVerificationResult> verifyIdentity({
    required String idempotencyKey,
    required String idNumber,
    required String dateOfBirth,
    required bool consentAccepted,
    String? firstName,
    String? lastName,
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
