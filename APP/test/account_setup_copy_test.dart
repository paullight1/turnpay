import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/wallet/widgets/account_setup_presenter.dart';

void main() {
  test('uses verified BVN recovery copy for an action-required setup', () {
    expect(
      AccountSetupCopy.actionRequiredTitle,
      "We couldn't finish setting up your account",
    );
    expect(
      AccountSetupCopy.actionRequiredBody(bvnVerified: true),
      'Your BVN is verified. Try account setup again. If it still doesn’t work, contact support.',
    );
  });

  test('does not promise account creation before verification or confirmation',
      () {
    expect(
      AccountSetupCopy.stepTwoDetail(
        identityVerified: false,
        identityPending: false,
        requestSaved: false,
        accountPending: false,
        actionRequired: false,
      ),
      'Request setup after identity verification.',
    );
    expect(
      AccountSetupCopy.stepTwoDetail(
        identityVerified: true,
        identityPending: false,
        requestSaved: false,
        accountPending: false,
        actionRequired: false,
      ),
      'Start setup now. Your bank details will appear here once ready.',
    );
  });

  test(
      'verified saved request offers a continuation instead of re-verification',
      () {
    expect(
      AccountSetupCopy.stepTwoDetail(
        identityVerified: true,
        identityPending: false,
        requestSaved: true,
        accountPending: false,
        actionRequired: false,
      ),
      'Request saved. Continue setup to finish creating your account.',
    );
  });
}
