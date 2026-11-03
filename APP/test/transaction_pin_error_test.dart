import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/security/screens/transaction_security_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';

DioException _buildDioException({
  required dynamic data,
  int statusCode = 409,
}) {
  final requestOptions = RequestOptions(
    path: '/api/auth/transaction-pin',
  );

  return DioException(
    requestOptions: requestOptions,
    response: Response<dynamic>(
      requestOptions: requestOptions,
      statusCode: statusCode,
      data: data,
    ),
    type: DioExceptionType.badResponse,
  );
}

void main() {
  test(
      'a payment PIN rejection has actionable copy without pretending a network failure is final',
      () {
    expect(
        transactionPinRejectionMessage(_buildDioException(
            statusCode: 403, data: {'message': 'Invalid transaction PIN'})),
        'Incorrect transaction PIN. Try again.');
    expect(
        transactionPinRejectionMessage(_buildDioException(
            statusCode: 500, data: {'message': 'Invalid transaction PIN'})),
        isNull);
  });
  group('isTransactionPinAlreadySetError', () {
    test('detects the nested conflict payload returned by the backend', () {
      final error = _buildDioException(
        data: {
          'message': {
            'message': 'Transaction PIN is already set',
            'error': 'Conflict',
            'statusCode': 409,
          },
        },
      );

      expect(isTransactionPinAlreadySetError(error), isTrue);
    });

    test('ignores non-conflict responses', () {
      final error = _buildDioException(
        statusCode: 400,
        data: {
          'message': 'Transaction PIN must be 4 to 6 digits',
        },
      );

      expect(isTransactionPinAlreadySetError(error), isFalse);
    });
  });
}
