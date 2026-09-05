import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

import '../test/support/trustpay_test_api.dart';

void main() => registerInternalTransferFlowTests();

void registerInternalTransferFlowTests({bool useIntegrationBinding = true}) {
  if (useIntegrationBinding) {
    IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  } else {
    TestWidgetsFlutterBinding.ensureInitialized();
  }

  Future<void> useProductionPhoneViewport(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
  }

  Future<void> enterTransfer(
    WidgetTester tester, {
    required String amount,
  }) async {
    Finder field(String label) => find.byWidgetPredicate(
          (widget) =>
              widget is TextField && widget.decoration?.labelText == label,
        );
    await tester.enterText(field('Amount'), amount);
    await tester.enterText(field('Recipient email'), 'tolu@example.com');
    await tester.enterText(field('Note optional'), 'Integration certification');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(find.text('Tolu A. • t***@example.com'), findsOneWidget);
  }

  Future<void> waitForText(
    WidgetTester tester,
    String text, {
    bool settle = true,
  }) async {
    final finder = find.text(text);
    for (var attempt = 0; attempt < 40; attempt++) {
      await tester.pump(const Duration(milliseconds: 50));
      if (finder.evaluate().isNotEmpty) {
        if (settle) await tester.pumpAndSettle();
        return;
      }
    }
    fail('Timed out waiting for "$text"');
  }

  Future<void> openReview(WidgetTester tester) async {
    final submit = find.widgetWithText(FilledButton, 'Send transfer');
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    // The action screen contains an intentionally repeating loading animation
    // while recipient/KYC checks complete, so settling the whole tree can
    // wait forever. Wait only for the review action to mount.
    await waitForText(tester, 'Continue', settle: false);
  }

  Future<void> enterExistingPin(WidgetTester tester) async {
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
  }

  testWidgets('fresh device is routed to server PIN setup after exact review', (
    tester,
  ) async {
    await useProductionPhoneViewport(tester);
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle(transactionPinConfigured: false);
    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.send,
          apiClient: bundle.apiClient,
          transactionSecurityService:
              _CertificationTransactionSecurityService(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await enterTransfer(tester, amount: '25.50');
    await openReview(tester);

    expect(find.text('Review send money'), findsOneWidget);
    expect(find.text('25.50 NGN'), findsNWidgets(2));
    expect(find.text('0.00 NGN'), findsOneWidget);
    expect(find.text('Total debit'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await waitForText(tester, 'Set transaction PIN');

    expect(find.text('Set transaction PIN'), findsOneWidget);
    expect(find.text('Set up'), findsOneWidget);
    expect(bundle.adapter.internalTransferIdempotencyKeys, isEmpty);
  });

  testWidgets(
      'uncertain transfer resolves the original attempt without a duplicate debit',
      (
    tester,
  ) async {
    await useProductionPhoneViewport(tester);
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle(
      transactionPinConfigured: true,
      internalTransferFailuresBeforeSuccess: 1,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.send,
          apiClient: bundle.apiClient,
          transactionSecurityService:
              _CertificationTransactionSecurityService(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await enterTransfer(tester, amount: '25.50');
    await openReview(tester);
    await tester.tap(find.text('Continue'));
    await waitForText(tester, 'Approve send money');

    expect(find.text('Approve send money'), findsOneWidget);
    await enterExistingPin(tester);
    await waitForText(tester, 'Payment recovery');
    expect(bundle.adapter.internalTransferIdempotencyKeys, hasLength(1));
    final originalAttemptKey =
        bundle.adapter.internalTransferIdempotencyKeys.single;
    expect(originalAttemptKey, isNotEmpty);

    final checkStatus = find.widgetWithText(TextButton, 'Check status');
    expect(checkStatus, findsOneWidget);
    await tester.tap(checkStatus);
    await tester.pumpAndSettle();
    await waitForText(
      tester,
      'Payment confirmed. Reference: IT-INTEGRATION-001. No second payment was sent.',
    );
    expect(
        find.textContaining('Reference: IT-INTEGRATION-001'), findsOneWidget);
    expect(
      bundle.adapter.internalTransferIdempotencyKeys,
      [originalAttemptKey],
    );
    expect(bundle.adapter.internalTransferMutationCount, 1);
    expect(bundle.adapter.paymentResolverAttemptKeys, [originalAttemptKey]);
    expect(bundle.adapter.paymentResolverOperations, ['INTERNAL_TRANSFER']);
    expect(bundle.adapter.paymentResolverIdempotencyKeys, hasLength(1));
    expect(
      bundle.adapter.paymentResolverIdempotencyKeys.single,
      isNot(originalAttemptKey),
    );
  });
}

class _CertificationTransactionSecurityService
    extends TransactionSecurityService {
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

  @override
  Future<void> saveVerifiedDevicePin(String pin) async {}
}
