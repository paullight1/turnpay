/// Customer-safe copy for the server-owned receiving-account setup states.
///
/// Provider responses can contain internal diagnostics. Keep those details out
/// of the customer app and describe only the next safe action instead.
class AccountSetupCopy {
  const AccountSetupCopy._();

  static const actionRequiredTitle =
      "We couldn't finish setting up your account";

  static const _verifiedActionRequiredBody =
      'Your BVN is verified. Try account setup again. If it still doesn’t work, contact support.';

  static const _generalActionRequiredBody =
      'Try account setup again. If it still doesn’t work, contact support.';

  static String actionRequiredBody({required bool? bvnVerified}) {
    return bvnVerified == true
        ? _verifiedActionRequiredBody
        : _generalActionRequiredBody;
  }

  static const pendingBody =
      'Your request was accepted. Your bank details will appear here once ready.';

  static const waitingForKycBody =
      'Your setup request is saved. We’ll create your NGN account after your identity is verified.';

  static String stepTwoDetail({
    required bool identityVerified,
    required bool identityPending,
    required bool requestSaved,
    required bool accountPending,
    required bool actionRequired,
  }) {
    if (requestSaved && identityVerified) {
      return 'Request saved. Continue setup to finish creating your account.';
    }
    if (requestSaved) {
      return 'Request saved. Setup continues automatically after verification.';
    }
    if (accountPending) {
      return 'Request received. Checking for your account details.';
    }
    if (actionRequired && identityVerified) {
      return 'Your BVN is verified. Retry account setup to continue.';
    }
    if (identityPending) {
      return 'Setup continues after your identity check is complete.';
    }
    if (actionRequired) {
      return 'Retry account setup after your identity check is complete.';
    }
    if (identityVerified) {
      return 'Start setup now. Your bank details will appear here once ready.';
    }
    return 'Request setup after identity verification.';
  }
}
