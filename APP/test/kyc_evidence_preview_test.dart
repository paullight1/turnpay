import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:pdf/widgets.dart' as pdf;
import 'package:pdfrx/pdfrx.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/widgets/kyc_evidence_preview.dart';

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    Pdfrx.cacheDirectoryPath = Directory.systemTemp.path;
    // Flutter tests bundle native assets separately from the host executable.
    final library = File('build/native_assets/${Platform.operatingSystem}/'
        '${Platform.isMacOS ? 'libpdfium.dylib' : Platform.isWindows ? 'pdfium.dll' : 'libpdfium.so'}');
    if (library.existsSync()) {
      Pdfrx.pdfiumModulePath = library.absolute.path;
    }
    await pdfrxFlutterInitialize();
  });

  testWidgets('selected PDF renders its first page without uploading',
      (tester) async {
    final document = pdf.Document()
      ..addPage(pdf.Page(build: (_) => pdf.Text('SAMPLE NIN DOCUMENT')));
    final bytes = (await tester.runAsync(() => document.save()))!;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: KycEvidencePreview(
          file: PlatformFile(
              name: 'sample-nin.pdf', size: bytes.length, bytes: bytes),
        ),
      ),
    ));
    for (var i = 0; i < 30; i++) {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump(const Duration(milliseconds: 100));
      if (find.byType(RawImage).evaluate().isNotEmpty) {
        break;
      }
    }
    expect(find.text('sample-nin.pdf'), findsOneWidget);
    expect(find.byType(RawImage), findsOneWidget);
    expect(tester.widget<RawImage>(find.byType(RawImage)).image, isNotNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('unreadable PDF keeps the filename and falls back gracefully',
      (tester) async {
    final bytes = Uint8List.fromList([1, 2, 3]);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: KycEvidencePreview(
          file: PlatformFile(
              name: 'unreadable.pdf', size: bytes.length, bytes: bytes),
        ),
      ),
    ));
    for (var i = 0; i < 30; i++) {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump(const Duration(milliseconds: 100));
      if (find.byIcon(Icons.picture_as_pdf_outlined).evaluate().isNotEmpty) {
        break;
      }
    }
    expect(find.text('unreadable.pdf'), findsOneWidget);
    expect(find.byIcon(Icons.picture_as_pdf_outlined), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
