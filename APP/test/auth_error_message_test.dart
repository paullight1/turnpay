import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/auth_service.dart';

void main() {
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
