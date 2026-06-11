import 'dart:async';

import 'package:url_launcher/url_launcher.dart';

void openTawkChatImpl() {
  unawaited(
    launchUrl(
      Uri.parse('https://tawk.to/chat/6a1d1a71e29f411c2ce86741/1jq0quiuh'),
      mode: LaunchMode.externalApplication,
    ),
  );
}
