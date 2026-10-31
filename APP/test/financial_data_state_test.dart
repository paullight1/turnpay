import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:trustpay_app/core/state/resource_state.dart';
import 'package:trustpay_app/features/home/widgets/recent_transactions_list.dart';
import 'package:trustpay_app/features/wallet/screens/receive_money_screen.dart';
import 'package:trustpay_app/features/wallet/screens/wallet_detail_screen.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/home_data_service.dart';
import 'package:trustpay_app/services/wallet_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('financial response states', () {
    test('distinguishes a real empty collection from an unavailable wallet',
        () async {
      final emptyService = _serviceFor(
        route: '/api/transactions',
        response: {'transactions': []},
      );
      final empty = await emptyService.fetchTransactionsState();

      expect(empty.status, ResourceStatus.empty);
      expect(empty.isEmpty, isTrue);
      expect(empty.value, isNull);

      final unavailableService = _serviceFor(
        route: '/api/transactions',
        statusCode: 503,
        response: {'message': 'temporarily unavailable'},
      );
      final unavailable = await unavailableService.fetchTransactionsState();

      expect(unavailable.status, ResourceStatus.unavailable);
      expect(unavailable.isUnavailable, isTrue);
      expect(unavailable.error, isA<DioException>());
      expect(unavailable.value, isNull);

      final stale = await unavailableService.fetchTransactionsState(
        previousValue: const TransactionListResponse(
          transactions: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        ),
        lastUpdated: DateTime.utc(2026, 9, 5, 9),
      );
      expect(stale.status, ResourceStatus.stale);
      expect(stale.value, isA<TransactionListResponse>());
      expect(stale.lastRefreshAt, DateTime.utc(2026, 9, 5, 9));

      final emptyHomeService = _homeServiceFor(
        route: '/api/transactions',
        response: {'transactions': []},
      );
      expect(
        (await emptyHomeService.fetchTransactions()).isEmpty,
        isTrue,
      );

      final unavailableHomeService = _homeServiceFor(
        route: '/api/transactions',
        statusCode: 503,
        response: {'message': 'temporarily unavailable'},
      );
      await expectLater(
        unavailableHomeService.fetchTransactions(),
        throwsA(isA<DioException>()),
      );
    });

    test('rethrows service outages from legacy futures', () async {
      final service = _serviceFor(
        route: '/api/wallets/NGN',
        statusCode: 503,
        response: {'message': 'wallet service unavailable'},
      );

      await expectLater(
          service.fetchWallet('NGN'), throwsA(isA<DioException>()));

      final depositsService = _serviceFor(
        route: '/api/transactions',
        statusCode: 503,
        response: {'message': 'deposit history unavailable'},
      );
      await expectLater(
        depositsService.fetchRecentDeposits(),
        throwsA(isA<DioException>()),
      );
    });

    test('keeps a successful empty deposit response as empty', () async {
      final service = _serviceFor(
        route: '/api/transactions',
        response: {'transactions': []},
      );

      expect(await service.fetchRecentDeposits(), isEmpty);
    });

    test('treats an actual resource 404 as missing', () async {
      final walletService = _serviceFor(
        route: '/api/wallets/NGN',
        statusCode: 404,
        response: {'message': 'wallet not found'},
      );
      final wallet = await walletService.fetchWallet('NGN');
      expect(wallet, isNull);

      final transactionService = _serviceFor(
        route: '/api/transactions/tx-missing',
        statusCode: 404,
        response: {'message': 'transaction not found'},
      );
      final transaction =
          await transactionService.fetchTransactionDetail('tx-missing');
      expect(transaction, isNull);
    });

    test('does not turn a malformed financial field into zero', () {
      expect(
        () => WalletData.fromJson({
          'id': 'wallet-1',
          'currency': 'NGN',
          'balance': 'not-a-balance',
        }),
        throwsFormatException,
      );

      final wallet = WalletData.fromJson({
        'id': 'wallet-1',
        'currency': 'NGN',
        'balance': '9999999999999.99',
      });
      expect(wallet.balanceDecimalString, '9999999999999.99');
      expect(wallet.exactBalance.minorUnits, BigInt.parse('999999999999999'));

      expect(
        () => TransactionSummary.fromJson({
          'id': 'tx-1',
          'amount': '1.001',
          'fee': '0.00',
        }),
        throwsFormatException,
      );
    });

    test('models stale data with its last successful refresh time', () {
      final refreshedAt = DateTime.utc(2026, 9, 5, 10);
      final stale = ResourceState<List<String>>.stale(
        const ['known transaction'],
        error: StateError('refresh failed'),
        lastUpdated: refreshedAt,
      );

      expect(stale.isStale, isTrue);
      expect(stale.requireValue(), const ['known transaction']);
      expect(stale.lastRefreshAt, refreshedAt);
      expect(stale.error, isA<StateError>());
    });

    test('keeps auth rejection separate from unavailable data', () {
      final auth = ResourceState<List<String>>.authRequired(
        error: StateError('session expired'),
      );
      expect(auth.isAuthRequired, isTrue);
      expect(auth.isUnavailable, isFalse);
      expect(auth.hasError, isFalse);
    });

    testWidgets('recent transactions shows retry state for a 503',
        (tester) async {
      final service = _homeServiceFor(
        route: '/api/transactions',
        statusCode: 503,
        response: {'message': 'transactions temporarily unavailable'},
      );

      await tester.pumpWidget(
        MaterialApp(
          home: RecentTransactionsList(homeDataService: service),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(find.text('No transactions yet'), findsNothing);
      expect(find.text('transactions temporarily unavailable'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets(
        'recent transactions shows empty state for a successful empty response',
        (tester) async {
      final service = _homeServiceFor(
        route: '/api/transactions',
        response: {'transactions': []},
      );

      await tester.pumpWidget(
        MaterialApp(
          home: RecentTransactionsList(homeDataService: service),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(find.text('No transactions yet'), findsOneWidget);
      expect(find.text('Retry'), findsNothing);
    });

    testWidgets('wallet detail shows unavailable deposit history for a 503',
        (tester) async {
      final service = _StubWalletService(
        depositError: _serviceUnavailableError(),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: WalletDetailScreen(
            currency: 'NGN',
            walletService: service,
          ),
        ),
      );
      await _pumpForData(tester);
      await tester.drag(
        find.byType(CustomScrollView),
        const Offset(0, -500),
      );
      await _pumpForData(tester);

      expect(find.text('Deposit history unavailable'), findsOneWidget);
      expect(find.text('No deposits yet'), findsNothing);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('wallet detail shows empty deposit history for a 200 empty',
        (tester) async {
      final service = _StubWalletService();

      await tester.pumpWidget(
        MaterialApp(
          home: WalletDetailScreen(
            currency: 'NGN',
            walletService: service,
          ),
        ),
      );
      await _pumpForData(tester);
      await tester.drag(
        find.byType(CustomScrollView),
        const Offset(0, -500),
      );
      await _pumpForData(tester);

      expect(find.text('No deposits yet'), findsOneWidget);
      expect(find.text('Deposit history unavailable'), findsNothing);
    });

    testWidgets('receive money shows unavailable deposit history for a 503',
        (tester) async {
      final service = _StubWalletService(
        depositError: _serviceUnavailableError(),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ReceiveMoneyScreen(walletService: service),
        ),
      );
      await _pumpForData(tester);
      await tester.drag(
        find.byType(CustomScrollView),
        const Offset(0, -500),
      );
      await _pumpForData(tester);

      expect(find.text('Deposit history unavailable'), findsOneWidget);
      expect(find.text('No deposits yet'), findsNothing);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('receive money hides empty deposit history for a 200 empty',
        (tester) async {
      final service = _StubWalletService();

      await tester.pumpWidget(
        MaterialApp(
          home: ReceiveMoneyScreen(walletService: service),
        ),
      );
      await _pumpForData(tester);
      await tester.drag(
        find.byType(CustomScrollView),
        const Offset(0, -500),
      );
      await _pumpForData(tester);

      expect(find.text('No deposits yet'), findsNothing);
      expect(find.text('Deposit history unavailable'), findsNothing);
    });
  });
}

DioException _serviceUnavailableError() {
  final requestOptions = RequestOptions(path: '/api/transactions');
  return DioException(
    requestOptions: requestOptions,
    response: Response<dynamic>(
      requestOptions: requestOptions,
      statusCode: 503,
      data: const {'message': 'temporarily unavailable'},
    ),
    type: DioExceptionType.badResponse,
  );
}

Future<void> _pumpForData(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

class _StubWalletService extends WalletService {
  _StubWalletService({
    this.depositError,
  });

  final Object? depositError;

  @override
  Future<WalletData?> fetchWallet(String currency) async {
    return WalletData.fromJson({
      'id': 'wallet-1',
      'currency': currency,
      'balance': '10.00',
    });
  }

  @override
  Future<List<DepositRecord>> fetchRecentDeposits({int limit = 10}) async {
    final error = depositError;
    if (error != null) throw error;
    return const [];
  }

  @override
  Future<List<VirtualAccountData>> fetchVirtualAccounts() async {
    return const [
      VirtualAccountData(
        // This stub exercises the active receiving-account/history state; the
        // dedicated legacy-provider case remains covered by account-list data.
        provider: 'paystack',
        accountNumber: '1234567890',
        accountNumberMasked: '1234******7890',
        accountName: 'Ada Lovelace',
        bankName: 'Test Bank',
        currency: 'NGN',
        status: 'ACTIVE',
      ),
    ];
  }
}

WalletService _serviceFor({
  required String route,
  required Object response,
  int statusCode = 200,
}) {
  return WalletService(
    apiClient: _apiClientFor(
      route: route,
      response: response,
      statusCode: statusCode,
    ),
  );
}

HomeDataService _homeServiceFor({
  required String route,
  required Object response,
  int statusCode = 200,
}) {
  return HomeDataService(
    apiClient: _apiClientFor(
      route: route,
      response: response,
      statusCode: statusCode,
    ),
  );
}

ApiClient _apiClientFor({
  required String route,
  required Object response,
  required int statusCode,
}) {
  final dio = Dio(
    BaseOptions(baseUrl: 'https://financial-state.test'),
  )..httpClientAdapter = _SingleResponseAdapter(
      route: route,
      response: response,
      statusCode: statusCode,
    );
  return ApiClient(dio: dio);
}

class _SingleResponseAdapter implements HttpClientAdapter {
  _SingleResponseAdapter({
    required this.route,
    required this.response,
    required this.statusCode,
  });

  final String route;
  final Object response;
  final int statusCode;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.uri.path != route) {
      return ResponseBody.fromString(
        jsonEncode({'message': 'Unexpected ${options.uri.path}'}),
        404,
        headers: _headers,
      );
    }
    return ResponseBody.fromString(
      jsonEncode(response),
      statusCode,
      headers: _headers,
    );
  }

  @override
  void close({bool force = false}) {}

  Map<String, List<String>> get _headers => {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      };
}
