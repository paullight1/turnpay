import '../../../services/kyc_service.dart';

bool kycCheckPending(String status) => const {
      'PENDING',
      'SUBMITTED',
      'PENDING_REVIEW',
      'REVIEW_REQUIRED',
    }.contains(status);

bool kycPaystackReady(KycOverview overview) {
  final explicit = overview.providerValidationStatus?.toUpperCase();
  if (explicit != null && explicit.isNotEmpty) return explicit == 'VERIFIED';
  return overview.provider.toUpperCase() == 'PAYSTACK' &&
      overview.documents.any((item) =>
          item.type.toUpperCase() == 'BVN' && item.status == 'VERIFIED');
}

String kycCheckStatus(KycOverview overview, String type) {
  if (type == 'BVN') {
    final providerStatus = overview.providerValidationStatus?.toUpperCase();
    if (providerStatus == 'VERIFIED') return 'VERIFIED';
    if (providerStatus == 'PENDING') return 'SUBMITTED';
    if (providerStatus == 'FAILED') return 'FAILED';
    if (providerStatus != null && providerStatus.isNotEmpty) {
      return 'INCOMPLETE';
    }
  }
  for (final document in overview.documents) {
    if (document.type.toUpperCase() == type) return document.status;
  }
  return 'INCOMPLETE';
}

String kycCheckLabel(String status) {
  if (status == 'VERIFIED') return 'Verified';
  if (kycCheckPending(status)) return 'Under review';
  if (status == 'FAILED' || status == 'REJECTED') return 'Needs attention';
  return 'Not started';
}

bool kycCanStartNin(KycOverview overview) {
  final bvn = kycCheckStatus(overview, 'BVN');
  final nin = kycCheckStatus(overview, 'NIN');
  return (bvn == 'VERIFIED' || kycCheckPending(bvn)) &&
      nin != 'VERIFIED' &&
      !kycCheckPending(nin);
}

KycOverview _copy(KycOverview source,
        {required List<KycDocumentSummary> documents,
        String? providerStatus,
        String? provider,
        String? reference}) =>
    KycOverview(
      firstName: source.firstName,
      lastName: source.lastName,
      phone: source.phone,
      profileIdentityLocked: source.profileIdentityLocked,
      status: source.status,
      tier: source.tier,
      provider: provider ?? source.provider,
      providerValidationStatus:
          providerStatus ?? source.providerValidationStatus,
      reference: reference ?? source.reference,
      failureReason: source.failureReason,
      verificationUri: source.verificationUri,
      updatedAt: source.updatedAt,
      documents: documents,
    );

/// An accepted retry may reuse the canonical reference of its failed attempt.
/// Only an already-confirmed check takes precedence over that accepted result.
KycOverview kycOverviewAfterSubmission(
    KycOverview overview, KycVerificationResult result, String type) {
  final previous = kycCheckStatus(overview, type);
  if (previous == 'VERIFIED' && (type != 'BVN' || kycPaystackReady(overview))) {
    return overview;
  }
  final failed = result.status == 'FAILED' || result.status == 'REJECTED';
  if (result.status != 'VERIFIED' &&
      !kycCheckPending(result.status) &&
      !failed) {
    return overview;
  }
  final status = result.status == 'VERIFIED'
      ? 'VERIFIED'
      : failed
          ? result.status
          : 'SUBMITTED';
  final alreadyReported = status == previous ||
      (kycCheckPending(status) && kycCheckPending(previous));
  return _copy(overview,
      providerStatus: type == 'BVN'
          ? status == 'VERIFIED'
              ? 'VERIFIED'
              : failed
                  ? 'FAILED'
                  : 'PENDING'
          : null,
      reference: result.reference,
      documents: alreadyReported
          ? overview.documents
          : [
              KycDocumentSummary(type: type, status: status, updatedAt: null),
              ...overview.documents,
            ]);
}

/// A missing check is not a rejection. Retain known check presentation for a
/// partial read or an unacknowledged local submission. Explicit server outcomes
/// and the incoming server-owned account tier always take precedence.
KycOverview kycReconcileOverview(KycOverview previous, KycOverview incoming,
    {Set<String> locallyAccepted = const {}}) {
  final documents = [...incoming.documents];
  String? providerStatus, provider;
  for (final type in ['BVN', 'NIN']) {
    final next = kycCheckStatus(incoming, type),
        before = kycCheckStatus(previous, type);
    final hasDocument =
        incoming.documents.any((item) => item.type.toUpperCase() == type);
    final explicitBvn = incoming.providerValidationStatus?.isNotEmpty == true;
    final missing = !hasDocument && (type != 'BVN' || !explicitBvn);
    final legacy = type == 'BVN' &&
        locallyAccepted.contains(type) &&
        next == 'VERIFIED' &&
        !kycPaystackReady(incoming);
    if ((next == 'INCOMPLETE' || legacy) &&
        before != 'INCOMPLETE' &&
        (missing || locallyAccepted.contains(type))) {
      documents.removeWhere((item) => item.type.toUpperCase() == type);
      final known =
          previous.documents.where((item) => item.type.toUpperCase() == type);
      documents.addAll(known.isEmpty
          ? [KycDocumentSummary(type: type, status: before, updatedAt: null)]
          : known);
      if (type == 'BVN') {
        providerStatus = previous.providerValidationStatus;
        if (!explicitBvn) provider = previous.provider;
      }
    }
  }
  return _copy(incoming,
      documents: documents, providerStatus: providerStatus, provider: provider);
}
