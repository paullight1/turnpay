import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:pdfrx/pdfrx.dart';

const _scanImageSide = 1900;
const _scanPdfPageLimit = 2;

Stream<Uint8List> receiptScanImages(
    Uint8List bytes, String contentType) async* {
  if (contentType != 'application/pdf') {
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
    final codec = await ui.instantiateImageCodecWithSize(
      buffer,
      getTargetSize: (width, height) {
        if (width * height > 48000000) {
          throw const FormatException('Receipt image is too large to scan.');
        }
        final scale = math.min(1.0, _scanImageSide / math.max(width, height));
        return ui.TargetImageSize(
          width: math.max(1, (width * scale).round()),
          height: math.max(1, (height * scale).round()),
        );
      },
    );
    try {
      final frame = await codec.getNextFrame();
      yield await _encodePng(frame.image);
    } finally {
      codec.dispose();
    }
    return;
  }

  await pdfrxFlutterInitialize();
  final document = await PdfDocument.openData(bytes);
  try {
    for (final page in document.pages.take(_scanPdfPageLimit)) {
      final scale = _scanImageSide / math.max(page.width, page.height);
      final width = math.max(1, (page.width * scale).round());
      final height = math.max(1, (page.height * scale).round());
      final rendered = await page.render(
        width: width,
        height: height,
        fullWidth: width.toDouble(),
        fullHeight: height.toDouble(),
        backgroundColor: 0xffffffff,
        annotationRenderingMode: PdfAnnotationRenderingMode.none,
      );
      if (rendered == null) continue;
      try {
        yield await _encodePng(await rendered.createImage());
      } finally {
        rendered.dispose();
      }
    }
  } finally {
    await document.dispose();
  }
}

Future<Uint8List> _encodePng(ui.Image image) async {
  try {
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    if (png == null) throw const FormatException('Could not scan the receipt.');
    return png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes);
  } finally {
    image.dispose();
  }
}
