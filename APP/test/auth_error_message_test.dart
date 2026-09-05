import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/auth_service.dart';

void main() {
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

  test('login rejection offers password recovery without exposing details', () {
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
      'Incorrect email or password. Try again or reset your password.',
    );
  });
}
