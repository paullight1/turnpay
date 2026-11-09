import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/core/widgets/tp_empty_state.dart';
import 'package:trustpay_app/core/widgets/tp_illustration.dart';

void main() {
  testWidgets('empty-state primary action spans the available content width',
      (tester) async {
    GoogleFonts.config.allowRuntimeFetching = false;
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
            body: TpEmptyState(
          variant: TpIllustrationVariant.emptyWallet,
          title: 'No transactions yet',
          message: 'Your activity will appear here.',
          primaryActionLabel: 'Fund wallet',
          onPrimaryAction: () {},
        ))));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.getSize(find.byType(FilledButton)).width, 430 - 48);
  });
}
