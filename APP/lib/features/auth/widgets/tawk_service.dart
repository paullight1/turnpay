import 'package:flutter/material.dart';

import 'tawk_service_stub.dart'
    if (dart.library.js_interop) 'tawk_service_web.dart';

Future<void> openTawkChat(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(const SnackBar(
    content: Text('Opening support in your browser…'),
  ));
  try {
    if (await openTawkChatImpl()) return;
  } catch (_) {
    // Keep native launcher details out of the customer-facing error.
  }
  if (!context.mounted) return;
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(const SnackBar(
    content: Text('Could not open support. Please try again.'),
  ));
}
