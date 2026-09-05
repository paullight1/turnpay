import 'package:flutter/material.dart';

import '../../../services/api_client.dart';
import 'money_action_screen.dart';

/// Compatibility entry point for existing `/send` links.
///
/// Sending is a single primary action, so the route opens the transfer form
/// directly instead of asking the user to choose a transfer type first.
class SendMoneyEntryScreen extends StatelessWidget {
  final ApiClient? apiClient;

  const SendMoneyEntryScreen({super.key, this.apiClient});

  @override
  Widget build(BuildContext context) {
    return MoneyActionScreen(
      kind: MoneyActionKind.send,
      apiClient: apiClient,
    );
  }
}
