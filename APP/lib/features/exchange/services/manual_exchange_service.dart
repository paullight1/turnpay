import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../../../services/api_client.dart';
import '../../../core/money/money_value.dart';
import '../../../services/auth_service.dart';
import 'receipt_scan_images.dart';

const int manualExchangeMaxProofBytes = 8 * 1024 * 1024;

typedef ManualReceiptDetails = ({String? receiptName, String? bankReference});

enum ManualSettlementMode { wallet, bank, momo }

class ManualGhanaPayoutCapabilities {
  final bool enabled;
  final bool momoPayouts;
  final bool bankPayouts;

  const ManualGhanaPayoutCapabilities({
    required this.enabled,
    required this.momoPayouts,
    required this.bankPayouts,
  });

  factory ManualGhanaPayoutCapabilities.fromJson(Map<String, dynamic> json) {
    return ManualGhanaPayoutCapabilities(
      enabled: json['enabled'] == true,
      momoPayouts: json['momoPayouts'] == true,
      bankPayouts: json['bankPayouts'] == true,
    );
  }
}

class ManualGhanaMomoOperator {
  final String slug;
  final String name;

  const ManualGhanaMomoOperator({required this.slug, required this.name});

  factory ManualGhanaMomoOperator.fromJson(Map<String, dynamic> json) {
    final slug = _requiredString(json['slug'], 'MoMo operator slug');
    if (!RegExp(r'^[a-z0-9-]{2,32}$').hasMatch(slug)) {
      throw const FormatException('Invalid Ghana MoMo operator.');
    }
    return ManualGhanaMomoOperator(
      slug: slug,
      name: _requiredString(json['name'], 'MoMo operator name'),
    );
  }
}

class ManualGhanaRecipientResolution {
  final String name;
  final String number;
  final String operator;

  const ManualGhanaRecipientResolution({
    required this.name,
    required this.number,
    required this.operator,
  });

  factory ManualGhanaRecipientResolution.fromJson(Map<String, dynamic> json) {
    final name = _requiredString(json['name'], 'recipient name');
    if (name.length < 2 || name.length > 120) {
      throw const FormatException(
          'The MoMo recipient name could not be verified.');
    }
    final number = _requiredString(json['number'], 'recipient number');
    final operator = _requiredString(json['operator'], 'recipient operator');
    return ManualGhanaRecipientResolution(
      name: name,
      number: number,
      operator: operator,
    );
  }
}

final _nigerianBankCode = RegExp(r'^[A-Za-z0-9_-]{1,32}$');

class ManualNigerianBankOption {
  final String name;
  final String code;

  const ManualNigerianBankOption({required this.name, required this.code});

  factory ManualNigerianBankOption.fromJson(Map<String, dynamic> json) {
    final name = _requiredString(json['name'], 'Nigerian bank name');
    final code = _requiredString(json['code'], 'Nigerian bank code');
    if (name.length > 120 || !_nigerianBankCode.hasMatch(code)) {
      throw const FormatException('Invalid Nigerian bank option.');
    }
    return ManualNigerianBankOption(name: name, code: code);
  }
}

class ManualNigerianBankResolution {
  final String accountName;
  final String accountNumber;
  final String bankCode;

  const ManualNigerianBankResolution({
    required this.accountName,
    required this.accountNumber,
    required this.bankCode,
  });
}

extension ManualSettlementModeX on ManualSettlementMode {
  String get value {
    switch (this) {
      case ManualSettlementMode.wallet:
        return 'WALLET';
      case ManualSettlementMode.bank:
        return 'BANK';
      case ManualSettlementMode.momo:
        return 'MOMO';
    }
  }

  String get label {
    switch (this) {
      case ManualSettlementMode.wallet:
        return 'TrustPay wallet';
      case ManualSettlementMode.bank:
        return 'Bank account';
      case ManualSettlementMode.momo:
        return 'Mobile money';
    }
  }
}

ManualSettlementMode manualSettlementModeFromValue(dynamic value) {
  final normalized = '$value'.trim().toUpperCase();
  switch (normalized) {
    case 'WALLET':
      return ManualSettlementMode.wallet;
    case 'BANK':
      return ManualSettlementMode.bank;
    case 'MOMO':
      return ManualSettlementMode.momo;
    default:
      throw FormatException(
        'Unsupported exchange settlement mode: $normalized',
      );
  }
}

enum ManualExchangeOrderStatus {
  awaitingTransfer,
  awaitingConfirmation,
  credited,
  payoutPending,
  payoutProcessing,
  payoutSent,
  completed,
  needsMoreInfo,
  rejected,
  unknown,
}

ManualExchangeOrderStatus manualExchangeOrderStatusFromValue(dynamic value) {
  switch ('$value'.trim().toUpperCase()) {
    case 'AWAITING_TRANSFER':
      return ManualExchangeOrderStatus.awaitingTransfer;
    case 'AWAITING_CONFIRMATION':
      return ManualExchangeOrderStatus.awaitingConfirmation;
    case 'CREDITED':
      return ManualExchangeOrderStatus.credited;
    case 'PAYOUT_PENDING':
      return ManualExchangeOrderStatus.payoutPending;
    case 'PAYOUT_PROCESSING':
      return ManualExchangeOrderStatus.payoutProcessing;
    case 'PAYOUT_SENT':
      return ManualExchangeOrderStatus.payoutSent;
    case 'COMPLETED':
      return ManualExchangeOrderStatus.completed;
    case 'NEEDS_MORE_INFO':
      return ManualExchangeOrderStatus.needsMoreInfo;
    case 'REJECTED':
      return ManualExchangeOrderStatus.rejected;
    default:
      return ManualExchangeOrderStatus.unknown;
  }
}

String manualExchangeStatusLabel(ManualExchangeOrderStatus status) {
  switch (status) {
    case ManualExchangeOrderStatus.awaitingTransfer:
      return 'Awaiting your transfer';
    case ManualExchangeOrderStatus.awaitingConfirmation:
      return 'Awaiting admin review';
    case ManualExchangeOrderStatus.credited:
      return 'Credited to wallet';
    case ManualExchangeOrderStatus.payoutPending:
      return 'Deposit confirmed — payout pending';
    case ManualExchangeOrderStatus.payoutProcessing:
      return 'Payout being processed';
    case ManualExchangeOrderStatus.payoutSent:
      return 'Payout sent';
    case ManualExchangeOrderStatus.completed:
      return 'Completed';
    case ManualExchangeOrderStatus.needsMoreInfo:
      return 'More information needed';
    case ManualExchangeOrderStatus.rejected:
      return 'Rejected';
    case ManualExchangeOrderStatus.unknown:
      return 'Awaiting confirmation';
  }
}

String manualExchangeStatusDescription(ManualExchangeOrderStatus status) {
  switch (status) {
    case ManualExchangeOrderStatus.awaitingTransfer:
      return 'Transfer the exact amount to the receiving account below, then submit your receipt.';
    case ManualExchangeOrderStatus.awaitingConfirmation:
      return 'Your receipt is with our team. We’ll check the payment before completing this exchange. Do not make another transfer.';
    case ManualExchangeOrderStatus.credited:
      return 'The confirmed exchange amount has been added to your TrustPay wallet.';
    case ManualExchangeOrderStatus.payoutPending:
      return 'Your deposit is confirmed. The payout is waiting to be sent to your selected destination.';
    case ManualExchangeOrderStatus.payoutProcessing:
      return 'An operator is processing the payout to your selected destination.';
    case ManualExchangeOrderStatus.payoutSent:
      return 'The payout has been sent. We are checking the settlement evidence.';
    case ManualExchangeOrderStatus.completed:
      return 'This exchange is complete.';
    case ManualExchangeOrderStatus.needsMoreInfo:
      return 'Our team needs more information before this exchange can continue.';
    case ManualExchangeOrderStatus.rejected:
      return 'This exchange was rejected. Contact support if you need help.';
    case ManualExchangeOrderStatus.unknown:
      return 'We are checking this exchange with our team.';
  }
}

bool manualExchangeStatusIsActive(ManualExchangeOrderStatus status) {
  return status == ManualExchangeOrderStatus.awaitingTransfer ||
      status == ManualExchangeOrderStatus.awaitingConfirmation ||
      status == ManualExchangeOrderStatus.needsMoreInfo ||
      status == ManualExchangeOrderStatus.payoutPending ||
      status == ManualExchangeOrderStatus.payoutProcessing ||
      status == ManualExchangeOrderStatus.payoutSent ||
      status == ManualExchangeOrderStatus.unknown;
}

class ManualExchangeConfig {
  final bool enabled;
  final String sourceCurrency;
  final String targetCurrency;
  final List<String> supportedSourceCurrencies;
  final List<String>? availableSourceCurrencies;
  final Map<String, List<ManualSettlementMode>> settlementOptions;
  final int deliveryPolicyVersion;

  const ManualExchangeConfig({
    required this.enabled,
    required this.sourceCurrency,
    required this.targetCurrency,
    this.supportedSourceCurrencies = const ['NGN'],
    this.availableSourceCurrencies,
    this.deliveryPolicyVersion = 2,
    this.settlementOptions = const {
      'GHS': [ManualSettlementMode.bank],
      'NGN': [ManualSettlementMode.momo, ManualSettlementMode.bank]
    },
  });

  bool canExchangeFrom(String currency) =>
      enabled &&
      supportedSourceCurrencies.contains(currency) &&
      deliveryModesFor(currency).isNotEmpty &&
      (availableSourceCurrencies?.contains(currency) ?? true);

  List<ManualSettlementMode> deliveryModesFor(String currency) =>
      List.unmodifiable((settlementOptions[currency] ??
              const <ManualSettlementMode>[])
          .where((mode) =>
              mode != ManualSettlementMode.wallet &&
              (currency != 'GHS' || deliveryPolicyVersion == 2)));

  factory ManualExchangeConfig.fromJson(Map<String, dynamic> json) {
    Map<String, List<ManualSettlementMode>>? options;
    final raw = json['settlementOptions'];
    if (raw != null) {
      if (raw is! Map) {
        throw const FormatException(
            'Exchange receiving options could not be read.');
      }
      options = {};
      for (final currency
          in (json['supportedSourceCurrencies'] as List? ?? const ['NGN'])) {
        final value = raw[currency];
        if (value is! List || value.isEmpty) {
          throw const FormatException(
              'Exchange receiving options are unavailable.');
        }
        options['$currency'] = List.unmodifiable(value.map((item) =>
            manualSettlementModeFromValue(
                _requiredString(item, 'receiving option'))));
      }
    }
    final supported = (json['supportedSourceCurrencies'] as List?)
            ?.map((value) =>
                _currencyValue(value, fieldName: 'supported source currency'))
            .toList() ??
        const ['NGN'];
    final rawAvailable = json['availableSourceCurrencies'];
    List<String>? available;
    if (json.containsKey('availableSourceCurrencies')) {
      if (rawAvailable is! List) {
        throw const FormatException('Exchange availability could not be read.');
      }
      available = rawAvailable
          .map((value) =>
              _currencyValue(value, fieldName: 'available source currency'))
          .toList();
      if (available.any((currency) => !supported.contains(currency))) {
        throw const FormatException('Exchange availability could not be read.');
      }
    }
    final policyVersion = json['deliveryPolicyVersion'];
    if (policyVersion != null && policyVersion is! int) {
      throw const FormatException(
          'Exchange receiving policy could not be read.');
    }
    return ManualExchangeConfig(
      deliveryPolicyVersion: policyVersion is int ? policyVersion : 1,
      availableSourceCurrencies:
          available == null ? null : List.unmodifiable(available),
      enabled: _requiredBool(json['enabled'], 'exchange availability'),
      settlementOptions: options == null
          ? const {
              'GHS': [ManualSettlementMode.wallet],
              'NGN': [ManualSettlementMode.momo, ManualSettlementMode.bank]
            }
          : Map.unmodifiable(options),
      supportedSourceCurrencies: List.unmodifiable(supported),
      sourceCurrency: _currencyValue(
        json['sourceCurrency'],
        fieldName: 'source currency',
      ),
      targetCurrency: _currencyValue(
        json['targetCurrency'],
        fieldName: 'target currency',
      ),
    );
  }
}

class ManualCollectionAccount {
  final String bankName;
  final String accountName;
  final String accountNumber;
  final String currency;
  final String version;

  const ManualCollectionAccount({
    required this.bankName,
    required this.accountName,
    required this.accountNumber,
    required this.currency,
    required this.version,
  });

  factory ManualCollectionAccount.fromJson(Map<String, dynamic> json) {
    final accountNumber =
        _requiredString(json['accountNumber'], 'collection account number');
    if (!RegExp(r'^\d{10}$').hasMatch(accountNumber)) {
      throw const FormatException(
        'Invalid collection account number in exchange response.',
      );
    }
    return ManualCollectionAccount(
      bankName: _requiredString(json['bankName'], 'collection bank name'),
      accountName:
          _requiredString(json['accountName'], 'collection account name'),
      accountNumber: accountNumber,
      currency: _currencyValue(
        json['currency'],
        fieldName: 'collection account currency',
      ),
      version: _requiredString(json['version'], 'collection account version'),
    );
  }
}

class ManualExchangeOrderEvent {
  final ManualExchangeOrderStatus status;
  final String reason;
  final DateTime? createdAt;

  const ManualExchangeOrderEvent({
    required this.status,
    required this.reason,
    required this.createdAt,
  });

  factory ManualExchangeOrderEvent.fromJson(Map<String, dynamic> json) {
    return ManualExchangeOrderEvent(
      status: manualExchangeOrderStatusFromValue(json['status']),
      reason: _requiredString(json['reason'], 'exchange event reason'),
      createdAt: _requiredDate(json['createdAt'], 'exchange event date'),
    );
  }
}

class ManualExchangeOrder {
  final String id;
  final String reference;
  final ManualExchangeOrderStatus status;
  final ManualSettlementMode settlementMode;
  final String sourceCurrency;
  final String targetCurrency;
  final String amount;
  final String targetAmount;
  final String rate;
  final String fee;
  final ManualCollectionAccount? collectionAccount;
  final DateTime? expiresAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String? reviewReason;
  final String? destinationInstitution;
  final String? destinationAccountMasked;
  final String? destinationName;
  final String? receiptName;
  final bool supportsReceiptName;
  final String? bankReference;
  final String? depositReference;
  final String? payoutReference;
  final String? payoutClaimedBy;
  final bool hasProof;
  final bool hasPayoutProof;
  final bool reviewRemindersEnabled;
  final DateTime? reviewReminderNextAllowedAt;
  final List<ManualExchangeOrderEvent> events;

  const ManualExchangeOrder({
    required this.id,
    required this.reference,
    required this.status,
    required this.settlementMode,
    required this.sourceCurrency,
    required this.targetCurrency,
    required this.amount,
    required this.targetAmount,
    required this.rate,
    required this.fee,
    required this.collectionAccount,
    required this.expiresAt,
    required this.createdAt,
    required this.updatedAt,
    required this.reviewReason,
    required this.destinationInstitution,
    required this.destinationAccountMasked,
    required this.destinationName,
    this.receiptName,
    this.supportsReceiptName = false,
    required this.bankReference,
    required this.depositReference,
    required this.payoutReference,
    required this.payoutClaimedBy,
    required this.hasProof,
    required this.hasPayoutProof,
    this.reviewRemindersEnabled = false,
    this.reviewReminderNextAllowedAt,
    required this.events,
  });

  factory ManualExchangeOrder.fromJson(Map<String, dynamic> json) {
    final events = json['events'];
    final account = json['collectionAccount'];
    if (account is! Map) {
      throw const FormatException(
        'Invalid exchange order: collection account is missing.',
      );
    }
    if (events is! List) {
      throw const FormatException(
        'Invalid exchange order: event history is missing.',
      );
    }
    return ManualExchangeOrder(
      id: _requiredString(json['id'], 'exchange order id'),
      reference: _requiredString(json['reference'], 'exchange order reference'),
      status: manualExchangeOrderStatusFromValue(json['status']),
      settlementMode: manualSettlementModeFromValue(json['settlementMode']),
      sourceCurrency: _currencyValue(
        json['sourceCurrency'],
        fieldName: 'exchange source currency',
      ),
      targetCurrency: _currencyValue(
        json['targetCurrency'],
        fieldName: 'exchange target currency',
      ),
      amount: _decimalValue(
        json['amount'],
        fieldName: 'exchange amount',
        scale: 2,
        mustBePositive: true,
      ),
      targetAmount: _decimalValue(
        json['targetAmount'],
        fieldName: 'exchange target amount',
        scale: 2,
        mustBePositive: true,
      ),
      rate: _decimalValue(
        json['rate'],
        fieldName: 'exchange rate',
        scale: 6,
        mustBePositive: true,
      ),
      fee: _decimalValue(
        json['fee'],
        fieldName: 'exchange fee',
        scale: 2,
      ),
      collectionAccount: ManualCollectionAccount.fromJson(_mapValue(account)),
      expiresAt: _requiredDate(json['expiresAt'], 'exchange expiry'),
      createdAt: _requiredDate(json['createdAt'], 'exchange creation date'),
      updatedAt: _requiredDate(json['updatedAt'], 'exchange update date'),
      reviewReason: _nullableString(json['reviewReason'], 'review reason'),
      destinationInstitution: _nullableString(
          json['destinationInstitution'], 'destination institution'),
      destinationAccountMasked: _nullableString(
        json['destinationAccountMasked'],
        'masked destination account',
      ),
      destinationName:
          _nullableString(json['destinationName'], 'destination name'),
      receiptName: _nullableString(json['receiptName'], 'name on receipt'),
      supportsReceiptName: json.containsKey('receiptName'),
      bankReference: _nullableString(json['bankReference'], 'bank reference'),
      depositReference:
          _nullableString(json['depositReference'], 'deposit reference'),
      payoutReference:
          _nullableString(json['payoutReference'], 'payout reference'),
      payoutClaimedBy:
          _nullableString(json['payoutClaimedBy'], 'payout claimant'),
      hasProof: _requiredBool(json['hasProof'], 'proof availability'),
      hasPayoutProof:
          _requiredBool(json['hasPayoutProof'], 'payout proof availability'),
      reviewRemindersEnabled: json['reviewRemindersEnabled'] == true,
      reviewReminderNextAllowedAt: json['reviewReminderNextAllowedAt'] == null
          ? null
          : _requiredDate(json['reviewReminderNextAllowedAt'],
              'review reminder availability'),
      events: events.map((event) {
        if (event is! Map) {
          throw const FormatException(
            'Invalid exchange order: event history contains a malformed record.',
          );
        }
        return ManualExchangeOrderEvent.fromJson(_mapValue(event));
      }).toList(growable: false),
    );
  }

  bool get canRequestReviewReminder =>
      reviewRemindersEnabled &&
      hasProof &&
      const [
        ManualExchangeOrderStatus.awaitingConfirmation,
        ManualExchangeOrderStatus.payoutPending,
        ManualExchangeOrderStatus.payoutProcessing,
        ManualExchangeOrderStatus.payoutSent,
      ].contains(status);

  bool get canSubmitProof =>
      status == ManualExchangeOrderStatus.awaitingTransfer ||
      status == ManualExchangeOrderStatus.awaitingConfirmation ||
      status == ManualExchangeOrderStatus.needsMoreInfo;
}

class ManualUploadUrl {
  final String signedUrl;
  final String objectKey;
  final String token;

  const ManualUploadUrl({
    required this.signedUrl,
    required this.objectKey,
    required this.token,
  });

  factory ManualUploadUrl.fromJson(Map<String, dynamic> json) {
    return ManualUploadUrl(
      signedUrl: _requiredString(json['signedUrl'], 'signed upload URL'),
      objectKey: _requiredString(json['objectKey'], 'uploaded object key'),
      token: _requiredString(json['token'], 'upload token'),
    );
  }
}

class ManualExchangeProofFile {
  final String fileName;
  final String contentType;
  final Uint8List bytes;

  const ManualExchangeProofFile({
    required this.fileName,
    required this.contentType,
    required this.bytes,
  });

  int get fileSize => bytes.length;
}

class ManualExchangeReminder {
  final DateTime requestedAt, nextAllowedAt;
  const ManualExchangeReminder(
      {required this.requestedAt, required this.nextAllowedAt});
  factory ManualExchangeReminder.fromJson(Map<String, dynamic> json) =>
      ManualExchangeReminder(
        requestedAt: _requiredDate(json['requestedAt'], 'review reminder time'),
        nextAllowedAt: _requiredDate(
            json['nextAllowedAt'], 'review reminder availability'),
      );

  static DateTime? cooldownFromError(Object error) {
    if (error is! DioException || error.response?.statusCode != 429) {
      return null;
    }
    final data = _mapValue(error.response?.data);
    // The shared Nest exception filter wraps structured exception fields under
    // message. Also accept an unwrapped response for compatible deployments.
    final raw =
        data['nextAllowedAt'] ?? _mapValue(data['message'])['nextAllowedAt'];
    return raw is String ? DateTime.tryParse(raw) : null;
  }
}

class ManualExchangeAttempt {
  final String action;
  final String fingerprint;
  final String key;
  final String? orderId;

  const ManualExchangeAttempt({
    required this.action,
    required this.fingerprint,
    required this.key,
    required this.orderId,
  });

  factory ManualExchangeAttempt.fromJson(Map<String, dynamic> json) {
    return ManualExchangeAttempt(
      action: _attemptAction(json['action']),
      fingerprint: _requiredFingerprint(json['fingerprint']),
      key: _attemptKey(json['key']),
      orderId: _nullableString(json['orderId'], 'retry order id'),
    );
  }

  Map<String, dynamic> toJson() => {
        'action': action,
        'fingerprint': fingerprint,
        'key': key,
        if (orderId != null) 'orderId': orderId,
      };
}

typedef ManualExchangeAccountScope = Future<String?> Function();

/// Stores only retry metadata. It deliberately never stores the transaction
/// PIN, receipt bytes, signed URL, or upload token.
class ManualExchangeAttemptStore {
  static const _accessTokenKey = 'trustpay_access_token';
  static const _storagePrefix = 'trustpay_manual_exchange_attempts_v1_';
  static const _uuid = Uuid();
  static final Map<String, Future<void>> _storageLocks = {};

  final FlutterSecureStorage storage;
  final ManualExchangeAccountScope? accountScopeProvider;

  ManualExchangeAttemptStore({
    FlutterSecureStorage? storage,
    this.accountScopeProvider,
  }) : storage = storage ?? const FlutterSecureStorage();

  Future<void> rememberExchangeOrder(String orderId) async {
    final scope = await _storageKey();
    await storage.write(
        key: '${scope}_latest_exchange',
        value: _requireText(orderId, 'order id'));
  }

  Future<String?> latestExchangeOrderId() async {
    final scope = await _storageKey();
    return await storage.read(key: '${scope}_receipt_order') ??
        await storage.read(key: '${scope}_latest_exchange');
  }

  Future<bool> receiptStepStarted(String orderId) async {
    final scope = await _storageKey();
    final order =
        sha256.convert(utf8.encode(_requireText(orderId, 'order id')));
    return await storage.read(key: '${scope}_receipt_$order') == 'true';
  }

  Future<String?> pendingReceiptOrderId() async {
    final scope = await _storageKey();
    return storage.read(key: '${scope}_receipt_order');
  }

  Future<void> markReceiptStepStarted(String orderId) async {
    final id = _requireText(orderId, 'order id');
    final scope = await _storageKey();
    final order = sha256.convert(utf8.encode(id));
    await _withStorageLock(scope, () async {
      await storage.write(key: '${scope}_receipt_$order', value: 'true');
      await storage.write(key: '${scope}_receipt_order', value: id);
    });
  }

  Future<void> clearReceiptStep(String orderId) async {
    final scope = await _storageKey();
    final order =
        sha256.convert(utf8.encode(_requireText(orderId, 'order id')));
    await _withStorageLock(scope, () async {
      await storage.delete(key: '${scope}_receipt_$order');
      if (await storage.read(key: '${scope}_receipt_order') == orderId) {
        await storage.delete(key: '${scope}_receipt_order');
      }
    });
  }

  Future<List<ManualExchangeAttempt>> readAttempts() async {
    final storageKey = await _storageKey();
    return _withStorageLock(
      storageKey,
      () => _readAttempts(storageKey),
    );
  }

  Future<List<ManualExchangeAttempt>> pendingCreates() async {
    final attempts = await readAttempts();
    return attempts.where((attempt) => attempt.action == 'create').toList();
  }

  Future<List<ManualExchangeAttempt>> readForOrder({
    required String action,
    required String orderId,
  }) async {
    final normalizedAction = _requiredString(action, 'retry action');
    final normalizedOrderId = _requiredString(orderId, 'order id');
    final storageKey = await _storageKey();
    return _withStorageLock(storageKey, () async {
      return (await _readAttempts(storageKey))
          .where((attempt) =>
              attempt.action == normalizedAction &&
              attempt.orderId == normalizedOrderId)
          .toList(growable: false);
    });
  }

  Future<String> keyFor({
    required String action,
    required String fingerprint,
    String? orderId,
  }) async {
    final normalizedAction = _requiredString(action, 'retry action');
    final normalizedFingerprint = _requiredFingerprint(fingerprint);
    final normalizedOrderId =
        orderId == null ? null : _requiredString(orderId, 'order id');
    final storageKey = await _storageKey();

    return _withStorageLock(storageKey, () async {
      final attempts = (await _readAttempts(storageKey)).toList();
      final match = attempts.where((attempt) {
        return attempt.action == normalizedAction &&
            attempt.fingerprint == normalizedFingerprint &&
            attempt.orderId == normalizedOrderId;
      });
      if (match.isNotEmpty) return match.first.key;

      // Provider-specific flows still recover one outstanding create at a time.
      if (normalizedAction.endsWith('-create') &&
          attempts.any((attempt) => attempt.action == normalizedAction)) {
        throw const FormatException(
          'A previous exchange attempt is still pending. Retry it before starting another exchange.',
        );
      }

      final key = _uuid.v4();
      attempts.add(ManualExchangeAttempt(
        action: normalizedAction,
        fingerprint: normalizedFingerprint,
        key: key,
        orderId: normalizedOrderId,
      ));
      await _writeAttempts(storageKey, attempts);
      return key;
    });
  }

  Future<void> resolve({
    required String action,
    required String fingerprint,
    String? orderId,
  }) async {
    final normalizedAction = _requiredString(action, 'retry action');
    final normalizedFingerprint = _requiredFingerprint(fingerprint);
    final normalizedOrderId =
        orderId == null ? null : _requiredString(orderId, 'order id');
    final storageKey = await _storageKey();
    await _withStorageLock(storageKey, () async {
      final attempts = await _readAttempts(storageKey);
      final remaining = attempts
          .where((attempt) => !(attempt.action == normalizedAction &&
              attempt.fingerprint == normalizedFingerprint &&
              attempt.orderId == normalizedOrderId))
          .toList(growable: false);
      await _writeAttempts(storageKey, remaining);
    });
  }

  Future<List<ManualExchangeAttempt>> _readAttempts(String storageKey) async {
    final encoded = await storage.read(key: storageKey);
    if (encoded == null || encoded.isEmpty) return const [];

    dynamic decoded;
    try {
      decoded = jsonDecode(encoded);
    } catch (_) {
      throw const FormatException('Manual exchange retry data is corrupt.');
    }
    if (decoded is! List) {
      throw const FormatException('Manual exchange retry data is corrupt.');
    }
    final attempts = <ManualExchangeAttempt>[];
    for (final item in decoded) {
      if (item is! Map) {
        throw const FormatException('Manual exchange retry data is corrupt.');
      }
      attempts.add(ManualExchangeAttempt.fromJson(_mapValue(item)));
    }
    return attempts;
  }

  Future<void> _writeAttempts(
    String storageKey,
    List<ManualExchangeAttempt> attempts,
  ) async {
    if (attempts.isEmpty) {
      await storage.delete(key: storageKey);
      return;
    }
    await storage.write(
      key: storageKey,
      value: jsonEncode(attempts.map((attempt) => attempt.toJson()).toList()),
    );
  }

  Future<T> _withStorageLock<T>(
    String storageKey,
    Future<T> Function() operation,
  ) {
    final previous = _storageLocks[storageKey] ?? Future<void>.value();
    final completion = Completer<void>();
    final next = completion.future;
    _storageLocks[storageKey] = next;

    return previous.then((_) async {
      try {
        return await operation();
      } finally {
        completion.complete();
        if (identical(_storageLocks[storageKey], next)) {
          _storageLocks.remove(storageKey);
        }
      }
    });
  }

  Future<String> _storageKey() async {
    final provided =
        accountScopeProvider == null ? null : await accountScopeProvider!();
    final accessToken = await storage.read(key: _accessTokenKey);
    final account = provided?.trim().isNotEmpty == true
        ? provided!.trim()
        : _jwtSubject(accessToken);
    if (account == null || account.isEmpty) {
      throw StateError(
        'Manual exchange retry storage requires an authenticated account scope.',
      );
    }
    final digest = sha256.convert(utf8.encode(account)).toString();
    return '$_storagePrefix${digest.substring(0, 32)}';
  }
}

class ManualExchangeService {
  Future<Map<String, dynamic>> previewRate(String source) async {
    final response = await _apiClient.client.get<dynamic>('/api/exchange/rate',
        queryParameters: {
          'from': source,
          'to': source == 'NGN' ? 'GHS' : 'NGN'
        });
    return Map<String, dynamic>.from(response.data as Map);
  }

  final ApiClient _apiClient;
  final ManualExchangeAttemptStore _attemptStore;
  final Dio _uploadClient;

  ManualExchangeService({
    ApiClient? apiClient,
    ManualExchangeAttemptStore? attemptStore,
    Dio? uploadClient,
  })  : _apiClient = apiClient ?? ApiClient(),
        _attemptStore = attemptStore ?? ManualExchangeAttemptStore(),
        _uploadClient = uploadClient ??
            Dio(BaseOptions(
              followRedirects: false,
              maxRedirects: 0,
              validateStatus: (status) =>
                  status != null && status >= 200 && status < 300,
            ));

  Future<String?> latestExchangeOrderId() =>
      _attemptStore.latestExchangeOrderId();

  Future<bool> receiptStepStarted(String orderId) =>
      _attemptStore.receiptStepStarted(orderId);
  Future<String?> pendingReceiptOrderId() =>
      _attemptStore.pendingReceiptOrderId();
  Future<void> markReceiptStepStarted(String orderId) =>
      _attemptStore.markReceiptStepStarted(orderId);
  Future<void> clearReceiptStep(String orderId) =>
      _attemptStore.clearReceiptStep(orderId);

  Future<List<ManualExchangeAttempt>> pendingCreateAttempts() async =>
      (await _attemptStore.readAttempts())
          .where((attempt) =>
              attempt.action == 'create' || attempt.action == 'draft')
          .toList();

  Future<void> saveAmountDraft(String currency, String amount,
      {ManualExchangeAttempt? previous}) async {
    _currencyValue(currency, fieldName: 'source currency');
    _validateCreateAmount(amount);
    final previousDetails =
        previous == null ? null : _mapValue(jsonDecode(previous.fingerprint));
    final fingerprint = jsonEncode({
      'sourceCurrency': currency,
      'amount': amount,
      'draftId': previousDetails?['draftId'] ?? const Uuid().v4(),
    });
    await _attemptStore.keyFor(action: 'draft', fingerprint: fingerprint);
    if (previous != null && previous.fingerprint != fingerprint) {
      await removeAmountDraft(previous);
    }
  }

  Future<void> removeAmountDraft(ManualExchangeAttempt attempt) =>
      _attemptStore.resolve(action: 'draft', fingerprint: attempt.fingerprint);

  Future<ManualExchangeReminder> requestReviewReminder(String orderId) async {
    final id = _requireText(orderId, 'order id');
    final fingerprint = jsonEncode({'orderId': id, 'reason': 'REVIEW'});
    final key = await _attemptStore.keyFor(
        action: 'review-reminder', fingerprint: fingerprint, orderId: id);
    try {
      final response = await _apiClient.client.post<dynamic>(
          '/api/exchange/manual-orders/${Uri.encodeComponent(id)}/remind',
          data: const {'reason': 'REVIEW'},
          options: Options(headers: {'Idempotency-Key': key}));
      final reminder =
          ManualExchangeReminder.fromJson(_mapValue(response.data));
      await _attemptStore.resolve(
          action: 'review-reminder', fingerprint: fingerprint, orderId: id);
      return reminder;
    } catch (error) {
      final confirmedCooldown =
          ManualExchangeReminder.cooldownFromError(error) != null;
      if (_canResolveAfterServerError(error) || confirmedCooldown) {
        await _attemptStore.resolve(
            action: 'review-reminder', fingerprint: fingerprint, orderId: id);
      }
      rethrow;
    }
  }

  Future<ManualExchangeConfig> fetchConfig() async {
    final response = await _apiClient.client.get<dynamic>(
      '/api/exchange/manual-orders/config',
    );
    return ManualExchangeConfig.fromJson(_mapValue(response.data));
  }

  Future<ManualExchangeConfig> getConfig() => fetchConfig();

  /// Reads the provider capability contract before attempting a Ghana
  /// recipient lookup. This keeps an unavailable provider honest and avoids
  /// guessing a bank route from an account number.
  Future<ManualGhanaPayoutCapabilities> fetchGhanaPayoutCapabilities() async {
    final response = await _apiClient.client.get<dynamic>(
      '/api/ghana/capabilities',
    );
    return ManualGhanaPayoutCapabilities.fromJson(_mapValue(response.data));
  }

  Future<List<ManualGhanaMomoOperator>> fetchGhanaMomoOperators() async {
    final capabilities = await fetchGhanaPayoutCapabilities();
    if (!capabilities.enabled || !capabilities.momoPayouts) {
      throw const FormatException(
        'Automatic MoMo name check is unavailable. Enter the recipient details for manual review.',
      );
    }
    final response =
        await _apiClient.client.get<dynamic>('/api/ghana/operators');
    final data = response.data;
    if (data is! List) {
      throw const FormatException('Ghana MoMo networks could not be read.');
    }
    final operators = data
        .whereType<Map>()
        .map((item) =>
            ManualGhanaMomoOperator.fromJson(Map<String, dynamic>.from(item)))
        .toList(growable: false);
    if (operators.isEmpty) {
      throw const FormatException('No Ghana MoMo network is available.');
    }
    return operators;
  }

  Future<ManualGhanaRecipientResolution> resolveGhanaMomoRecipient({
    required String number,
    required String operator,
  }) async {
    final normalizedNumber = normalizeGhanaMobileNumber(number);
    final normalizedOperator = _requireText(operator, 'MoMo operator');
    if (!RegExp(r'^[a-z0-9-]{2,32}$').hasMatch(normalizedOperator)) {
      throw const FormatException('Choose an available Ghana MoMo network.');
    }
    final response = await _apiClient.client.post<dynamic>(
      '/api/ghana/recipients/resolve',
      data: {
        'mobileNumber': normalizedNumber,
        'operator': normalizedOperator,
      },
    );
    final resolved =
        ManualGhanaRecipientResolution.fromJson(_mapValue(response.data));
    if (normalizeGhanaMobileNumber(resolved.number) != normalizedNumber ||
        resolved.operator != normalizedOperator) {
      throw const FormatException(
          'The name check did not match this recipient. Try again.');
    }
    return resolved;
  }

  Future<List<ManualNigerianBankOption>> fetchNigerianBanks() async {
    final response =
        await _apiClient.client.get<dynamic>('/api/payments/banks');
    final payload = response.data;
    final source = payload is List
        ? payload
        : payload is Map && payload['banks'] is List
            ? payload['banks'] as List
            : payload is Map && payload['data'] is List
                ? payload['data'] as List
                : null;
    if (source == null) {
      throw const FormatException('Nigerian banks could not be read.');
    }
    final banks = <ManualNigerianBankOption>[];
    for (final item in source.whereType<Map<String, dynamic>>()) {
      try {
        banks.add(ManualNigerianBankOption.fromJson(item));
      } on FormatException {
        // An unusable entry should not hide the rest of the directory.
      }
    }
    banks.sort((a, b) => a.name.compareTo(b.name));
    if (banks.isEmpty) {
      throw const FormatException('No Nigerian bank is available.');
    }
    return banks;
  }

  Future<ManualNigerianBankResolution> resolveNigerianBankAccount({
    required String accountNumber,
    required String bankCode,
  }) async {
    final normalizedAccount = accountNumber.trim();
    final normalizedBankCode = bankCode.trim();
    if (!RegExp(r'^\d{10}$').hasMatch(normalizedAccount)) {
      throw const FormatException('Enter a ten-digit Nigerian account number.');
    }
    if (!_nigerianBankCode.hasMatch(normalizedBankCode)) {
      throw const FormatException('Choose an available Nigerian bank.');
    }
    final response = await _apiClient.client.post<dynamic>(
      '/api/payments/banks/resolve',
      data: {
        'accountNumber': normalizedAccount,
        'bankCode': normalizedBankCode,
      },
    );
    final data = _mapValue(response.data);
    final accountName = _requiredString(data['accountName'], 'account name');
    final returnedAccount = data['accountNumber'];
    final returnedBankCode = data['bankCode'];
    if (accountName.length < 2 ||
        accountName.length > 120 ||
        (returnedAccount != null && '$returnedAccount' != normalizedAccount) ||
        (returnedBankCode != null &&
            '$returnedBankCode' != normalizedBankCode)) {
      throw const FormatException(
          'The account check did not match these bank details. Try again.');
    }
    return ManualNigerianBankResolution(
      accountName: accountName,
      accountNumber: normalizedAccount,
      bankCode: normalizedBankCode,
    );
  }

  Future<List<ManualExchangeOrder>> listOrders() async {
    final response = await _apiClient.client.get<dynamic>(
      '/api/exchange/manual-orders',
    );
    final data = response.data;
    final source = data is List
        ? data
        : (_mapValue(data)['orders'] is List
            ? _mapValue(data)['orders'] as List
            : null);
    if (source == null) {
      throw const FormatException('Invalid exchange orders response.');
    }
    return source.map((item) {
      if (item is! Map) {
        throw const FormatException(
          'Invalid exchange orders response: malformed order.',
        );
      }
      return ManualExchangeOrder.fromJson(_mapValue(item));
    }).toList(growable: false);
  }

  Future<List<ManualExchangeOrder>> fetchOrders() => listOrders();

  Future<ManualExchangeOrder> getOrder(String orderId) async {
    final normalizedId = _requireText(orderId, 'order id');
    final response = await _apiClient.client.get<dynamic>(
      '/api/exchange/manual-orders/${Uri.encodeComponent(normalizedId)}',
    );
    return ManualExchangeOrder.fromJson(_orderMap(response.data));
  }

  Future<ManualExchangeOrder> fetchOrder(String orderId) => getOrder(orderId);

  Future<ManualExchangeOrder?> recoverCreatedOrder(
      ManualExchangeAttempt attempt) async {
    final ManualExchangeOrder order;
    try {
      final response = await _apiClient.client.get<dynamic>(
        '/api/exchange/manual-orders/recovery/created',
        options: Options(headers: {'Idempotency-Key': attempt.key}),
      );
      order = ManualExchangeOrder.fromJson(_orderMap(response.data));
    } on DioException catch (error) {
      // Older APIs and requests that have not committed both return 404.
      if (error.response?.statusCode == 404) return null;
      rethrow;
    }
    await _attemptStore.resolve(
        action: 'create', fingerprint: attempt.fingerprint);
    return order;
  }

  Future<ManualExchangeOrder> createOrder({
    String sourceCurrency = 'NGN',
    required String amount,
    required ManualSettlementMode settlementMode,
    required String transactionPin,
    String? destinationInstitution,
    String? destinationAccount,
    String? destinationName,
  }) async {
    final normalizedAmount = _requireText(amount, 'amount');
    _currencyValue(sourceCurrency, fieldName: 'source currency');
    final normalizedPin = _requireText(transactionPin, 'transaction PIN');
    _validateCreateAmount(normalizedAmount);
    if (!RegExp(r'^\d{4,6}$').hasMatch(normalizedPin)) {
      throw const FormatException('Enter a valid transaction PIN.');
    }

    final normalizedInstitution = destinationInstitution?.trim();
    final normalizedAccount = destinationAccount?.trim();
    final normalizedName = destinationName?.trim();
    if (settlementMode == ManualSettlementMode.wallet) {
      if ((normalizedInstitution?.isNotEmpty ?? false) ||
          (normalizedAccount?.isNotEmpty ?? false) ||
          (normalizedName?.isNotEmpty ?? false)) {
        throw const FormatException(
          'Wallet settlement cannot include external account details.',
        );
      }
    } else {
      _validateDestination(
        institution: normalizedInstitution,
        account: normalizedAccount,
        name: normalizedName,
      );
    }

    final useDirectBankContract =
        sourceCurrency == 'GHS' && settlementMode == ManualSettlementMode.bank;
    final fields = <String, dynamic>{
      if (sourceCurrency == 'GHS') 'sourceCurrency': sourceCurrency,
      'amount': normalizedAmount,
      'settlementMode': settlementMode.value,
      if (settlementMode != ManualSettlementMode.wallet &&
          normalizedInstitution != null &&
          normalizedInstitution.isNotEmpty)
        'destinationInstitution': normalizedInstitution,
      if (settlementMode != ManualSettlementMode.wallet &&
          normalizedAccount != null &&
          normalizedAccount.isNotEmpty)
        'destinationAccount': normalizedAccount,
      if (settlementMode != ManualSettlementMode.wallet &&
          normalizedName != null &&
          normalizedName.isNotEmpty)
        'destinationName': normalizedName,
      if (useDirectBankContract) 'deliveryPolicyVersion': 2,
    };
    final fingerprint = jsonEncode(fields);
    final idempotencyKey = await _attemptStore.keyFor(
      action: 'create',
      fingerprint: fingerprint,
    );

    return _submitCreateOrder(
        fields, fingerprint, idempotencyKey, normalizedPin);
  }

  Future<ManualExchangeOrder> resumeCreateOrder(
      ManualExchangeAttempt attempt, String transactionPin) async {
    final pending = await _attemptStore.pendingCreates();
    if (!pending.any((current) =>
        current.key == attempt.key &&
        current.fingerprint == attempt.fingerprint)) {
      throw StateError(
          'This saved request is no longer pending. Open Recent exchanges to refresh its status.');
    }
    final pin = _requireText(transactionPin, 'transaction PIN');
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin)) {
      throw const FormatException('Enter a valid transaction PIN.');
    }
    final fields = _mapValue(jsonDecode(attempt.fingerprint));
    return _submitCreateOrder(fields, attempt.fingerprint, attempt.key, pin);
  }

  Future<ManualExchangeOrder> _submitCreateOrder(
    Map<String, dynamic> fields,
    String fingerprint,
    String idempotencyKey,
    String normalizedPin,
  ) async {
    try {
      final response = await _apiClient.client.post<dynamic>(
        '/api/exchange/manual-orders',
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
        data: {
          ...fields,
          'transactionPin': normalizedPin,
        },
      );
      final order = ManualExchangeOrder.fromJson(_orderMap(response.data));
      try {
        await _attemptStore.rememberExchangeOrder(order.id);
      } catch (_) {
        // A server-created order remains reachable in protected exchange history.
      }
      await _attemptStore.resolve(action: 'create', fingerprint: fingerprint);
      return order;
    } catch (error) {
      if (_canResolveAfterServerError(error)) {
        await _attemptStore.resolve(
          action: 'create',
          fingerprint: fingerprint,
        );
      }
      if (fields['settlementMode'] == 'WALLET' &&
          error is DioException &&
          authErrorMessage(error, '')
              .contains('Tier 1 transactions are temporarily unavailable')) {
        throw const FormatException(
          'This older wallet request could not be reopened. If you already transferred, contact support with your receipt before sending anything again.',
        );
      }
      if (fields['deliveryPolicyVersion'] == 2 &&
          error is DioException &&
          error.response?.statusCode == 400 &&
          authErrorMessage(error, '')
              .contains('property deliveryPolicyVersion should not exist')) {
        throw const FormatException(
          'Cedis to naira is temporarily unavailable. No transfer instructions were issued. Check Exchange again later.',
        );
      }
      rethrow;
    }
  }

  Future<ManualUploadUrl> requestProofUploadUrl({
    required String orderId,
    required String fileName,
    required String contentType,
    required int fileSize,
  }) async {
    final normalizedOrderId = _requireText(orderId, 'order id');
    final normalizedName = _requireText(fileName, 'file name');
    final normalizedType = _normalizeContentType(contentType);
    _validateProofMetadata(
      fileName: normalizedName,
      contentType: normalizedType,
      fileSize: fileSize,
    );
    final fingerprint = jsonEncode({
      'orderId': normalizedOrderId,
      'fileName': normalizedName,
      'contentType': normalizedType,
      'fileSize': fileSize,
    });
    final idempotencyKey = await _attemptStore.keyFor(
      action: 'upload-url',
      fingerprint: fingerprint,
      orderId: normalizedOrderId,
    );

    try {
      final response = await _apiClient.client.post<dynamic>(
        '/api/exchange/manual-orders/${Uri.encodeComponent(normalizedOrderId)}/upload-url',
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
        data: {
          'fileName': normalizedName,
          'contentType': normalizedType,
          'fileSize': fileSize,
        },
      );
      final upload = ManualUploadUrl.fromJson(_mapValue(response.data));
      await _attemptStore.resolve(
        action: 'upload-url',
        fingerprint: fingerprint,
        orderId: normalizedOrderId,
      );
      return upload;
    } catch (error) {
      if (_canResolveAfterServerError(error)) {
        await _attemptStore.resolve(
          action: 'upload-url',
          fingerprint: fingerprint,
          orderId: normalizedOrderId,
        );
      }
      rethrow;
    }
  }

  Future<ManualReceiptDetails> scanReceipt({
    required String orderId,
    required ManualExchangeProofFile file,
    CancelToken? cancelToken,
  }) async {
    final id = _requireText(orderId, 'order id');
    final type = _normalizeContentType(file.contentType);
    _validateProofMetadata(
      fileName: file.fileName,
      contentType: type,
      fileSize: file.fileSize,
    );
    String? receiptName;
    String? bankReference;
    try {
      await for (final image in receiptScanImages(file.bytes, type)) {
        final response = await _apiClient.client.post<dynamic>(
          '/api/exchange/manual-orders/${Uri.encodeComponent(id)}/receipt-scan',
          data: FormData.fromMap({
            'image': MultipartFile.fromBytes(image, filename: 'receipt.png'),
          }),
          options: Options(receiveTimeout: const Duration(seconds: 25)),
          cancelToken: cancelToken,
        );
        final result = _mapValue(response.data);
        receiptName ??=
            _nullableString(result['receiptName'], 'name on receipt');
        bankReference ??=
            _nullableString(result['bankReference'], 'bank reference');
        if (receiptName != null && bankReference != null) break;
      }
    } catch (_) {
      if (receiptName == null && bankReference == null) rethrow;
    }
    return (receiptName: receiptName, bankReference: bankReference);
  }

  Future<ManualExchangeOrder> submitProof({
    required String orderId,
    required ManualExchangeProofFile file,
    String? bankReference,
    String? receiptName,
  }) async {
    final normalizedOrderId = _requireText(orderId, 'order id');
    final reference = bankReference?.trim();
    final normalizedReference = reference == null || reference.isEmpty
        ? null
        : _normalizeBankReference(reference);
    final name = receiptName?.trim();
    if (name != null &&
        (name.isEmpty ||
            name.length > 120 ||
            RegExp(r'[\x00-\x1f\x7f-\x9f]').hasMatch(name))) {
      throw const FormatException('Enter the name shown on your receipt.');
    }
    final normalizedType = _normalizeContentType(file.contentType);
    _validateProofMetadata(
      fileName: file.fileName,
      contentType: normalizedType,
      fileSize: file.fileSize,
    );

    // Match reference-free retries to the same file. Keep the fingerprint of
    // existing reference-only attempts so they can still be recovered.
    final receiptDigest = name == null && normalizedReference != null
        ? null
        : sha256
            .convert(utf8.encode(jsonEncode([
              name,
              sha256.convert(file.bytes).toString(),
            ])))
            .toString();
    var objectKey = await _pendingProofFor(
      orderId: normalizedOrderId,
      bankReference: normalizedReference,
      receiptDigest: receiptDigest,
    );
    if (objectKey == null) {
      final upload = await requestProofUploadUrl(
        orderId: normalizedOrderId,
        fileName: file.fileName,
        contentType: normalizedType,
        fileSize: file.fileSize,
      );
      await uploadProofBytes(
        upload: upload,
        contentType: normalizedType,
        bytes: file.bytes,
      );
      objectKey = upload.objectKey;
    }

    final fingerprint = jsonEncode({
      'orderId': normalizedOrderId,
      'objectKey': objectKey,
      if (normalizedReference != null) 'bankReference': normalizedReference,
      if (receiptDigest != null) 'receiptDigest': receiptDigest,
    });
    final idempotencyKey = await _attemptStore.keyFor(
      action: 'proof',
      fingerprint: fingerprint,
      orderId: normalizedOrderId,
    );
    try {
      final response = await _apiClient.client.post<dynamic>(
        '/api/exchange/manual-orders/${Uri.encodeComponent(normalizedOrderId)}/proof',
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
        data: {
          'objectKey': objectKey,
          if (normalizedReference != null) 'bankReference': normalizedReference,
          if (name != null) 'receiptName': name,
        },
      );
      final order = ManualExchangeOrder.fromJson(_orderMap(response.data));
      await _attemptStore.resolve(
        action: 'proof',
        fingerprint: fingerprint,
        orderId: normalizedOrderId,
      );
      return order;
    } catch (error) {
      if (_canResolveAfterServerError(error)) {
        await _attemptStore.resolve(
          action: 'proof',
          fingerprint: fingerprint,
          orderId: normalizedOrderId,
        );
      }
      rethrow;
    }
  }

  Future<String?> _pendingProofFor({
    required String orderId,
    required String? bankReference,
    required String? receiptDigest,
  }) async {
    final attempts = await _attemptStore.readForOrder(
      action: 'proof',
      orderId: orderId,
    );
    for (final attempt in attempts) {
      dynamic decoded;
      try {
        decoded = jsonDecode(attempt.fingerprint);
      } catch (_) {
        throw const FormatException('Manual exchange retry data is corrupt.');
      }
      if (decoded is! Map ||
          (decoded['bankReference'] != null &&
              decoded['bankReference'] is! String) ||
          (decoded['receiptDigest'] != null &&
              decoded['receiptDigest'] is! String) ||
          decoded['objectKey'] is! String ||
          (decoded['objectKey'] as String).trim().isEmpty) {
        throw const FormatException('Manual exchange retry data is corrupt.');
      }
      if (decoded['bankReference'] == bankReference &&
          decoded['receiptDigest'] == receiptDigest) {
        return (decoded['objectKey'] as String).trim();
      }
    }
    return null;
  }

  Future<String> getProofUrl(String orderId) async {
    final normalizedOrderId = _requireText(orderId, 'order id');
    final response = await _apiClient.client.get<dynamic>(
      '/api/exchange/manual-orders/${Uri.encodeComponent(normalizedOrderId)}/proof-url',
    );
    final url = _mapValue(response.data)['url'];
    return _requireText(url, 'proof URL');
  }

  /// Uploads receipt bytes to the signed object-store URL with a fresh Dio
  /// transport. This client has no auth interceptor and no logging hooks.
  Future<void> uploadProofBytes({
    required ManualUploadUrl upload,
    required String contentType,
    required Uint8List bytes,
  }) {
    return _uploadProofBytes(
      signedUrl: upload.signedUrl,
      contentType: contentType,
      bytes: bytes,
    );
  }

  Future<void> _uploadProofBytes({
    required String signedUrl,
    required String contentType,
    required Uint8List bytes,
  }) async {
    final normalizedUrl = _requireText(signedUrl, 'signed upload URL');
    await _uploadClient.put<void>(
      normalizedUrl,
      data: bytes,
      options: Options(
        headers: {'Content-Type': contentType},
        followRedirects: false,
        maxRedirects: 0,
      ),
    );
  }

  void _validateProofMetadata({
    required String fileName,
    required String contentType,
    required int fileSize,
  }) {
    if (!RegExp(r'^[A-Za-z0-9._ -]{1,180}$').hasMatch(fileName)) {
      throw const FormatException('Receipt file name is invalid.');
    }
    if (fileSize <= 0 || fileSize > manualExchangeMaxProofBytes) {
      throw const FormatException('Receipt must be 8 MiB or smaller.');
    }
    const allowed = {
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    };
    if (!allowed.contains(contentType)) {
      throw const FormatException('Receipt must be a JPEG, PNG, WebP, or PDF.');
    }
  }

  void _validateCreateAmount(String amount) {
    if (amount.length > 16 ||
        !RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(amount)) {
      throw const FormatException(
        'Enter a positive amount with up to two decimal places.',
      );
    }
    final minorUnits = MoneyValue.parse(amount).minorUnits;
    final hasPositiveValue = minorUnits > BigInt.zero;
    if (minorUnits > BigInt.parse('999999999999999')) {
      throw const FormatException(
          'This amount cannot be recorded at the supported monetary precision.');
    }
    if (!hasPositiveValue) {
      throw const FormatException(
          'Enter a positive amount with up to two decimal places.');
    }
  }

  void _validateDestination({
    required String? institution,
    required String? account,
    required String? name,
  }) {
    if (institution == null ||
        institution.length < 2 ||
        institution.length > 120) {
      throw const FormatException('Enter a valid destination institution.');
    }
    if (account == null || !RegExp(r'^\+?\d{7,20}$').hasMatch(account)) {
      throw const FormatException('Enter a valid destination account.');
    }
    if (name == null || name.length < 2 || name.length > 120) {
      throw const FormatException('Enter a valid destination name.');
    }
  }
}

String manualExchangeErrorMessage(Object error, String fallback) {
  if (error is FormatException) return error.message;
  if (error is DioException && error.response == null) {
    return 'We could not confirm the request because you appear to be offline. Your retry is safe; try again when you are online.';
  }
  return authErrorMessage(error, fallback);
}

bool _canResolveAfterServerError(Object error) {
  if (error is! DioException) return false;
  final status = error.response?.statusCode;
  if (status == null || status < 400 || status >= 500) return false;

  // These responses do not establish that the mutation was rejected. The
  // request may have committed before a gateway timeout, conflict, rate
  // limit, or auth-refresh failure reached the client, so the journal key
  // must remain available for an explicit retry.
  const ambiguous = {401, 408, 409, 425, 429};
  return !ambiguous.contains(status);
}

String _normalizeContentType(String raw) {
  final normalized = raw.trim().toLowerCase();
  if (normalized == 'image/jpg') return 'image/jpeg';
  return normalized;
}

String _normalizeBankReference(String raw) {
  final reference = _requireText(raw, 'bank reference').toUpperCase();
  if (!RegExp(r'^[A-Z0-9._-]{4,100}$').hasMatch(reference)) {
    throw const FormatException('Enter a valid bank reference.');
  }
  return reference;
}

String normalizeGhanaMobileNumber(String raw) {
  var number = raw
      .trim()
      .replaceAll(RegExp(r'[\s-]'), '')
      .replaceFirst(RegExp(r'^\+'), '');
  if (RegExp(r'^0\d{9}$').hasMatch(number)) {
    number = '233${number.substring(1)}';
  }
  if (!RegExp(r'^233\d{9}$').hasMatch(number)) {
    throw const FormatException(
      'Enter a Ghana MoMo number, for example 0241234567.',
    );
  }
  return number;
}

String _requireText(dynamic value, String field) {
  final text = '$value'.trim();
  if (value == null || text.isEmpty || text == 'null') {
    throw FormatException('A valid $field is required.');
  }
  return text;
}

String _requiredString(dynamic value, String fieldName) {
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  return value.trim();
}

String? _nullableString(dynamic value, String fieldName) {
  if (value == null) return null;
  if (value is! String) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  final text = value.trim();
  return text.isEmpty ? null : text;
}

bool _requiredBool(dynamic value, String fieldName) {
  if (value is! bool) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  return value;
}

String _currencyValue(dynamic value, {required String fieldName}) {
  final currency = _requiredString(value, fieldName).toUpperCase();
  if (!RegExp(r'^[A-Z]{3}$').hasMatch(currency)) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  return currency;
}

String _decimalValue(
  dynamic value, {
  required String fieldName,
  required int scale,
  bool mustBePositive = false,
}) {
  if (value is! String) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  final text = value.trim();
  final pattern = RegExp(r'^\d+\.\d{' + scale.toString() + r'}$');
  if (!pattern.hasMatch(text)) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  if (mustBePositive && BigInt.parse(text.replaceAll('.', '')) <= BigInt.zero) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  return text;
}

DateTime _requiredDate(dynamic value, String fieldName) {
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  final date = DateTime.tryParse(value);
  if (date == null) {
    throw FormatException('Invalid $fieldName in exchange response.');
  }
  return date.toUtc();
}

String _attemptAction(dynamic value) {
  final action = _requiredString(value, 'retry action');
  const actions = {
    'create',
    'draft',
    'upload-url',
    'proof',
    'review-reminder',
    'provider-create',
    'kora-account-create',
    'kora-momo-create',
    'ghs-cashout-create'
  };
  if (!actions.contains(action)) {
    throw const FormatException('Manual exchange retry data is corrupt.');
  }
  return action;
}

String _requiredFingerprint(dynamic value) {
  final fingerprint = _requiredString(value, 'retry fingerprint');
  dynamic decoded;
  try {
    decoded = jsonDecode(fingerprint);
  } catch (_) {
    throw const FormatException('Manual exchange retry data is corrupt.');
  }
  if (decoded is! Map) {
    throw const FormatException('Manual exchange retry data is corrupt.');
  }
  return fingerprint;
}

String _attemptKey(dynamic value) {
  final key = _requiredString(value, 'retry key');
  if (!RegExp(r'^[A-Za-z0-9_-]{16,128}$').hasMatch(key)) {
    throw const FormatException('Manual exchange retry data is corrupt.');
  }
  return key;
}

Map<String, dynamic> _mapValue(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, value) => MapEntry('$key', value));
  }
  return <String, dynamic>{};
}

Map<String, dynamic> _orderMap(dynamic value) {
  final map = _mapValue(value);
  final nested = map['order'];
  return nested is Map ? _mapValue(nested) : map;
}

String? _jwtSubject(String? token) {
  if (token == null || token.isEmpty) return null;
  final segments = token.split('.');
  if (segments.length != 3) return null;
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(segments[1]))),
    );
    if (payload is! Map) return null;
    final subject = payload['sub'];
    return subject is String && subject.trim().isNotEmpty
        ? subject.trim()
        : null;
  } catch (_) {
    return null;
  }
}
