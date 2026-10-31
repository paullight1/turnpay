import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/kyc_service.dart';

class _Kyc extends KycService {
  int uploads = 0;
  int urls = 0;
  int? rejectStatus;
  bool failFirstSubmit = true;
  bool uploadTimeout = false;
  final keys = <String>[];
  final objects = <String>[];

  @override
  Future<KycDocumentUpload> createDocumentUploadUrl(
      {required String fileName,
      required String contentType,
      required int fileSize,
      String? idempotencyKey}) async {
    urls++;
    return KycDocumentUpload(
        objectKey: 'kyc/test/evidence-$urls.pdf',
        signedUrl: 'https://storage.example.test/evidence-$urls');
  }

  @override
  Future<void> uploadDocumentBytes(
      {required KycDocumentUpload upload,
      required String contentType,
      required Uint8List bytes}) async {
    uploads++;
    if (uploadTimeout && uploads == 1) {
      throw DioException(
          requestOptions: RequestOptions(path: upload.signedUrl),
          type: DioExceptionType.sendTimeout);
    }
  }

  @override
  Future<KycVerificationResult> submitManualDocument(
      {required String idempotencyKey,
      required String idNumber,
      required String objectKey,
      required bool consentAccepted}) async {
    keys.add(idempotencyKey);
    objects.add(objectKey);
    if (failFirstSubmit && keys.length == 1) {
      final request = RequestOptions(path: '/api/kyc/manual-documents');
      throw DioException(
          requestOptions: request,
          type: rejectStatus == null
              ? DioExceptionType.receiveTimeout
              : DioExceptionType.badResponse,
          response: rejectStatus == null
              ? null
              : Response(requestOptions: request, statusCode: rejectStatus));
    }
    return const KycVerificationResult(
        status: 'SUBMITTED',
        provider: 'Paystack',
        reference: 'test',
        accountProvisioningStatus: 'NOT_REQUIRED');
  }
}

void main() {
  test('timed-out evidence upload retries the same object before submitting',
      () async {
    final service = _Kyc()
      ..uploadTimeout = true
      ..failFirstSubmit = false;
    final attempt = ManualNinSubmission(service: service);
    Future<KycVerificationResult> submit() => attempt.submit(
        idNumber: '77777777777',
        fileName: 'evidence.pdf',
        contentType: 'application/pdf',
        bytes: Uint8List.fromList([1, 2, 3]));
    await expectLater(submit(), throwsA(isA<DioException>()));
    expect(service.keys, isEmpty);
    await submit();
    expect(service.uploads, 2);
    expect(service.urls, 1);
    expect(service.objects, ['kyc/test/evidence-1.pdf']);
  });
  test(
      'uncertain NIN submission reuses uploaded evidence and the submission key',
      () async {
    final service = _Kyc();
    final attempt = ManualNinSubmission(service: service);
    Future<KycVerificationResult> submit() => attempt.submit(
        idNumber: '77777777777',
        fileName: 'evidence.pdf',
        contentType: 'application/pdf',
        bytes: Uint8List.fromList([1, 2, 3]));
    await expectLater(submit(), throwsA(isA<DioException>()));
    await submit();
    expect(service.keys[0], service.keys[1]);
    expect(service.objects[0], service.objects[1]);
    expect(service.uploads, 1);
    expect(service.urls, 1);
  });
  test('definitively rejected NIN submission starts a new attempt', () async {
    final service = _Kyc()..rejectStatus = 422;
    final attempt = ManualNinSubmission(service: service);
    Future<KycVerificationResult> submit() => attempt.submit(
        idNumber: '77777777777',
        fileName: 'evidence.pdf',
        contentType: 'application/pdf',
        bytes: Uint8List.fromList([1, 2, 3]));
    await expectLater(submit(), throwsA(isA<DioException>()));
    await submit();
    expect(service.keys[0], isNot(service.keys[1]));
  });
}
