import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_presenter.dart';
import 'package:trustpay_app/services/kyc_service.dart';

KycOverview overview(
        {String? providerStatus = 'UNVERIFIED',
        String tier = 'TIER_0',
        String provider = 'Paystack',
        String reference = '',
        List<KycDocumentSummary> documents = const []}) =>
    KycOverview(
        status: 'PENDING',
        tier: tier,
        provider: provider,
        providerValidationStatus: providerStatus,
        reference: reference,
        failureReason: '',
        verificationUri: null,
        updatedAt: null,
        documents: documents);
KycVerificationResult result(String status, {String reference = 'new-check'}) =>
    KycVerificationResult(
        status: status,
        provider: 'Paystack',
        reference: reference,
        accountProvisioningStatus: 'PENDING');

void main() {
  test('pending BVN can continue to NIN without changing a tier', () {
    final state = overview(providerStatus: 'PENDING');
    expect(kycCanStartNin(state), isTrue);
    expect(state.tier, 'TIER_0');
  });
  test('pending NIN cannot be submitted again', () {
    final state = overview(providerStatus: 'PENDING', documents: const [
      KycDocumentSummary(type: 'NIN', status: 'SUBMITTED', updatedAt: null)
    ]);
    expect(kycCanStartNin(state), isFalse);
    expect(kycCheckStatus(state, 'BVN'), 'SUBMITTED');
    expect(kycCheckStatus(state, 'NIN'), 'SUBMITTED');
  });
  test('a legacy aggregate tier never implies completed Paystack BVN', () {
    final state = overview(
        tier: 'TIER_2',
        provider: 'Monnify',
        documents: const [
          KycDocumentSummary(type: 'BVN', status: 'VERIFIED', updatedAt: null)
        ]);
    expect(kycCheckStatus(state, 'BVN'), 'INCOMPLETE');
    expect(kycCanStartNin(state), isFalse);
  });
  test('an accepted BVN response survives an immediate stale status read', () {
    final state =
        kycOverviewAfterSubmission(overview(), result('SUBMITTED'), 'BVN');
    expect(kycCheckStatus(state, 'BVN'), 'SUBMITTED');
    expect(kycCanStartNin(state), isTrue);
    expect(state.tier, 'TIER_0');
    expect(state.documents.single.updatedAt, isNull);
  });
  test('a confirmed result does not invent a higher account tier', () {
    final state =
        kycOverviewAfterSubmission(overview(), result('VERIFIED'), 'BVN');
    expect(kycCheckStatus(state, 'BVN'), 'VERIFIED');
    expect(state.tier, 'TIER_0');
  });
  test('a newer verified check is never replaced with pending', () {
    final original = overview(providerStatus: 'VERIFIED', tier: 'TIER_1');
    final state =
        kycOverviewAfterSubmission(original, result('SUBMITTED'), 'BVN');
    expect(kycCheckStatus(state, 'BVN'), 'VERIFIED');
    expect(state.tier, 'TIER_1');
  });
  test('NIN submission preserves pending BVN and tier', () {
    final state = kycOverviewAfterSubmission(
        overview(providerStatus: 'PENDING'), result('SUBMITTED'), 'NIN');
    expect(kycCheckStatus(state, 'BVN'), 'SUBMITTED');
    expect(kycCheckStatus(state, 'NIN'), 'SUBMITTED');
    expect(state.tier, 'TIER_0');
  });
  test('canonical rejected retry accepts a new pending or verified result', () {
    final rejected =
        overview(providerStatus: 'FAILED', reference: 'same-reference');
    for (final status in ['SUBMITTED', 'VERIFIED']) {
      final updated = kycOverviewAfterSubmission(
          rejected, result(status, reference: 'same-reference'), 'BVN');
      expect(kycCheckStatus(updated, 'BVN'), status);
    }
  });
  test('legacy verified documents remain readable without Paystack eligibility',
      () {
    final legacy = overview(
        providerStatus: null,
        provider: 'Monnify',
        tier: 'TIER_2',
        documents: const [
          KycDocumentSummary(type: 'BVN', status: 'VERIFIED', updatedAt: null)
        ]);
    expect(kycCheckStatus(legacy, 'BVN'), 'VERIFIED');
    expect(kycPaystackReady(legacy), isFalse);
    expect(legacy.tier, 'TIER_2');
  });
  test(
      'partial successful reads retain known checks but use the new server tier',
      () {
    final previous = overview(
        providerStatus: 'VERIFIED',
        tier: 'TIER_2',
        documents: const [
          KycDocumentSummary(type: 'NIN', status: 'SUBMITTED', updatedAt: null)
        ]);
    final updated =
        kycReconcileOverview(previous, overview(providerStatus: null));
    expect(kycCheckStatus(updated, 'BVN'), 'VERIFIED');
    expect(kycCheckStatus(updated, 'NIN'), 'SUBMITTED');
    expect(updated.tier, 'TIER_0');
  });
  test('unacknowledged local submissions survive an old unverified read', () {
    final previous = overview(providerStatus: 'PENDING');
    final updated =
        kycReconcileOverview(previous, overview(), locallyAccepted: {'BVN'});
    expect(kycCheckStatus(updated, 'BVN'), 'SUBMITTED');
  });
  test('explicit server revocation and rejection override old verified state',
      () {
    final previous = overview(providerStatus: 'VERIFIED', tier: 'TIER_2');
    for (final next in ['FAILED', 'UNVERIFIED']) {
      final updated =
          kycReconcileOverview(previous, overview(providerStatus: next));
      expect(kycCheckStatus(updated, 'BVN'),
          next == 'FAILED' ? 'FAILED' : 'INCOMPLETE');
      expect(updated.tier, 'TIER_0');
    }
  });
  test('a definitively failed response is shown as failed, without approval',
      () {
    final state =
        kycOverviewAfterSubmission(overview(), result('FAILED'), 'BVN');
    expect(kycCheckStatus(state, 'BVN'), 'FAILED');
    expect(state.tier, 'TIER_0');
  });
}
