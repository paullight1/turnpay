import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pdf/widgets.dart' as pdf;
import 'package:pdfrx/pdfrx.dart';
import 'package:trustpay_app/features/exchange/services/receipt_scan_images.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const pdfiumPath = String.fromEnvironment('RECEIPT_TEST_PDFIUM_PATH');

  test('prepares a receipt image for OCR', () async {
    final recorder = ui.PictureRecorder();
    ui.Canvas(recorder).drawColor(const ui.Color(0xffffffff), ui.BlendMode.src);
    final picture = recorder.endRecording();
    final image = await picture.toImage(100, 50);
    picture.dispose();
    final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!;
    image.dispose();

    final page = await receiptScanImages(
      bytes.buffer.asUint8List(),
      'image/png',
    ).single;
    expect(page.take(8), [137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test('renders the first two PDF pages for OCR', () async {
    Pdfrx.cacheDirectoryPath = '.';
    Pdfrx.pdfiumModulePath = pdfiumPath;
    final document = pdf.Document();
    for (var page = 1; page <= 3; page++) {
      document.addPage(pdf.Page(build: (_) => pdf.Text('Receipt page $page')));
    }

    final pages = await receiptScanImages(
      await document.save(),
      'application/pdf',
    ).toList();
    expect(pages, hasLength(2));
    for (final page in pages) {
      expect(page.take(8), [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  },
      skip: kIsWeb || pdfiumPath.isEmpty
          ? 'Run with a native PDFium library for PDF rendering coverage.'
          : null);
}
