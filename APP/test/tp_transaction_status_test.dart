import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/widgets/tp_receipt.dart';
import 'package:trustpay_app/core/widgets/tp_transaction_status.dart';

void main() {
  Widget host(Widget child) => MaterialApp(
        home: Scaffold(body: Center(child: child)),
      );

  group('TpStatusIcon', () {
    for (final status in TpTxStatus.values) {
      testWidgets('renders "$status" without throwing', (tester) async {
        await tester.pumpWidget(host(TpStatusIcon(status: status)));
        // Advance a few frames (looping states never settle, so no
        // pumpAndSettle here) and assert the paint pipeline stayed clean.
        await tester.pump(const Duration(milliseconds: 100));
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.byType(TpStatusIcon), findsOneWidget);
        expect(find.byType(CustomPaint), findsWidgets);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('honors an explicit animate: false', (tester) async {
      await tester.pumpWidget(
        host(const TpStatusIcon(status: TpTxStatus.success, animate: false)),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });

  group('TpStatusPill', () {
    testWidgets('shows the status label', (tester) async {
      await tester.pumpWidget(
        host(const TpStatusPill(status: TpTxStatus.success)),
      );
      expect(find.text('Successful'), findsOneWidget);
    });

    testWidgets('maps a raw backend status string', (tester) async {
      await tester.pumpWidget(host(TpStatusPill.fromStatus('PROCESSING')));
      expect(find.text('Processing'), findsOneWidget);
    });

    test('fromString degrades unknown statuses to pending', () {
      expect(TpTxStatusX.fromString('WHATEVER'), TpTxStatus.pending);
      expect(TpTxStatusX.fromString('REVERSED'), TpTxStatus.failed);
      expect(TpTxStatusX.fromString(null), TpTxStatus.pending);
    });
  });

  group('TpTransactionResultView', () {
    testWidgets('renders title, amount and detail rows', (tester) async {
      await tester.pumpWidget(
        host(
          const TpTransactionResultView(
            status: TpTxStatus.success,
            title: 'Transfer sent',
            message: 'Chidi received your money instantly.',
            amount: '₦25,000.00',
            details: [
              TpDetailRow('Recipient', 'c****@gmail.com'),
              TpDetailRow('Fee', '₦0.00'),
            ],
          ),
        ),
      );
      // Let entrance timers and the one-shot icon advance without settling.
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Transfer sent'), findsOneWidget);
      expect(find.text('₦25,000.00'), findsOneWidget);
      expect(find.text('Recipient'), findsOneWidget);
      expect(find.text('c****@gmail.com'), findsOneWidget);
      expect(find.byType(TpStatusIcon), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('TpStatusStepTracker', () {
    testWidgets('renders each step and an active in-progress marker',
        (tester) async {
      await tester.pumpWidget(
        host(
          const TpStatusStepTracker(
            currentIndex: 1,
            steps: [
              TpStatusStep('Amount debited'),
              TpStatusStep('Sent to bank', subtitle: 'Awaiting confirmation'),
              TpStatusStep('Bank confirmed'),
            ],
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Amount debited'), findsOneWidget);
      expect(find.text('Sent to bank'), findsOneWidget);
      expect(find.text('Bank confirmed'), findsOneWidget);
      // The active step reuses the animated in-progress icon.
      expect(find.byType(TpStatusIcon), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('TpReceiptHero integration', () {
    testWidgets('renders the animated status icon in the hero',
        (tester) async {
      await tester.pumpWidget(
        host(
          const TpReceiptHero(
            tone: TpReceiptTone.success,
            title: 'Withdrawal receipt',
            message: 'Your payout cleared successfully.',
            statusLabel: 'SUCCESS',
            amountLabel: 'NGN 25,000.00',
            reference: 'WD-1234',
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.byType(TpStatusIcon), findsOneWidget);
      expect(find.text('Withdrawal receipt'), findsOneWidget);
      expect(find.text('NGN 25,000.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
