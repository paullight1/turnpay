import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/kyc_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Map<String, dynamic> profile;
  late List<RequestOptions> requests;
  late KycService service;
  var loseSaveResponse = false;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    profile = {
      'fullName': '',
      'phone': '',
      'country': 'NG',
      'kycStatus': 'PENDING'
    };
    requests = [];
    loseSaveResponse = false;
    final dio = Dio(BaseOptions(baseUrl: 'https://kyc.example.test'));
    final api = ApiClient(dio: dio);
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      requests.add(options);
      if (options.path == '/api/users/me' && options.method == 'GET') {
        handler.resolve(Response(
            requestOptions: options, statusCode: 200, data: {...profile}));
      } else if (options.path == '/api/users/me' && options.method == 'PATCH') {
        profile.addAll(Map<String, dynamic>.from(options.data as Map));
        profile['profileDetailsUpdatedAt'] = '2026-10-31T10:00:00Z';
        if (loseSaveResponse) {
          handler.reject(DioException(
              requestOptions: options, type: DioExceptionType.receiveTimeout));
        } else {
          handler.resolve(Response(
              requestOptions: options, statusCode: 200, data: {...profile}));
        }
      } else if (options.path == '/api/kyc/status') {
        handler.resolve(Response(
            requestOptions: options,
            statusCode: 200,
            data: {'kycStatus': 'PENDING', 'kycTier': 'TIER_0'}));
      } else {
        handler.reject(DioException(
            requestOptions: options, message: 'Unexpected test endpoint'));
      }
    }));
    service = KycService(apiClient: api);
  });

  Future<bool> prepare() => service.ensureIdentityProfile(
      firstName: 'Ada',
      lastName: 'Byron Lovelace',
      phone: '0801 234 5678',
      yearOfBirth: 1990,
      idempotencyKey: 'profile-attempt-1');

  test('overview includes saved phone, lock state and every legal name part',
      () async {
    profile.addAll({
      'fullName': 'Ada Byron Lovelace',
      'phone': '+2348012345678',
      'profileDetailsUpdatedAt': '2026-10-31T10:00:00Z'
    });
    final overview = await service.fetchOverview(includeIdentityProfile: true);
    expect(overview.firstName, 'Ada');
    expect(overview.lastName, 'Byron Lovelace');
    expect(overview.phone, '+2348012345678');
    expect(overview.profileIdentityLocked, isTrue);
  });
  test('status-only callers do not depend on profile availability', () async {
    final overview = await service.fetchOverview();
    expect(overview.status, 'PENDING');
    expect(
        requests.where((request) => request.path == '/api/users/me'), isEmpty);
  });
  test('saves normalized legal name and phone with an idempotency key',
      () async {
    expect(await prepare(), isTrue);
    final update = requests.singleWhere((request) => request.method == 'PATCH');
    expect(update.data, {
      'fullName': 'Ada Byron Lovelace',
      'phone': '+2348012345678',
      'yearOfBirth': 1990,
      'country': 'NG'
    });
    expect(update.headers['Idempotency-Key'], 'profile-attempt-1');
  });
  test('unchanged protected profile needs no update', () async {
    profile.addAll({
      'fullName': 'ada byron lovelace',
      'phone': '+2348012345678',
      'profileDetailsUpdatedAt': '2026-10-31T10:00:00Z'
    });
    expect(await prepare(), isTrue);
    expect(requests.where((request) => request.method == 'PATCH'), isEmpty);
  });
  test('unchanged unlocked profile retains its allowed edit', () async {
    profile
        .addAll({'fullName': 'Ada Byron Lovelace', 'phone': '+2348012345678'});
    expect(await prepare(), isFalse);
    expect(requests.where((request) => request.method == 'PATCH'), isEmpty);
  });
  test('changed locked identity is blocked without a profile mutation',
      () async {
    profile['profileDetailsUpdatedAt'] = '2026-10-31T10:00:00Z';
    await expectLater(prepare(), throwsA(isA<KycProfileException>()));
    expect(requests.where((request) => request.method == 'PATCH'), isEmpty);
  });
  test('a lost profile-save response retries by reading the saved details',
      () async {
    loseSaveResponse = true;
    await expectLater(prepare(), throwsA(isA<DioException>()));
    await prepare();
    expect(
        requests.where((request) => request.method == 'PATCH'), hasLength(1));
  });
  test('invalid phone is rejected before any request', () async {
    await expectLater(
        service.ensureIdentityProfile(
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '123',
            yearOfBirth: 1990,
            idempotencyKey: 'invalid'),
        throwsA(isA<KycProfileException>()));
    expect(requests, isEmpty);
  });
}
