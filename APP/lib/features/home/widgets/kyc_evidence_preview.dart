import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../../core/theme/app_theme.dart';

/// Previews the selection in memory; submission owns the protected upload.
class KycEvidencePreview extends StatelessWidget {
  final PlatformFile file;

  const KycEvidencePreview({super.key, required this.file});

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final extension = file.extension?.toLowerCase() ?? '';
    final bytes = file.bytes;
    final isPdf = extension == 'pdf';
    final canPreview = bytes != null &&
        bytes.isNotEmpty &&
        bytes.length <= 8 * 1024 * 1024 &&
        (!isPdf || String.fromCharCodes(bytes.take(5)) == '%PDF-');
    Widget fallback() => Icon(
          isPdf ? Icons.picture_as_pdf_outlined : Icons.image_outlined,
          color: AppColors.textSecondary,
          semanticLabel: 'Preview unavailable',
        );
    final size = file.size < 1024 * 1024
        ? '${(file.size / 1024).ceil()} KB'
        : '${(file.size / (1024 * 1024)).toStringAsFixed(1)} MB';

    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: SizedBox(
                width: 56,
                height: 72,
                child: ColoredBox(
                  color: Colors.white,
                  child: !canPreview
                      ? fallback()
                      : isPdf
                          ? PdfDocumentViewBuilder(
                              documentRef: PdfDocumentRefData(
                                bytes,
                                sourceName:
                                    'nin-preview-${identityHashCode(file)}',
                              ),
                              loadingBuilder: (_) => const Center(
                                child: SizedBox(
                                  width: 18,
                                  height: 18,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                ),
                              ),
                              errorBuilder: (_, __, ___) => fallback(),
                              builder: (_, document) => PdfPageView(
                                document: document,
                                pageNumber: 1,
                                maximumDpi: 96,
                              ),
                            )
                          : Image.memory(
                              bytes,
                              fit: BoxFit.contain,
                              cacheWidth: 192,
                              semanticLabel: 'Selected NIN image preview',
                              errorBuilder: (_, __, ___) => fallback(),
                            ),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    file.name,
                    style: AppTextStyles.labelS,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    '${extension.toUpperCase()} · $size',
                    style: AppTextStyles.caption,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
