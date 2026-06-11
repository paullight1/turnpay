import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';

class KycService {
  KycService({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<KycOverview> fetchOverview() async {
    try {
      final response = await _apiClient.client.get<dynamic>('/api/kyc/status');
      return KycOverview.fromJson(_asMap(response.data));
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
        'provider': 'SMILE_ID',
        'kycStatus': _asString(userMap['kycStatus'], fallback: 'PENDING'),
        'kycTier': _asString(userMap['kycTier'], fallback: 'TIER_0'),
        'documents': documents.map((document) => document.toJson()).toList(),
      },
    );
  }

  Future<SmileKycSession> createSmileSession({
    required String idempotencyKey,
    String country = 'NG',
    String type = 'BVN',
  }) async {
    final options = Options(headers: {'Idempotency-Key': idempotencyKey});
    final request = {
      'country': country,
      'type': type,
      'consentAccepted': true,
    };

    final response = await _apiClient.client.post<dynamic>(
      '/api/kyc/smile-id/session',
      data: request,
      options: options,
    );
    return SmileKycSession.fromJson(_asMap(response.data));
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
}

class KycOverview {
  final String status;
  final String tier;
  final String provider;
  final String reference;
  final String failureReason;
  final Uri? verificationUri;
  final DateTime? updatedAt;
  final List<KycDocumentSummary> documents;

  const KycOverview({
    required this.status,
    required this.tier,
    required this.provider,
    required this.reference,
    required this.failureReason,
    required this.verificationUri,
    required this.updatedAt,
    required this.documents,
  });

  factory KycOverview.fromJson(Map<String, dynamic> json) {
    final user = _asMap(json['user']);
    final kyc = _asMap(json['kyc']);
    final latest = _asMap(
      json['latestVerification'] ?? json['verification'] ?? json['session'],
    );
    final documentsSource = json['documents'] is List
        ? _asList(json['documents'])
        : _asList(kyc['documents']);

    return KycOverview(
      status: _normalizedStatus(
        _firstString([
          json['status'],
          json['kycStatus'],
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
        ], fallback: 'SMILE_ID'),
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
    );
  }

  bool get isVerified => status == 'VERIFIED';
  bool get isRejected => status == 'REJECTED' || status == 'FAILED';
  bool get isSubmitted => status == 'SUBMITTED' || status == 'PENDING_REVIEW';

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
    if (isRejected) return 'Try again with Smile ID';
    return 'Start verification';
  }
}

class KycDocumentSummary {
  final String type;
  final String status;
  final DateTime? updatedAt;

  const KycDocumentSummary({
    required this.type,
    required this.status,
    required this.updatedAt,
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
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'type': type,
      'status': status,
      if (updatedAt != null) 'updatedAt': updatedAt!.toIso8601String(),
    };
  }
}

class SmileKycSession {
  final String id;
  final String reference;
  final Uri? verificationUri;
  final bool hasSdkToken;
  final String token;
  final String product;
  final String environment;
  final String callbackUrl;

  const SmileKycSession({
    required this.id,
    required this.reference,
    required this.verificationUri,
    required this.hasSdkToken,
    required this.token,
    required this.product,
    required this.environment,
    required this.callbackUrl,
  });

  factory SmileKycSession.fromJson(Map<String, dynamic> json) {
    final session = _asMap(json['session']);
    final source = session.isEmpty ? json : session;
    final document = _asMap(json['document']);
    final token = _firstString([
      source['token'],
      source['sdkToken'],
      source['clientToken'],
      source['accessToken'],
      json['token'],
    ]);
    final product = _firstString([
      source['product'],
      json['product'],
    ], fallback: 'biometric_kyc');
    final environment = _firstString([
      source['environment'],
      json['environment'],
    ], fallback: 'sandbox');
    final callbackUrl = _firstString([
      source['callbackUrl'],
      source['callbackURL'],
      json['callbackUrl'],
      json['callbackURL'],
    ]);
    return SmileKycSession(
      id: _firstString([
        source['id'],
        source['sessionId'],
        document['id'],
        json['id'],
      ]),
      reference: _firstString([
        source['reference'],
        source['providerReference'],
        source['jobId'],
        source['job_id'],
        json['reference'],
      ]),
      verificationUri: _readUri(source) ??
          _readUri(json) ??
          _buildSmileLauncherUri(
            token: token,
            product: product,
            environment: environment,
            callbackUrl: callbackUrl,
          ),
      hasSdkToken: token.isNotEmpty,
      token: token,
      product: product,
      environment: environment,
      callbackUrl: callbackUrl,
    );
  }

  bool get canOpen => verificationUri != null;
}

Uri? _buildSmileLauncherUri({
  required String token,
  required String product,
  required String environment,
  required String callbackUrl,
}) {
  if (!kIsWeb || token.isEmpty || callbackUrl.isEmpty) return null;

  final base = Uri.base.resolve('/smile-id.html');
  final fragment = Uri(
    queryParameters: {
      'token': token,
      'product': product,
      'environment':
          environment.toLowerCase() == 'production' ? 'production' : 'sandbox',
      'callback_url': callbackUrl,
    },
  ).query;

  return base.replace(fragment: fragment);
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
  if (normalized == 'SMILE' || normalized == 'SMILE_ID') return 'Smile ID';
  if (normalized == 'MANUAL_REVIEW') return 'Manual review';
  return value.replaceAll('_', ' ');
}
