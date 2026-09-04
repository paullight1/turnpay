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
      'Unable to complete registration. Try signing in or reset your password.',
    );
  });
}
