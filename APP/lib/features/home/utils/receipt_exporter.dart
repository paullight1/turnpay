import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:image/image.dart' as img;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

class ReceiptExporter {
  static Future<Uint8List> capturePng(
    GlobalKey boundaryKey, {
    double pixelRatio = 3,
  }) async {
    final context = boundaryKey.currentContext;
    if (context == null) {
      throw StateError('Receipt is not ready yet.');
    }

    final renderObject = context.findRenderObject();
    if (renderObject is! RenderRepaintBoundary) {
      throw StateError('Receipt is not ready yet.');
    }

    final image = await renderObject.toImage(pixelRatio: pixelRatio);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    if (byteData == null) {
      throw StateError('Could not export receipt image.');
    }

    return byteData.buffer.asUint8List();
  }

  static Uint8List encodeJpg(
    Uint8List pngBytes, {
    int quality = 92,
  }) {
    final decoded = img.decodeImage(pngBytes);
    if (decoded == null) {
      throw StateError('Could not convert receipt image.');
    }

    return Uint8List.fromList(
      img.encodeJpg(decoded, quality: quality),
    );
  }

  static Future<Uint8List> buildPdf(
    Uint8List imageBytes, {
    String title = 'TrustPay receipt',
  }) async {
    final document = pw.Document();
    final image = pw.MemoryImage(imageBytes);

    document.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(24),
        build: (context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.stretch,
            children: [
              pw.Text(
                title,
                style: pw.TextStyle(
                  fontSize: 18,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
              pw.SizedBox(height: 16),
              pw.Expanded(
                child: pw.Container(
                  decoration: pw.BoxDecoration(
                    borderRadius: pw.BorderRadius.circular(16),
                  ),
                  child: pw.Center(
                    child: pw.Image(image, fit: pw.BoxFit.contain),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );

    return Uint8List.fromList(await document.save());
  }

  static Future<void> saveReceipt({
    required Map<String, String> details,
  }) async {
    final document = pw.Document(title: 'TrustPay receipt');
    document.addPage(pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(36),
      build: (_) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text('TrustPay',
              style: pw.TextStyle(
                fontSize: 24,
                fontWeight: pw.FontWeight.bold,
              )),
          pw.SizedBox(height: 4),
          pw.Text('Transaction receipt',
              style: const pw.TextStyle(fontSize: 16)),
          pw.SizedBox(height: 16),
          pw.Divider(),
          for (final entry in details.entries)
            pw.Padding(
              padding: const pw.EdgeInsets.symmetric(vertical: 8),
              child: pw.Row(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.SizedBox(width: 105, child: pw.Text(entry.key)),
                  pw.Expanded(child: pw.Text(entry.value)),
                ],
              ),
            ),
        ],
      ),
    ));
    await FilePicker.saveFile(
      dialogTitle: 'Save TrustPay receipt',
      fileName: 'trustpay-receipt.pdf',
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      bytes: await document.save(),
    );
  }

  static Future<void> shareImage({
    required Uint8List bytes,
    required String fileName,
    String? text,
    String mimeType = 'image/jpeg',
    Rect? sharePositionOrigin,
  }) async {
    await Share.shareXFiles(
      [
        XFile.fromData(
          bytes,
          mimeType: mimeType,
          name: fileName,
        ),
      ],
      text: text,
      subject: 'TrustPay receipt',
      sharePositionOrigin: sharePositionOrigin,
    );
  }

  static Future<void> sharePdf({
    required Uint8List bytes,
    required String fileName,
    String? text,
    Rect? sharePositionOrigin,
  }) async {
    await Share.shareXFiles(
      [
        XFile.fromData(
          bytes,
          mimeType: 'application/pdf',
          name: fileName,
        ),
      ],
      text: text,
      subject: 'TrustPay receipt',
      sharePositionOrigin: sharePositionOrigin,
    );
  }

  static Rect? shareOrigin(BuildContext context) {
    final renderObject = context.findRenderObject();
    if (renderObject is! RenderBox) return null;
    return renderObject.localToGlobal(Offset.zero) & renderObject.size;
  }
}
