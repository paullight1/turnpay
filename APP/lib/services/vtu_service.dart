import 'package:dio/dio.dart';

import 'api_client.dart';

class VtuProviderOption {
  final String id;
  final String name;
  final String type;
  final bool isActive;

  const VtuProviderOption({
    required this.id,
    required this.name,
    required this.type,
    required this.isActive,
  });

  factory VtuProviderOption.fromJson(Map<String, dynamic> json) {
    final rawId = json['id'] ?? json['operatorId'] ?? json['operator_id'];
    final id = rawId == null ? '' : '$rawId';
    return VtuProviderOption(
      id: id,
      name: '${json['name'] ?? id}',
      type: '${json['type'] ?? ''}',
      isActive: json['isActive'] != false,
    );
  }
}

class VtuPackageOption {
  final String id;
  final String name;
  final num price;
  final String validity;

  const VtuPackageOption({
    required this.id,
    required this.name,
    required this.price,
    required this.validity,
  });

  factory VtuPackageOption.fromJson(Map<String, dynamic> json) {
    final rawPrice = json['price'];
    return VtuPackageOption(
      id: '${json['id']}',
      name: '${json['name'] ?? json['id']}',
      price: rawPrice is num
          ? rawPrice
          : num.tryParse('${rawPrice ?? 0}') ?? 0,
      validity: '${json['validity'] ?? ''}',
    );
  }
}

class VtuOrderStatus {
  final String orderId;
  final String reference;
  final String orderStatus;
  final String transactionStatus;
  final String provider;
  final String amount;
  final String currency;
  final String? targetMasked;
  final String? nextRequeryAt;

  const VtuOrderStatus({
    required this.orderId,
    required this.reference,
    required this.orderStatus,
    required this.transactionStatus,
    required this.provider,
    required this.amount,
    required this.currency,
    required this.targetMasked,
    required this.nextRequeryAt,
  });

  factory VtuOrderStatus.fromJson(Map<String, dynamic> json) {
    return VtuOrderStatus(
      orderId: '${json['orderId']}',
      reference: '${json['reference']}',
      orderStatus: '${json['orderStatus']}',
      transactionStatus: '${json['transactionStatus']}',
      provider: '${json['provider']}',
      amount: '${json['amount']}',
      currency: '${json['currency']}',
      targetMasked: json['targetMasked'] as String?,
      nextRequeryAt: json['nextRequeryAt'] as String?,
    );
  }
}

class VtuMeterCustomer {
  final String name;
  final String address;

  const VtuMeterCustomer({required this.name, required this.address});
}

class VtuService {
  VtuService({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<List<VtuProviderOption>> getProviders(
    String type, {
    String? scope,
    String? countryCode,
  }) async {
    final response = await _apiClient.client.get<List<dynamic>>(
      '/api/vtu/providers',
      queryParameters: {
        'type': type,
        if (scope != null) 'scope': scope,
        if (countryCode != null) 'countryCode': countryCode,
      },
    );

    return (response.data ?? [])
        .whereType<Map>()
        .map((item) => VtuProviderOption.fromJson(
              Map<String, dynamic>.from(item),
            ))
        .where((provider) => provider.id.isNotEmpty)
        .where((provider) => provider.isActive)
        .toList();
  }

  Future<List<VtuPackageOption>> getPackages(String provider) async {
    final response = await _apiClient.client.get<List<dynamic>>(
      '/api/vtu/packages',
      queryParameters: {'provider': provider},
    );

    return (response.data ?? [])
        .whereType<Map>()
        .map((item) => VtuPackageOption.fromJson(
              Map<String, dynamic>.from(item),
            ))
        .toList();
  }

  Future<VtuMeterCustomer> validateMeter({
    required String provider,
    required String meterNumber,
  }) async {
    final response = await _apiClient.client.post<Map<String, dynamic>>(
      '/api/vtu/validate/meter',
      queryParameters: {'provider': provider, 'number': meterNumber},
      data: const {},
    );

    final data = response.data ?? const {};
    return VtuMeterCustomer(
      name: '${data['name'] ?? ''}'.trim(),
      address: '${data['address'] ?? ''}'.trim(),
    );
  }

  Future<VtuOrderStatus> requeryOrder(
    String reference, {
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.client.post<Map<String, dynamic>>(
      '/api/vtu/orders/${Uri.encodeComponent(reference)}/requery',
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: const {},
    );

    return VtuOrderStatus.fromJson(response.data ?? const {});
  }

  Future<VtuOrderStatus> getOrderStatus(String reference) async {
    final response = await _apiClient.client.get<Map<String, dynamic>>(
      '/api/vtu/orders/${Uri.encodeComponent(reference)}',
    );

    return VtuOrderStatus.fromJson(response.data ?? const {});
  }
}
