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
  final String price;
  final String validity;
  final String serviceType;

  const VtuPackageOption({
    required this.id,
    required this.name,
    required this.price,
    required this.validity,
    required this.serviceType,
  });

  factory VtuPackageOption.fromJson(Map<String, dynamic> json) {
    return VtuPackageOption(
      id: '${json['id']}',
      name: '${json['name'] ?? json['id']}',
      price: '${json['price'] ?? '0'}',
      validity: '${json['validity'] ?? ''}',
      serviceType: '${json['serviceType'] ?? ''}',
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
  final String? purchasedCode;
  final bool actionRequired;
  final String? customerAction;
  final String? type;
  final String? fee;
  final String? totalDebit;
  final DateTime? createdAt;

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
    required this.purchasedCode,
    this.actionRequired = false,
    this.customerAction,
    this.type,
    this.fee,
    this.totalDebit,
    this.createdAt,
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
      purchasedCode: json['purchasedCode'] as String?,
      actionRequired: json['actionRequired'] == true,
      customerAction: json['customerAction'] as String?,
      type: json['type'] as String?,
      fee: json['fee']?.toString(),
      totalDebit: json['totalDebit']?.toString(),
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
    );
  }
}

class VtuMeterCustomer {
  final String name;
  final String address;

  const VtuMeterCustomer({required this.name, required this.address});
}

class VtuCardCustomer {
  final String name;
  final String status;
  final String? renewalAmount;

  const VtuCardCustomer({
    required this.name,
    required this.status,
    required this.renewalAmount,
  });
}

class VtuPurchaseReceipt {
  final bool success;
  final String status;
  final String reference;
  final String orderId;
  final String amount;
  final String fee;
  final String totalDebit;
  final String? purchasedCode;

  const VtuPurchaseReceipt({
    required this.success,
    required this.status,
    required this.reference,
    required this.orderId,
    required this.amount,
    required this.fee,
    required this.totalDebit,
    required this.purchasedCode,
  });

  factory VtuPurchaseReceipt.fromJson(Map<String, dynamic> json) {
    return VtuPurchaseReceipt(
      success: json['success'] == true,
      status: '${json['status'] ?? ''}',
      reference: '${json['reference'] ?? ''}',
      orderId: '${json['orderId'] ?? ''}',
      amount: '${json['amount'] ?? ''}',
      fee: '${json['fee'] ?? '0'}',
      totalDebit: '${json['totalDebit'] ?? ''}',
      purchasedCode: json['purchasedCode'] as String?,
    );
  }
}

class VtuService {
  VtuService({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<List<VtuProviderOption>> getProviders(String type) async {
    final response = await _apiClient.client.get<List<dynamic>>(
      '/api/vtu/providers',
      queryParameters: {'type': type, 'catalog': 'extended'},
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
    required String meterType,
    required String contactPhone,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.client.post<Map<String, dynamic>>(
      '/api/vtu/validate/meter',
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: {
        'provider': provider,
        'meterNumber': meterNumber,
        'meterType': meterType,
        'contactPhone': contactPhone,
      },
    );

    final data = response.data ?? const {};
    return VtuMeterCustomer(
      name: '${data['name'] ?? ''}'.trim(),
      address: '${data['address'] ?? ''}'.trim(),
    );
  }

  Future<VtuCardCustomer> validateSmartCard({
    required String provider,
    required String smartCardNumber,
    required String subscriptionType,
    required String contactPhone,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.client.post<Map<String, dynamic>>(
      '/api/vtu/validate/smartcard',
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: {
        'provider': provider,
        'smartCardNumber': smartCardNumber,
        'subscriptionType': subscriptionType,
        'contactPhone': contactPhone,
      },
    );

    final data = response.data ?? const {};
    return VtuCardCustomer(
      name: '${data['name'] ?? ''}'.trim(),
      status: '${data['status'] ?? ''}'.trim(),
      renewalAmount: data['renewalAmount'] == null
          ? null
          : '${data['renewalAmount']}'.trim(),
    );
  }

  Future<VtuPurchaseReceipt> purchase({
    required Map<String, dynamic> data,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.client.post<Map<String, dynamic>>(
      '/api/vtu/purchase',
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: data,
    );
    return VtuPurchaseReceipt.fromJson(response.data ?? const {});
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
