import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/auth_service.dart';

void main() {
  for (final type in [
    DioExceptionType.connectionError,
    DioExceptionType.connectionTimeout,
    DioExceptionType.receiveTimeout,
    DioExceptionType.sendTimeout,
    DioExceptionType.unknown,
  ]) {
    test('dashboard $type failures never expose transport diagnostics', () {
      final request = RequestOptions(path: '/api/transactions');
      final message = authErrorMessage(
        DioException(
          requestOptions: request,
          type: type,
          message: 'XMLHttpRequest onError: SocketException internal-host',
        ),
        'Dashboard could not load',
      );
      expect(message, isNot(contains('XMLHttpRequest')));
      expect(message, isNot(contains('internal-host')));
      expect(message, contains('TrustPay'));
      expect(message.toLowerCase(), contains('try again'));
    });
  }
  test('server outages hide internal payloads on protected reads', () {
    final request = RequestOptions(path: '/api/wallets');
    final message = authErrorMessage(
      DioException(
        requestOptions: request,
        response: Response(
          requestOptions: request,
          statusCode: 503,
          data: {'message': 'Prisma query failed at private-db:5432'},
        ),
      ),
      'Unable to load wallets',
    );
    expect(message, contains('temporarily unavailable'));
    expect(message, isNot(contains('Prisma')));
    expect(message, isNot(contains('private-db')));
  });
  test('uncertain payment failures preserve the existing recovery instructions',
      () {
    final request = RequestOptions(path: '/api/vtu/airtime', method: 'POST');
    const fallback = 'Check the original payment status before trying again.';
    for (final status in [null, 502]) {
      final error = DioException(
        requestOptions: request,
        message: 'XMLHttpRequest onError',
        response: status == null
            ? null
            : Response(
                requestOptions: request,
                statusCode: status,
                data: {'message': 'Bad Gateway'}),
      );
      expect(authErrorMessage(error, fallback), fallback);
    }
  });
  test('protected read expiry offers sign-in instead of raw rejection text',
      () {
    final request = RequestOptions(path: '/api/transactions');
    expect(
        authErrorMessage(
            DioException(
              requestOptions: request,
              response: Response(
                  requestOptions: request,
                  statusCode: 401,
                  data: {'message': 'JWT expired at internal verifier'}),
            ),
            'Unable to load history'),
        'Your session has expired. Please sign in again.');
  });
  test('business validation remains actionable', () {
    final request = RequestOptions(path: '/api/transfers', method: 'POST');
    expect(
        authErrorMessage(
            DioException(
              requestOptions: request,
              response: Response(
                  requestOptions: request,
                  statusCode: 400,
                  data: {'message': 'Insufficient balance'}),
            ),
            'Transfer could not complete'),
        'Insufficient balance');
  });
  test(
      'an uncertain BVN response does not falsely claim submission or rejection',
      () {
    final request = RequestOptions(path: '/api/kyc/verify');
    final error = DioException(
        requestOptions: request,
        response: Response(
            requestOptions: request,
            statusCode: 500,
            data: {'message': 'Internal server error'}));
    expect(authErrorMessage(error, 'Unable to verify identity'),
        'We could not confirm your verification result. Check verification status before retrying. Your entered details have been kept.');
  });
  for (final route in ['login', 'bootstrap', 'refresh']) {
    test('$route network failures do not imply invalid credentials', () {
      final request = RequestOptions(path: '/api/auth/$route');
      expect(
        authErrorMessage(
            DioException(
                requestOptions: request,
                type: DioExceptionType.connectionTimeout),
            'Try again'),
        'Could not connect to TrustPay. Check your connection and try again.',
      );
      expect(
        authErrorMessage(
            DioException(
                requestOptions: request,
                response: Response(requestOptions: request, statusCode: 503)),
            'Try again'),
        'TrustPay is temporarily unavailable. Please try again shortly.',
      );
    });
  }
  test('registration conflicts provide a safe account recovery path', () {
    final request = RequestOptions(path: '/api/auth/register');
    final error = DioException(
      requestOptions: request,
      response: Response<dynamic>(
        requestOptions: request,
        statusCode: 409,
      ),
    );

    expect(
      authErrorMessage(error, 'Registration failed'),
      'An account already uses that email or phone number. Sign in with the email already linked to your account.',
    );
  });

  test('registration conflict identifies a duplicate phone number', () {
    final request = RequestOptions(path: '/api/auth/register');
    final error = DioException(
      requestOptions: request,
      response: Response<dynamic>(
        requestOptions: request,
        statusCode: 409,
        data: {
          'message': {
            'code': 'PHONE_ALREADY_REGISTERED',
            'message':
                'That phone number is already linked to a TrustPay account.',
          },
        },
      ),
    );

    expect(
      authErrorMessage(error, 'Registration failed'),
      'That phone number is already linked to a TrustPay account. Use a different phone number or sign in with the linked email.',
    );
  });

  test(
      'generic login rejection offers verification without claiming a wrong password',
      () {
    final request = RequestOptions(path: '/api/auth/login');
    final error = DioException(
      requestOptions: request,
      response: Response<dynamic>(
        requestOptions: request,
        statusCode: 401,
      ),
    );

    expect(
      authErrorMessage(error, 'Login failed'),
      'Unable to sign in. Check your email and password, or choose Verify email if you have not confirmed it yet.',
    );
  });
}
