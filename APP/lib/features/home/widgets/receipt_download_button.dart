import 'package:flutter/material.dart';

import '../utils/receipt_exporter.dart';

class ReceiptDownloadButton extends StatefulWidget {
  final Map<String, String> details;
  final bool enabled;

  const ReceiptDownloadButton({
    super.key,
    required this.details,
    this.enabled = true,
  });

  @override
  State<ReceiptDownloadButton> createState() => _ReceiptDownloadButtonState();
}

class _ReceiptDownloadButtonState extends State<ReceiptDownloadButton> {
  bool _saving = false;

  Future<void> _download() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      await ReceiptExporter.saveReceipt(details: widget.details);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save receipt. Try again.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: _saving || !widget.enabled ? null : _download,
      icon: const Icon(Icons.download_rounded),
      label: Text(_saving ? 'Preparing receipt…' : 'Download receipt'),
    );
  }
}
