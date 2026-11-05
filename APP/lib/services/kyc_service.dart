import 'dart:typed_data';
import 'dart:convert';
import 'package:crypto/crypto.dart';

import 'package:dio/dio.dart';

import 'api_client.dart';

class KycService {
  KycService({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;
  final _paystackReconcileAttempt = MoneyAttemptIdempotency();
  Future<List<KycBankOption>>? _banksRequest;
  DateTime? _banksRequestedAt;

  Future<Response<dynamic>> _identityProfileRequest(
      Future<Response<dynamic>> Function() request) async {
    try {
      return await request();
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      final body = error.response?.data;
      final details =
          body is Map && body['message'] is Map ? body['message'] as Map : body;
      if (status == 409 &&
          details is Map &&
          details['code'] == 'PROFILE_PHONE_IN_USE') {
        throw const KycProfileException(
            'This phone number is already linked to another account. Use your own registered number or contact support.');
      }
      if (status == null || status >= 500) {
        throw const KycProfileException(
            'We could not confirm your saved details. Your BVN has not been submitted. Try again; we will check your saved details first.');
      }
      rethrow;
    }
  }

  Future<List<KycBankOption>> fetchBanks() {
    if (_banksRequest != null &&
        _banksRequestedAt != null &&
        DateTime.now().difference(_banksRequestedAt!) <
            const Duration(minutes: 5)) {
      return _banksRequest!;
    }
    _banksRequestedAt = DateTime.now();
    return _banksRequest = _fetchBanks();
  }

  Future<List<KycBankOption>> _fetchBanks() async {
    try {
      final response =
          await _apiClient.client.get<dynamic>('/api/payments/banks');
      final payload = response.data;
      final source = payload is List
          ? payload
          : _asList(_asMap(payload)['banks'] ?? _asMap(payload)['data']);
      final banks = source
          .whereType<Map>()
          .map(
              (item) => KycBankOption.fromJson(Map<String, dynamic>.from(item)))
          .where((bank) => bank.name.isNotEmpty && bank.code.isNotEmpty)
          .toList(growable: false);
      if (banks.isEmpty) _banksRequestedAt = null;
      return [...banks]..sort((a, b) => a.name.compareTo(b.name));
    } catch (_) {
      _banksRequest = null;
      _banksRequestedAt = null;
      rethrow;
    }
  }

  Future<KycOverview> fetchOverview(
      {bool includeIdentityProfile = false}) async {
    try {
      final response = await _apiClient.client.get<dynamic>('/api/kyc/status');
      if (!includeIdentityProfile) {
        return KycOverview.fromJson(_asMap(response.data));
      }
      final profile = await _apiClient.client.get<dynamic>('/api/users/me');
      return KycOverview.fromJson({
        ..._asMap(response.data),
        'user': _asMap(profile.data),
      });
    } on DioException catch (error) {
      if (!_canUseFallback(error)) rethrow;
    }

    final bootstrap =
        await _apiClient.client.post<dynamic>('/api/auth/bootstrap');
    final bootstrapMap = _asMap(bootstrap.data);
    final userMap = _asMap(bootstrapMap['user']);
    final documents = await _fetchDocuments();

    return KycOverview.fromJson(
      {
        'provider': 'PAYSTACK',
        'user': userMap,
        'kycStatus': _asString(userMap['kycStatus'], fallback: 'PENDING'),
        'kycTier': _asString(userMap['kycTier'], fallback: 'TIER_0'),
        'documents': documents.map((document) => document.toJson()).toList(),
      },
    );
  }

  /// Requests provider-side recovery for the existing Paystack BVN attempt.
  ///
  /// No identity fields are sent and this endpoint cannot submit a new check
  /// or promote a tier. A new manual check gets a new idempotency key after a
  /// response; a transport-uncertain request retains its key so a retry can
  /// safely recover the same reconciliation operation.
  Future<PaystackKycRecovery> reconcilePaystack() async {
    final idempotencyKey =
        _paystackReconcileAttempt.keyFor('paystack-bvn-reconcile');
    try {
      final response = await _apiClient.client.post<dynamic>(
        '/api/kyc/paystack/reconcile',
        data: const <String, dynamic>{},
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      );
      final recovery = PaystackKycRecovery.fromJson(_asMap(response.data));
      // Every valid HTTP response is a completed reconciliation attempt. A
      // new manual check must not replay a cached TEMPORARILY_UNAVAILABLE
      // response; only transport uncertainty below retains the key.
      _paystackReconcileAttempt.markFinalOutcome();
      return recovery;
    } on DioException catch (error) {
      if (!_isUncertainReconciliationError(error)) {
        _paystackReconcileAttempt.markFinalOutcome();
      }
      rethrow;
    }
  }

  /// Customer setup reads the saved user profile, so commit reviewed details
  /// before starting identity verification. A read also recovers a lost PATCH
  /// response without consuming the protected profile update twice.
  Future<bool> ensureIdentityProfile({
    required String firstName,
    required String lastName,
    required String phone,
    required int yearOfBirth,
    required String idempotencyKey,
  }) async {
    final nameError = validateKycLegalName(firstName, lastName);
    final normalizedPhone = normalizeNigerianKycPhone(phone);
    if (nameError != null || normalizedPhone == null) {
      throw KycProfileException(nameError ?? kycPhoneValidationMessage);
    }
    if (yearOfBirth < 1900 || yearOfBirth > DateTime.now().year - 13) {
      throw const KycProfileException(
          'Check your date of birth before continuing.');
    }
    final response = await _identityProfileRequest(
        () => _apiClient.client.get<dynamic>('/api/users/me'));
    final profile = _asMap(response.data);
    if (profile.isEmpty) {
      throw const KycProfileException(
          'Your saved details could not be loaded. Try again.');
    }
    final fullName = '${firstName.trim()} ${lastName.trim()}'
        .replaceAll(RegExp(r'\s+'), ' ');
    final savedName =
        _asString(profile['fullName']).trim().replaceAll(RegExp(r'\s+'), ' ');
    final savedPhone = normalizeNigerianKycPhone(_asString(profile['phone']));
    final locked = profile['profileDetailsUpdatedAt'] != null ||
        _asString(profile['kycStatus']).toUpperCase() == 'VERIFIED';
    if (savedName.toLowerCase() == fullName.toLowerCase() &&
        savedPhone == normalizedPhone) {
      return locked;
    }
    if (locked) {
      throw const KycProfileException(kycLockedProfileMessage,
          requiresSupport: true);
    }
    final country = _asString(profile['country'], fallback: 'NG').toUpperCase();
    if (country != 'NG') {
      throw const KycProfileException(
          'BVN verification requires a Nigerian profile. Contact support to review your country.',
          requiresSupport: true);
    }
    await _identityProfileRequest(() => _apiClient.client.patch<dynamic>(
            '/api/users/me',
            options: Options(headers: {'Idempotency-Key': idempotencyKey}),
            data: {
              'fullName': fullName,
              'phone': normalizedPhone,
              'yearOfBirth': yearOfBirth,
              'country': 'NG'
            }));
    return true;
  }

  Future<KycVerificationResult> verifyIdentity({
    required String idempotencyKey,
    required String idNumber,
    required String dateOfBirth,
    required bool consentAccepted,
    String? firstName,
    String? lastName,
    String country = 'NG',
    String type = 'BVN',
    String? bankCode,
    String? accountNumber,
    bool accountSetupConsent = false,
    bool retryPending = false,
  }) async {
    final options = Options(headers: {'Idempotency-Key': idempotencyKey});
    final request = {
      'country': country,
      'type': type,
      'idNumber': idNumber,
      'dateOfBirth': dateOfBirth,
      'consentAccepted': consentAccepted,
      if (retryPending) 'retryPending': true,
      if (bankCode != null && bankCode.trim().isNotEmpty)
        'bankCode': bankCode.trim(),
      if (accountNumber != null && accountNumber.trim().isNotEmpty)
        'accountNumber': accountNumber.trim(),
      if (accountSetupConsent) 'accountSetupConsent': true,
      if (firstName != null && firstName.trim().isNotEmpty)
        'firstName': firstName.trim(),
      if (lastName != null && lastName.trim().isNotEmpty)
        'lastName': lastName.trim(),
    };

    final response = await _apiClient.client.post<dynamic>(
      '/api/kyc/verify',
      data: request,
      options: options,
    );
    return KycVerificationResult.fromJson(_asMap(response.data));
  }

  Future<KycDocumentUpload> createDocumentUploadUrl({
    required String fileName,
    required String contentType,
    required int fileSize,
    String? idempotencyKey,
  }) async {
    final response = await _apiClient.client.post<dynamic>(
      '/api/kyc/document-upload-url',
      data: {
        'fileName': fileName,
        'contentType': contentType,
        'fileSize': fileSize,
      },
      options: idempotencyKey == null || idempotencyKey.isEmpty
          ? null
          : Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return KycDocumentUpload.fromJson(_asMap(response.data));
  }

  /// Uploads directly to the signed object-store URL. This deliberately uses
  /// a fresh Dio client so application auth headers and logging interceptors
  /// never reach the storage provider.
  Future<void> uploadDocumentBytes({
    required KycDocumentUpload upload,
    required String contentType,
    required Uint8List bytes,
  }) async {
    final uri = Uri.tryParse(upload.signedUrl);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      throw const FormatException('The document upload URL is not secure.');
    }
    await Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
    )).put<void>(
      upload.signedUrl,
      data: bytes,
      options: Options(
        headers: {'Content-Type': contentType},
        followRedirects: false,
        maxRedirects: 0,
      ),
    );
  }

  Future<KycVerificationResult> submitManualDocument({
    required String idempotencyKey,
    required String idNumber,
    required String objectKey,
    required bool consentAccepted,
  }) async {
    final response = await _apiClient.client.post<dynamic>(
      '/api/kyc/manual-documents',
      data: {
        'type': 'NIN',
        'idNumber': idNumber,
        'objectKey': objectKey,
        'consentAccepted': consentAccepted,
      },
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return KycVerificationResult.fromJson(_asMap(response.data));
  }

  Future<List<KycDocumentSummary>> _fetchDocuments() async {
    try {
      final response =
          await _apiClient.client.get<dynamic>('/api/kyc/documents');
      final data = response.data;
      final source = data is List ? data : _asList(_asMap(data)['documents']);
      return source
          .map((item) => KycDocumentSummary.fromJson(_asMap(item)))
          .toList(growable: false);
    } on DioException {
      return const [];
    }
  }

  bool _canUseFallback(DioException error) {
    final statusCode = error.response?.statusCode;
    return statusCode == 404 || statusCode == 405 || statusCode == 501;
  }

  bool _isUncertainReconciliationError(DioException error) {
    final statusCode = error.response?.statusCode;
    return statusCode == null ||
        statusCode == 408 ||
        statusCode == 425 ||
        statusCode == 429 ||
        statusCode >= 500;
  }
}

class KycBankOption {
  final String name;
  final String code;
  final String slug;

  const KycBankOption({
    required this.name,
    required this.code,
    required this.slug,
  });

  factory KycBankOption.fromJson(Map<String, dynamic> json) {
    return KycBankOption(
      name: _asString(json['name']),
      code: _asString(json['code']),
      slug: _asString(json['slug']),
    );
  }
}

class KycDocumentUpload {
  final String objectKey;
  final String signedUrl;

  const KycDocumentUpload({required this.objectKey, required this.signedUrl});

  factory KycDocumentUpload.fromJson(Map<String, dynamic> json) {
    final objectKey = _asString(json['objectKey']);
    final signedUrl = _asString(json['signedUrl']);
    if (objectKey.isEmpty || signedUrl.isEmpty) {
      throw const FormatException(
          'The document upload response is incomplete.');
    }
    return KycDocumentUpload(objectKey: objectKey, signedUrl: signedUrl);
  }
}

class KycOverview {
  final String? firstName;
  final String? lastName;
  final String? phone;
  final bool profileIdentityLocked;
  final String status;
  final String tier;
  final String provider;
  final String? providerValidationStatus;
  final String reference;
  final String failureReason;
  final Uri? verificationUri;
  final DateTime? updatedAt;
  final List<KycDocumentSummary> documents;
  final PaystackKycRecovery? recovery;
  final bool ninVerificationAvailable;
  final bool isSuspended;
  final String accountPreparationStatus;
  final Map<String, dynamic>? tierOneLimits;
  final bool hasTierOneLimitPolicyInfo;

  const KycOverview({
    this.firstName,
    this.lastName,
    this.phone,
    this.profileIdentityLocked = false,
    required this.status,
    required this.tier,
    required this.provider,
    this.providerValidationStatus,
    required this.reference,
    required this.failureReason,
    required this.verificationUri,
    required this.updatedAt,
    required this.documents,
    this.recovery,
    this.ninVerificationAvailable = false,
    this.isSuspended = false,
    this.accountPreparationStatus = 'NOT_REQUESTED',
    this.tierOneLimits,
    this.hasTierOneLimitPolicyInfo = false,
  });

  factory KycOverview.fromJson(Map<String, dynamic> json) {
    final user = _asMap(json['user']);
    final fullName =
        _firstString([json['fullName'], user['fullName']], fallback: '');
    final nameParts = fullName
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();
    final kyc = _asMap(json['kyc']);
    final latest = _asMap(
      json['latestVerification'] ?? json['verification'] ?? json['session'],
    );
    final documentsSource = json['documents'] is List
        ? _asList(json['documents'])
        : _asList(kyc['documents']);
    final recovery = PaystackKycRecovery.fromNullable(
      json['recovery'] ??
          json['paystackRecovery'] ??
          latest['recovery'] ??
          kyc['recovery'],
    );

    return KycOverview(
      firstName: nameParts.isNotEmpty ? nameParts.first : null,
      lastName: nameParts.length > 1 ? nameParts.skip(1).join(' ') : null,
      phone: _firstString([json['phone'], user['phone']], fallback: ''),
      profileIdentityLocked: user['profileDetailsUpdatedAt'] != null ||
          _asString(user['kycStatus']).toUpperCase() == 'VERIFIED',
      status: _normalizedStatus(
        _firstString([
          json['kycStatus'],
          json['status'],
          user['kycStatus'],
          kyc['status'],
          latest['status'],
        ], fallback: 'PENDING'),
      ),
      tier: _normalizedTier(
        _firstString([
          json['tier'],
          json['kycTier'],
          user['kycTier'],
          kyc['tier'],
          latest['tier'],
        ], fallback: 'TIER_0'),
      ),
      provider: _displayProvider(
        _firstString([
          json['provider'],
          latest['provider'],
          kyc['provider'],
        ], fallback: 'PAYSTACK'),
      ),
      providerValidationStatus: _normalizedProviderValidationStatus(
        json['providerValidationStatus'] ??
            kyc['providerValidationStatus'] ??
            latest['providerValidationStatus'],
      ),
      reference: _firstString([
        json['reference'],
        json['providerReference'],
        latest['reference'],
        latest['providerReference'],
        latest['jobId'],
        latest['job_id'],
      ]),
      failureReason: _firstString([
        json['failureReason'],
        json['rejectionReason'],
        json['message'],
        latest['failureReason'],
        latest['errorMessage'],
      ]),
      verificationUri: _readUri(json) ?? _readUri(latest) ?? _readUri(kyc),
      updatedAt: _asDate(
        json['updatedAt'] ?? latest['updatedAt'] ?? kyc['updatedAt'],
      ),
      documents: documentsSource
          .map((item) => KycDocumentSummary.fromJson(_asMap(item)))
          .toList(growable: false),
      recovery: recovery,
      ninVerificationAvailable: json['ninVerificationAvailable'] == true,
      isSuspended: json['isSuspended'] == true || user['isSuspended'] == true,
      hasTierOneLimitPolicyInfo: json.containsKey('tierOneLimits'),
      accountPreparationStatus: _asString(
          _asMap(json['accountProvisioning'])['status'],
          fallback: 'NOT_REQUESTED'),
      tierOneLimits:
          json['tierOneLimits'] is Map ? _asMap(json['tierOneLimits']) : null,
    );
  }

  bool get isVerified => status == 'VERIFIED';
  bool get isRejected => status == 'REJECTED' || status == 'FAILED';
  bool get isSubmitted =>
      status == 'SUBMITTED' ||
      status == 'PENDING_REVIEW' ||
      status == 'REVIEW_REQUIRED';

  String get displayStatus {
    switch (status) {
      case 'VERIFIED':
        return 'Verified';
      case 'SUBMITTED':
      case 'PENDING_REVIEW':
      case 'REVIEW_REQUIRED':
        return 'Under review';
      case 'REJECTED':
        return 'Needs attention';
      case 'FAILED':
        return 'Could not verify';
      default:
        return 'Not verified';
    }
  }

  String get displayTier {
    return tier.replaceAll('_', ' ');
  }

  String get primaryActionLabel {
    if (isVerified) return 'Refresh status';
    if (isSubmitted) return 'Continue verification';
    if (isRejected) return 'Try again';
    return 'Start verification';
  }
}

String? _normalizedProviderValidationStatus(dynamic value) {
  final normalized = _asString(value).toUpperCase();
  if (normalized.isEmpty) return null;
  return normalized;
}

class KycDocumentSummary {
  final String type;
  final String status;
  final DateTime? updatedAt;
  final PaystackKycRecovery? recovery;

  const KycDocumentSummary({
    required this.type,
    required this.status,
    required this.updatedAt,
    this.recovery,
  });

  factory KycDocumentSummary.fromJson(Map<String, dynamic> json) {
    return KycDocumentSummary(
      type: _firstString([json['type'], json['documentType']],
          fallback: 'Identity'),
      status: _normalizedStatus(
        _firstString([json['status'], json['verificationStatus']],
            fallback: 'PENDING'),
      ),
      updatedAt: _asDate(json['updatedAt'] ?? json['createdAt']),
      recovery: PaystackKycRecovery.fromNullable(
        json['recovery'] ?? json['paystackRecovery'],
      ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'type': type,
      'status': status,
      if (updatedAt != null) 'updatedAt': updatedAt!.toIso8601String(),
      if (recovery != null) 'recovery': recovery!.toJson(),
    };
  }
}

/// Safe provider-recovery metadata returned for an existing Paystack KYC
/// attempt. It contains no identity, bank, customer, or provider-secret data.
class PaystackKycRecovery {
  static const checking = 'CHECKING';
  static const awaitingProvider = 'AWAITING_PROVIDER';
  static const actionRequired = 'ACTION_REQUIRED';
  static const webhookRequested = 'WEBHOOK_REQUESTED';
  static const temporarilyUnavailable = 'TEMPORARILY_UNAVAILABLE';
  static const noPending = 'NO_PENDING';

  const PaystackKycRecovery({
    required this.state,
    required this.message,
    required this.supportReference,
    required this.pendingSince,
    required this.checkedAt,
    required this.retryAllowed,
  });

  final String state;
  final String message;
  final String supportReference;
  final DateTime? pendingSince;
  final DateTime? checkedAt;
  final bool retryAllowed;

  factory PaystackKycRecovery.fromJson(Map<String, dynamic> json) {
    final rawState = _asString(json['state']).toUpperCase();
    final state =
        _validStates.contains(rawState) ? rawState : temporarilyUnavailable;
    return PaystackKycRecovery(
      state: state,
      message: _asString(json['message'], fallback: _defaultMessage(state)),
      supportReference: _asString(json['supportReference']),
      pendingSince: _asDate(json['pendingSince']),
      checkedAt: _asDate(json['checkedAt']),
      retryAllowed: json['retryAllowed'] == true,
    );
  }

  static PaystackKycRecovery? fromNullable(dynamic value) {
    final map = _asMap(value);
    return map.isEmpty ? null : PaystackKycRecovery.fromJson(map);
  }

  /// The backend changes to ACTION_REQUIRED after the delayed-review SLA;
  /// keeping the age check client-side also makes older cached reads useful.
  bool get isDelayed {
    if (state == actionRequired || state == webhookRequested) return true;
    final started = pendingSince;
    if (started == null) return false;
    return DateTime.now().toUtc().difference(started.toUtc()) >=
        const Duration(hours: 24);
  }

  Map<String, dynamic> toJson() => {
        'state': state,
        'message': message,
        if (supportReference.isNotEmpty) 'supportReference': supportReference,
        if (pendingSince != null)
          'pendingSince': pendingSince!.toIso8601String(),
        if (checkedAt != null) 'checkedAt': checkedAt!.toIso8601String(),
        'retryAllowed': retryAllowed,
      };

  static const _validStates = {
    checking,
    awaitingProvider,
    actionRequired,
    webhookRequested,
    temporarilyUnavailable,
    noPending,
  };

  static String _defaultMessage(String state) {
    switch (state) {
      case checking:
        return 'Checking the provider status of your existing BVN request.';
      case awaitingProvider:
        return 'Your BVN is still being processed by the provider.';
      case actionRequired:
        return 'Your BVN check needs attention from support.';
      case webhookRequested:
        return 'We requested the provider update. Check again shortly.';
      case noPending:
        return 'No pending provider check was found.';
      default:
        return 'The provider status could not be checked right now.';
    }
  }
}

class KycVerificationResult {
  final String status;
  final String provider;
  final String reference;
  final String accountProvisioningStatus;

  const KycVerificationResult({
    required this.status,
    required this.provider,
    required this.reference,
    required this.accountProvisioningStatus,
  });

  factory KycVerificationResult.fromJson(Map<String, dynamic> json) {
    return KycVerificationResult(
      status: _normalizedStatus(
        _firstString(
          [json['verificationStatus'], json['status']],
          fallback: 'PENDING',
        ),
      ),
      provider: _displayProvider(
        _firstString([json['provider']], fallback: 'PAYSTACK'),
      ),
      reference: _firstString([
        json['reference'],
      ]),
      accountProvisioningStatus: _asString(
        _asMap(json['accountProvisioning'])['status'],
        fallback: 'NOT_REQUIRED',
      ),
    );
  }
}

String _firstString(List<dynamic> values, {String fallback = ''}) {
  for (final value in values) {
    final text = _asString(value);
    if (text.isNotEmpty) return text;
  }
  return fallback;
}

String _asString(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

List<dynamic> _asList(dynamic value) {
  if (value is List) return value;
  return const [];
}

DateTime? _asDate(dynamic value) {
  final text = _asString(value);
  if (text.isEmpty) return null;
  return DateTime.tryParse(text);
}

Uri? _readUri(Map<String, dynamic> json) {
  final value = _firstString([
    json['verificationUrl'],
    json['verificationURL'],
    json['hostedUrl'],
    json['hostedURL'],
    json['hostedLink'],
    json['url'],
    json['redirectUrl'],
    json['redirectURL'],
  ]);
  if (value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || !uri.hasScheme) return null;
  return uri;
}

String _normalizedStatus(String value) {
  final normalized = value.trim().toUpperCase().replaceAll('-', '_');
  if (normalized == 'PENDING' || normalized == 'NOT_STARTED') {
    return 'PENDING';
  }
  if (normalized == 'IN_REVIEW' || normalized == 'UNDER_REVIEW') {
    return 'PENDING_REVIEW';
  }
  return normalized.isEmpty ? 'PENDING' : normalized;
}

String _normalizedTier(String value) {
  final normalized = value.trim().toUpperCase().replaceAll('-', '_');
  if (normalized.startsWith('TIER_')) return normalized;
  if (RegExp(r'^[0-3]$').hasMatch(normalized)) return 'TIER_$normalized';
  return normalized.isEmpty ? 'TIER_0' : normalized;
}

String _displayProvider(String value) {
  final normalized = value.trim().toUpperCase().replaceAll('-', '_');
  if (normalized == 'PAYSTACK') return 'Paystack';
  if (normalized == 'MONNIFY') return 'Monnify';
  if (normalized == 'MANUAL_REVIEW') return 'Manual review';
  return 'Identity provider';
}

/// Keeps a signed upload and its submission key together until the backend
/// returns a definitive result. Retrying a lost response does not re-upload
/// evidence or create a second review request.
class ManualNinSubmission {
  ManualNinSubmission({required this.service});
  final KycService service;
  final _uploadAttempt = MoneyAttemptIdempotency();
  final _documentAttempt = MoneyAttemptIdempotency();
  String? _fingerprint;
  KycDocumentUpload? _upload;
  bool _uploaded = false;

  Future<KycVerificationResult> submit(
      {required String idNumber,
      required String fileName,
      required String contentType,
      required Uint8List bytes}) async {
    final fingerprint = sha256
        .convert(utf8.encode(jsonEncode([
          idNumber,
          fileName,
          contentType,
          sha256.convert(bytes).toString(),
        ])))
        .toString();
    if (_fingerprint != fingerprint) {
      _reset();
      _fingerprint = fingerprint;
    }
    try {
      _upload ??= await service.createDocumentUploadUrl(
          fileName: fileName,
          contentType: contentType,
          fileSize: bytes.length,
          idempotencyKey: _uploadAttempt.keyFor(fingerprint));
      if (!_uploaded) {
        await service.uploadDocumentBytes(
            upload: _upload!, contentType: contentType, bytes: bytes);
        _uploaded = true;
      }
      final result = await service.submitManualDocument(
          idempotencyKey: _documentAttempt.keyFor(fingerprint),
          idNumber: idNumber,
          objectKey: _upload!.objectKey,
          consentAccepted: true);
      _reset();
      return result;
    } on DioException catch (error) {
      final status = error.response?.statusCode ?? 0;
      if (status >= 400 && status < 500) _reset();
      rethrow;
    }
  }

  void _reset() {
    _upload = null;
    _uploaded = false;
    _fingerprint = null;
    _uploadAttempt.markFinalOutcome();
    _documentAttempt.markFinalOutcome();
  }
}

const kycPhoneValidationMessage =
    'Enter a valid Nigerian phone number, such as 0801 234 5678 or +2348012345678.';
const kycLockedProfileMessage =
    'Your saved identity details are protected. Contact support to correct your legal name or phone number.';

String? normalizeNigerianKycPhone(String value) {
  final compact = value.trim().replaceAll(RegExp(r'[\s()\-]'), '');
  if (RegExp(r'^0\d{10}$').hasMatch(compact)) {
    return '+234${compact.substring(1)}';
  }
  return RegExp(r'^\+234\d{10}$').hasMatch(compact) ? compact : null;
}

String? validateKycLegalName(String firstName, String lastName) {
  final first = firstName.trim(), last = lastName.trim();
  if (first.isEmpty || last.isEmpty) {
    return 'Enter your legal first and last name.';
  }
  final pattern = RegExp(r"^[A-Za-z][A-Za-z' -]*$");
  if (first.length > 80 ||
      last.length > 80 ||
      !pattern.hasMatch(first) ||
      !pattern.hasMatch(last)) {
    return 'Use letters, spaces, apostrophes or hyphens for your legal name.';
  }
  if ('$first $last'.length > 120) {
    return 'Your full legal name must be 120 characters or fewer.';
  }
  return null;
}

class KycProfileException implements Exception {
  const KycProfileException(this.message, {this.requiresSupport = false});
  final String message;
  final bool requiresSupport;
  @override
  String toString() => message;
}
