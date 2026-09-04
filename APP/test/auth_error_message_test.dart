import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/auth_service.dart';

void main() {
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
      'An account already exists with these details. Taking you to log in…',
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
