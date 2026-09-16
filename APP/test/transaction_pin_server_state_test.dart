import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('fresh device verifies when the server already has a PIN', () {
    expect(
      TransactionPinServerPolicy.entryMode(serverConfigured: true),
      TransactionPinServerEntryMode.verifyExisting,
    );
  });

  test('local PIN cache never overrides an unconfigured server', () async {
    final security = TransactionSecurityService();
    await security.savePin('2468', pinLength: 4);
    expect((await security.getConfig()).hasPin, isTrue);

    expect(
      TransactionPinServerPolicy.entryMode(serverConfigured: false),
      TransactionPinServerEntryMode.create,
    );
  });

  test('a setup conflict never authorizes saving the attempted PIN', () {
    expect(
      TransactionPinServerPolicy.mayPersistCreatedPin(
        setupSucceeded: false,
        serverConfiguredAfterConflict: true,
      ),
      isFalse,
    );
  });

  group('transaction PIN reset policy', () {
    test('requires the current PIN to be verified before replacement entry',
        () {
      expect(
        TransactionPinResetPolicy.step(
          currentPin: null,
          replacementPin: null,
        ),
        TransactionPinResetStep.verifyCurrent,
      );
    });

    test('advances from replacement entry to confirmation', () {
      expect(
        TransactionPinResetPolicy.step(
          currentPin: '2468',
          replacementPin: null,
        ),
        TransactionPinResetStep.enterReplacement,
      );
      expect(
        TransactionPinResetPolicy.step(
          currentPin: '2468',
          replacementPin: '1357',
        ),
        TransactionPinResetStep.confirmReplacement,
      );
    });

    test('rejects reuse of the current PIN and mismatched confirmation', () {
      expect(
        TransactionPinResetPolicy.validateReplacement(
          currentPin: '2468',
          replacementPin: '2468',
        ),
        'Choose a PIN different from your current PIN.',
      );
      expect(
        TransactionPinResetPolicy.validateConfirmation(
          replacementPin: '1357',
          confirmationPin: '1358',
        ),
        'PINs did not match. Enter the new PIN again.',
      );
    });
  });

  test('changing authenticated users clears persisted PIN state',
      () async {
    final security = TransactionSecurityService();
    await security.bindToAuthenticatedUser('user-1');
    await security.savePin('2468', pinLength: 4);
    expect((await security.getConfig()).hasPin, isTrue);

    await security.bindToAuthenticatedUser('user-2');

    expect((await security.getConfig()).hasPin, isFalse);
  });
}
