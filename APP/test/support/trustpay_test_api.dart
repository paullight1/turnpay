import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/auth_service.dart';
import 'package:trustpay_app/services/home_data_service.dart';
import 'package:trustpay_app/services/wallet_service.dart';

class TrustPayTestBundle {
  final Dio dio;
  final ApiClient apiClient;
  final FakeTrustPayApiAdapter adapter;
  final HomeDataService homeDataService;
  final WalletService walletService;
  final AuthService authService;

  const TrustPayTestBundle({
    required this.dio,
    required this.apiClient,
    required this.adapter,
    required this.homeDataService,
    required this.walletService,
    required this.authService,
  });
}

TrustPayTestBundle buildTrustPayTestBundle({
  String kycStatus = 'VERIFIED',
  bool refreshSucceeds = true,
  bool includeTransactions = true,
  bool includeDeposits = true,
  bool includeVirtualAccounts = true,
  String? virtualAccountProvisioningStatus,
  String virtualAccountProvisioningMessage = '',
  bool includeReferralRewards = true,
  bool transactionPinConfigured = true,
  bool includeVtuProviders = false,
  int internalTransferFailuresBeforeSuccess = 0,
}) {
  final adapter = FakeTrustPayApiAdapter(
    kycStatus: kycStatus,
    refreshSucceeds: refreshSucceeds,
    includeTransactions: includeTransactions,
    includeDeposits: includeDeposits,
    includeVirtualAccounts: includeVirtualAccounts,
    virtualAccountProvisioningStatus: virtualAccountProvisioningStatus,
    virtualAccountProvisioningMessage: virtualAccountProvisioningMessage,
    includeReferralRewards: includeReferralRewards,
    includeVtuProviders: includeVtuProviders,
    transactionPinConfigured: transactionPinConfigured,
    internalTransferFailuresBeforeSuccess:
        internalTransferFailuresBeforeSuccess,
  );
  final dio = Dio(
    BaseOptions(
      baseUrl: FakeTrustPayApiAdapter.mockBaseUrl,
      headers: const {'Content-Type': 'application/json'},
    ),
  )..httpClientAdapter = adapter;

  final apiClient = ApiClient(dio: dio);

  return TrustPayTestBundle(
    dio: dio,
    apiClient: apiClient,
    adapter: adapter,
    homeDataService: HomeDataService(apiClient: apiClient),
    walletService: WalletService(apiClient: apiClient),
    authService: AuthService(apiClient: apiClient),
  );
}

void setMockSecureStorage({String? accessToken, String? refreshToken}) {
  FlutterSecureStorage.setMockInitialValues({});
  FlutterSecureStorage.setMockInitialValues({
    if (accessToken != null) 'trustpay_access_token': accessToken,
    if (refreshToken != null) 'trustpay_refresh_token': refreshToken,
  });
}

class FakeTrustPayApiAdapter implements HttpClientAdapter {
  static const mockHost = 'mockserver';
  static const mockBaseUrl = 'https://$mockHost';

  final String kycStatus;
  final bool refreshSucceeds;
  final bool includeTransactions;
  final bool includeDeposits;
  final bool includeVirtualAccounts;
  final String? virtualAccountProvisioningStatus;
  final String virtualAccountProvisioningMessage;
  bool _accountProvisioned = false;
  bool _accountSetupRequested = false;
  bool revealAccountNumbers = true;
  final bool includeReferralRewards;
  final bool includeVtuProviders;
  bool transactionPinConfigured;
  int internalTransferFailuresBeforeSuccess;
  final List<String> internalTransferIdempotencyKeys = [];
  final List<String> paymentResolverIdempotencyKeys = [];
  final List<String> paymentResolverAttemptKeys = [];
  final List<String> paymentResolverOperations = [];
  int internalTransferMutationCount = 0;
  String? _committedInternalTransferAttemptKey;
  String? _committedInternalTransferReference;
  final List<Uri> requestedUris = [];

  FakeTrustPayApiAdapter({
    required this.kycStatus,
    required this.refreshSucceeds,
    required this.includeTransactions,
    required this.includeDeposits,
    required this.includeVirtualAccounts,
    this.virtualAccountProvisioningStatus,
    this.virtualAccountProvisioningMessage = '',
    required this.includeReferralRewards,
    required this.includeVtuProviders,
    this.transactionPinConfigured = true,
    this.internalTransferFailuresBeforeSuccess = 0,
  });

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requestedUris.add(options.uri);
    final path = options.uri.path;
    final method = options.method.toUpperCase();

    if (options.uri.host != mockHost) {
      return ResponseBody.fromString(
        jsonEncode({'message': 'Unexpected host ${options.uri.host}'}),
        404,
        headers: _jsonHeaders,
      );
    }

    if (method == 'POST' && path == '/api/auth/bootstrap') {
      return _jsonResponse(_bootstrapResponse());
    }

    if (method == 'POST' && path == '/api/auth/refresh') {
      if (!refreshSucceeds) {
        return _jsonResponse({'message': 'Session expired'}, statusCode: 401);
      }
      return _jsonResponse({
        'session': {
          'access_token': 'access-token-1',
          'refresh_token': 'refresh-token-2',
        },
      });
    }

    if (method == 'GET' && path == '/api/transactions') {
      final isDepositsQuery = options.queryParameters['type'] == 'FUND';
      final transactions = isDepositsQuery
          ? (includeDeposits
              ? _depositTransactions()
              : <Map<String, dynamic>>[])
          : (includeTransactions
              ? _homeTransactions()
              : <Map<String, dynamic>>[]);

      return _jsonResponse({
        'transactions': transactions,
        'total': transactions.length,
        'page': 1,
        'limit':
            int.tryParse('${options.queryParameters['limit'] ?? 20}') ?? 20,
        'totalPages': transactions.isEmpty ? 0 : 1,
      });
    }

    if (method == 'GET' && path == '/api/vtu/providers') {
      final type = '${options.queryParameters['type'] ?? ''}';
      if (includeVtuProviders && type == 'airtime') {
        return _jsonResponse([
          {
            'id': 'mtn',
            'name': 'MTN',
            'type': 'airtime',
            'isActive': true,
          },
          {
            'id': 'airtel',
            'name': 'Airtel',
            'type': 'airtime',
            'isActive': true,
          },
        ]);
      }
      if (includeVtuProviders && type == 'cable') {
        return _jsonResponse([
          {
            'id': 'dstv',
            'name': 'DStv',
            'type': 'cable',
            'isActive': true,
          },
        ]);
      }
      return _jsonResponse(const []);
    }

    if (method == 'GET' && path == '/api/banking/accounts') {
      return _jsonResponse(_virtualAccounts());
    }

    if (method == 'GET' && path == '/api/banking/accounts/provisioning') {
      return _jsonResponse({
        'provider': 'PAYSTACK',
        'status': virtualAccountProvisioningStatus ??
            ((_accountProvisioned || includeVirtualAccounts)
                ? 'ACTIVE'
                : _accountSetupRequested
                    ? 'WAITING_FOR_KYC'
                    : 'NOT_REQUESTED'),
        'message': virtualAccountProvisioningMessage,
        'updatedAt': _accountProvisioned ? '2026-10-30T10:00:00.000Z' : null,
      });
    }

    if (method == 'GET' && path == '/api/payments/capabilities') {
      return _jsonResponse({
        'provider': 'paystack',
        'country': 'NG',
        'currency': 'NGN',
        'configured': true,
        'checkout': true,
        'checkoutMinimumAmount': '50.00',
        'virtualAccounts': true,
        'withdrawals': true,
        'internalTransfers': true,
        'identityVerification': true,
        'manualDocumentReview': true,
        'automatedIdentityTypes': ['BVN'],
        'withdrawalMinimumTier': 'TIER_2',
      });
    }

    if (method == 'POST' && path == '/api/payments/initialize') {
      return _jsonResponse({
        'reference': 'fund-test-001',
        'status': 'PENDING',
        'authorizationUrl': 'https://checkout.paystack.com/fund-test-001',
      });
    }

    if (method == 'GET' && path.startsWith('/api/payments/verify/')) {
      return _jsonResponse({
        'reference': path.split('/').last,
        'status': 'PENDING',
      });
    }

    if (method == 'GET' && path == '/api/payments/banks') {
      return _jsonResponse([
        {
          'name': 'Access Bank',
          'code': '044',
          'slug': 'access-bank',
        },
        {
          'name': 'GTBank',
          'code': '058',
          'slug': 'gtbank',
        },
      ]);
    }

    if (method == 'POST' && path == '/api/payments/banks/resolve') {
      return _jsonResponse({
        'accountName': 'Ada Lovelace',
        'accountNumber': '0123456789',
        'bankCode': '058',
      });
    }

    if (method == 'GET' && path == '/api/kyc/status') {
      final verified = kycStatus.toUpperCase() == 'VERIFIED';
      return _jsonResponse({
        'provider': 'PAYSTACK',
        'providerValidationStatus': verified
            ? 'VERIFIED'
            : kycStatus == 'SUBMITTED'
                ? 'PENDING'
                : 'UNVERIFIED',
        'kycStatus': kycStatus,
        'kycTier': verified ? 'TIER_2' : 'TIER_0',
        'documents': verified
            ? [
                {
                  'type': 'BVN',
                  'status': 'VERIFIED',
                  'updatedAt': '2026-10-30T10:00:00.000Z',
                },
              ]
            : <Map<String, dynamic>>[],
      });
    }

    if (method == 'GET' && path == '/api/banking/beneficiaries') {
      return _jsonResponse(_beneficiaries());
    }

    if (method == 'GET' && path == '/api/referrals/me') {
      return _jsonResponse(_referralDashboard(includeReferralRewards));
    }

    if (method == 'GET' && path == '/api/wallets') {
      return _jsonResponse([
        _wallet('NGN', 125000.5),
        _wallet('GHS', 3300.75),
        _wallet('USD', 0),
        _wallet('EUR', 0),
        _wallet('GBP', 0),
        _wallet('ZAR', 0)
      ]);
    }

    if (method == 'GET' && path == '/api/wallets/NGN') {
      return _jsonResponse(_wallet('NGN', 125000.5));
    }

    if (method == 'GET' && path == '/api/wallets/GHS') {
      return _jsonResponse(_wallet('GHS', 3300.75));
    }

    if (method == 'POST' && path == '/api/banking/accounts/setup-request') {
      _accountSetupRequested = true;
      return _jsonResponse(
          {'provider': 'PAYSTACK', 'status': 'WAITING_FOR_KYC'});
    }

    if (method == 'POST' && path == '/api/banking/accounts/provision') {
      _accountProvisioned = true;
      return _jsonResponse(_virtualAccounts().first);
    }

    if (method == 'POST' && path == '/api/transfers/recipient/preview') {
      return _jsonResponse({
        'found': true,
        'displayName': 'Tolu A.',
        'maskedIdentifier': 't***@example.com',
        'avatarInitials': 'TA',
      });
    }

    if (method == 'GET' && path == '/api/auth/transaction-pin/status') {
      return _jsonResponse({
        'configured': transactionPinConfigured,
        'pinLength': transactionPinConfigured ? 4 : null,
        'resetHoldUntil': null,
        'locked': false,
      });
    }

    if (method == 'POST' && path == '/api/auth/transaction-pin') {
      transactionPinConfigured = true;
      return _jsonResponse({'success': true});
    }

    if (method == 'POST' && path == '/api/auth/transaction-pin/verify') {
      final data = Map<String, dynamic>.from(options.data as Map);
      if (data['pin'] != '2468') {
        return _jsonResponse({
          'message': 'Invalid transaction PIN',
        }, statusCode: 403);
      }
      return _jsonResponse({'success': true});
    }

    if (method == 'POST' && path == '/api/transfers/internal') {
      final data = Map<String, dynamic>.from(options.data as Map);
      // The real financial endpoint verifies before creating an attempt or debit.
      if (data['transactionPin'] != '2468') {
        return _jsonResponse({'message': 'Invalid transaction PIN'},
            statusCode: 403);
      }
      final idempotencyKey =
          '${options.headers['Idempotency-Key'] ?? options.headers['idempotency-key'] ?? ''}';
      internalTransferIdempotencyKeys.add(idempotencyKey);
      internalTransferMutationCount++;
      if (internalTransferFailuresBeforeSuccess > 0) {
        internalTransferFailuresBeforeSuccess--;
        // Model a committed backend mutation whose response was lost at the
        // transport boundary. The resolver must be able to recover this exact
        // original attempt without allowing a second debit.
        _committedInternalTransferAttemptKey = idempotencyKey;
        _committedInternalTransferReference = 'IT-INTEGRATION-001';
        return _jsonResponse({
          'message': 'Distributed controls unavailable',
        }, statusCode: 503);
      }
      return _jsonResponse({
        'reference': 'IT-INTEGRATION-001',
        'status': 'SUCCESS',
        'amount': '${data['amount']}',
        'currency': '${data['currency']}',
        'senderTransactionReference': 'IT-INTEGRATION-001-OUT',
        'senderBalanceAfter': '974.50',
        'recipient': {
          'maskedIdentifier': 't***@example.com',
          'avatarInitials': 'TA',
        },
        'createdAt': '2026-09-01T12:00:00.000Z',
      });
    }

    if (method == 'POST' && path == '/api/payment-attempts/resolve') {
      final resolverKey =
          '${options.headers['Idempotency-Key'] ?? options.headers['idempotency-key'] ?? ''}';
      final data = Map<String, dynamic>.from(options.data as Map);
      paymentResolverIdempotencyKeys.add(resolverKey);
      paymentResolverAttemptKeys.add('${data['attemptKey'] ?? ''}');
      paymentResolverOperations.add('${data['operation'] ?? ''}');
      final attemptKey = '${data['attemptKey'] ?? ''}';
      if (attemptKey == _committedInternalTransferAttemptKey) {
        return _jsonResponse({
          'state': 'SUCCESS',
          'reference': _committedInternalTransferReference,
        });
      }
      return _jsonResponse({'state': 'UNKNOWN'});
    }

    if (method == 'GET' && path == '/api/support/tickets') {
      return _jsonResponse({
        'tickets': [
          {
            'id': 'ticket-1',
            'type': 'TRANSACTION',
            'description': 'Transaction is pending review.',
            'status': 'OPEN',
            'resolution': '',
            'createdAt': '2026-06-22T09:30:00.000Z',
            'transaction': {'reference': 'TX-001'},
          },
        ],
      });
    }

    if (method == 'POST' && path == '/api/support/tickets') {
      return _jsonResponse({
        'id': 'ticket-2',
        'type': 'ACCOUNT',
        'description': 'Account deletion requested from the profile screen.',
        'status': 'OPEN',
        'resolution': '',
        'createdAt': '2026-06-22T09:45:00.000Z',
        'transaction': {'reference': ''},
      });
    }

    return _jsonResponse({
      'message': 'Unexpected ${options.method} $path',
    }, statusCode: 404);
  }

  @override
  void close({bool force = false}) {}

  ResponseBody _jsonResponse(Object body, {int statusCode = 200}) {
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: _jsonHeaders,
    );
  }

  Map<String, List<String>> get _jsonHeaders => {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      };

  Map<String, dynamic> _bootstrapResponse() {
    return {
      'user': {
        'id': 'user-1',
        'email': 'ada@example.com',
        'phone': '+2348012345678',
        'fullName': 'Ada Lovelace',
        'role': 'USER',
        'kycStatus': kycStatus,
        'kycTier': kycStatus == 'VERIFIED' ? 'TIER_2' : 'TIER_0',
        'yearOfBirth': 1984,
        'country': 'NG',
        'profileDetailsUpdatedAt': null,
      },
      'wallets': [
        _wallet('NGN', 125000.5),
        _wallet('GHS', 3300.75),
        _wallet('USD', 0),
        _wallet('EUR', 0),
        _wallet('GBP', 0),
        _wallet('ZAR', 0),
      ],
    };
  }

  List<Map<String, dynamic>> _homeTransactions() {
    return [
      {
        'id': 'txn-1',
        'type': 'FUND',
        'status': 'SUCCESS',
        'reference': 'DEP-001',
        'currency': 'NGN',
        'amount': 5000.0,
        'fee': 0,
        'createdAt': '2026-06-22T10:00:00.000Z',
      },
      {
        'id': 'txn-2',
        'type': 'WITHDRAW',
        'status': 'PENDING',
        'reference': 'WTH-001',
        'currency': 'NGN',
        'amount': 1200.0,
        'fee': 10.0,
        'createdAt': '2026-06-22T11:00:00.000Z',
      },
      {
        'id': 'txn-3',
        'type': 'EXCHANGE',
        'status': 'SUCCESS',
        'reference': 'EX-001',
        'currency': 'GHS',
        'amount': 350.0,
        'fee': 2.5,
        'createdAt': '2026-06-22T11:30:00.000Z',
      },
    ];
  }

  List<Map<String, dynamic>> _depositTransactions() {
    return [
      {
        'id': 'deposit-1',
        'type': 'FUND',
        'status': 'SUCCESS',
        'reference': 'DEP-001',
        'currency': 'NGN',
        'amount': 5000.0,
        'fee': 0,
        'createdAt': '2026-06-22T10:00:00.000Z',
      },
      {
        'id': 'deposit-2',
        'type': 'FUND',
        'status': 'SUCCESS',
        'reference': 'DEP-002',
        'currency': 'NGN',
        'amount': 2500.0,
        'fee': 0,
        'createdAt': '2026-06-22T10:30:00.000Z',
      },
    ];
  }

  List<Map<String, dynamic>> _virtualAccounts() {
    if (!includeVirtualAccounts && !_accountProvisioned) return [];

    return [
      {
        'provider': 'paystack',
        'accountNumber': revealAccountNumbers ? '0123456789' : '',
        'accountNumberMasked': '******6789',
        'accountName': 'Ada Lovelace',
        'bankName': 'Providus Bank',
        'currency': 'NGN',
        'status': 'ACTIVE',
      },
      {
        // Paystack only provisions NGN. Keep this tagged legacy record so
        // provider-aware history remains covered without advertising GHS
        // Paystack functionality.
        'provider': 'monnify',
        'accountNumber': '1000000001',
        'accountNumberMasked': '******0001',
        'accountName': 'Ada Lovelace',
        'bankName': 'Zenith Bank',
        'currency': 'GHS',
        'status': 'ACTIVE',
      },
    ];
  }

  List<Map<String, dynamic>> _beneficiaries() {
    return [
      {
        'id': 'beneficiary-1',
        'bankName': 'First Bank',
        'accountName': 'Ada Lovelace',
        'accountNumberMasked': '******1234',
        'bankCode': '011',
        'currency': 'NGN',
        'provider': 'paystack',
        'createdAt': '2026-06-22T08:00:00.000Z',
      },
    ];
  }

  Map<String, dynamic> _referralDashboard(bool includeRewards) {
    return {
      'code': 'TRUST-AB12',
      'reward': {'amount': 100.0, 'currency': 'NGN'},
      'summary': {
        'invites': 3,
        'pending': includeRewards ? 100.0 : 0.0,
        'paid': includeRewards ? 200.0 : 0.0,
      },
      'referrals': includeRewards
          ? [
              {
                'id': 'referral-1',
                'referredName': 'Grace Hopper',
                'amount': 100.0,
                'currency': 'NGN',
                'status': 'PAID',
                'createdAt': '2026-06-22T09:00:00.000Z',
              },
            ]
          : <Map<String, dynamic>>[],
    };
  }

  Map<String, dynamic> _wallet(String currency, double balance) {
    return {
      'id': 'wallet-${currency.toLowerCase()}',
      'currency': currency,
      'balance': balance,
      'updatedAt': '2026-06-22T12:00:00.000Z',
    };
  }
}
