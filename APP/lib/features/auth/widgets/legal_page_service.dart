import 'dart:async';

import 'package:url_launcher/url_launcher.dart';

import '../../../core/constants/app_constants.dart';

void openTrustPayLegalPage({String? fragment}) {
  unawaited(
    launchUrl(
      AppConstants.legalPageUri(fragment: fragment),
      mode: LaunchMode.externalApplication,
    ),
  );
}
