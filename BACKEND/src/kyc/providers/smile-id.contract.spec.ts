import { createHmac, timingSafeEqual } from 'crypto';

type TrustpayKycStatus = 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
type TrustpayKycTier = 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';
type TrustpayVerificationStatus =
  | 'PENDING'
  | 'REVIEW_REQUIRED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED';
type TrustpayKycType = 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';

type SmileCallbackFixture = {
  timestamp: string;
  signature: string;
  user_id: string;
  job_id: string;
  job_complete: boolean;
  job_success: boolean;
  result?: {
    ResultCode?: string;
    ResultText?: string;
    PartnerParams?: {
      user_id?: string;
      job_id?: string;
      document_id?: string;
      id_type?: TrustpayKycType;
      national_id_number?: string;
    };
    SmileJobID?: string;
    ConfidenceValue?: string;
  };
};

const partnerId = 'smile-partner-id';
const apiKey = 'smile-api-key';

const signSmilePayload = (timestamp: string) =>
  createHmac('sha256', apiKey)
    .update(timestamp, 'utf8')
    .update(partnerId, 'utf8')
    .update('sid_request', 'utf8')
    .digest()
    .toString('base64');

const verifySmileSignature = (
  receivedSignature: string,
  receivedTimestamp: string,
) => {
  const expected = Buffer.from(signSmilePayload(receivedTimestamp));
  const received = Buffer.from(receivedSignature);

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};

const normalizeSmileStatus = (
  payload: SmileCallbackFixture,
): {
  userStatus: TrustpayKycStatus;
  verificationStatus: TrustpayVerificationStatus;
  requiresManualReview: boolean;
} => {
  if (!payload.job_complete) {
    return {
      userStatus: 'SUBMITTED',
      verificationStatus: 'PENDING',
      requiresManualReview: false,
    };
  }

  if (payload.result?.ResultCode === '1021') {
    return {
      userStatus: 'SUBMITTED',
      verificationStatus: 'REVIEW_REQUIRED',
      requiresManualReview: true,
    };
  }

  if (payload.job_success && payload.result?.ResultCode?.startsWith('10')) {
    return {
      userStatus: 'VERIFIED',
      verificationStatus: 'VERIFIED',
      requiresManualReview: false,
    };
  }

  return {
    userStatus: 'REJECTED',
    verificationStatus: payload.result ? 'REJECTED' : 'FAILED',
    requiresManualReview: false,
  };
};

const resolveKycTier = (
  verifiedTypes: TrustpayKycType[],
  currentTier: TrustpayKycTier,
): TrustpayKycTier => {
  const verified = new Set(verifiedTypes);
  const eligible =
    verified.has('BVN') && verified.has('NIN')
      ? 'TIER_2'
      : verified.has('BVN') || verified.has('NIN')
        ? 'TIER_1'
        : 'TIER_0';
  const rank: Record<TrustpayKycTier, number> = {
    TIER_0: 0,
    TIER_1: 1,
    TIER_2: 2,
    TIER_3: 3,
  };

  return rank[eligible] > rank[currentTier] ? eligible : currentTier;
};

const smileProviderReference = (payload: SmileCallbackFixture) =>
  payload.result?.SmileJobID || payload.job_id;

const maskIdentifier = (value?: string) =>
  value ? `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}` : '';

const redactSmileCallback = (payload: SmileCallbackFixture) => ({
  userId: payload.user_id,
  jobId: payload.job_id,
  providerReference: smileProviderReference(payload),
  jobComplete: payload.job_complete,
  jobSuccess: payload.job_success,
  resultCode: payload.result?.ResultCode,
  resultText: payload.result?.ResultText,
  confidenceValue: payload.result?.ConfidenceValue,
  idType: payload.result?.PartnerParams?.id_type,
  identifierMasked: maskIdentifier(
    payload.result?.PartnerParams?.national_id_number,
  ),
});

describe('Smile ID KYC adapter contract', () => {
  it('verifies Smile ID callback signatures with the Smile HMAC contract', () => {
    const timestamp = '2026-06-10T12:00:00.000Z';
    const signature = signSmilePayload(timestamp);

    expect(verifySmileSignature(signature, timestamp)).toBe(true);
    expect(verifySmileSignature(`${signature.slice(0, -2)}xx`, timestamp)).toBe(
      false,
    );
  });

  it('normalizes successful Smile ID callbacks to TRUSTPAY verified status', () => {
    const payload: SmileCallbackFixture = {
      timestamp: '2026-06-10T12:00:00.000Z',
      signature: 'signature',
      user_id: 'user-1',
      job_id: 'job-1',
      job_complete: true,
      job_success: true,
      result: {
        ResultCode: '1020',
        ResultText: 'Exact Match',
        SmileJobID: 'smile-job-1',
        PartnerParams: {
          document_id: 'document-1',
          id_type: 'BVN',
          national_id_number: '12345678901',
        },
      },
    };

    expect(normalizeSmileStatus(payload)).toEqual({
      userStatus: 'VERIFIED',
      verificationStatus: 'VERIFIED',
      requiresManualReview: false,
    });
    expect(resolveKycTier(['BVN'], 'TIER_0')).toBe('TIER_1');
    expect(resolveKycTier(['BVN', 'NIN'], 'TIER_1')).toBe('TIER_2');
  });

  it('maps incomplete, ambiguous, failed, and rejected Smile ID results safely', () => {
    expect(
      normalizeSmileStatus({
        timestamp: '2026-06-10T12:00:00.000Z',
        signature: 'signature',
        user_id: 'user-1',
        job_id: 'job-pending',
        job_complete: false,
        job_success: false,
      }),
    ).toEqual({
      userStatus: 'SUBMITTED',
      verificationStatus: 'PENDING',
      requiresManualReview: false,
    });

    expect(
      normalizeSmileStatus({
        timestamp: '2026-06-10T12:00:00.000Z',
        signature: 'signature',
        user_id: 'user-1',
        job_id: 'job-partial',
        job_complete: true,
        job_success: true,
        result: { ResultCode: '1021', ResultText: 'Partial Match' },
      }),
    ).toEqual({
      userStatus: 'SUBMITTED',
      verificationStatus: 'REVIEW_REQUIRED',
      requiresManualReview: true,
    });

    expect(
      normalizeSmileStatus({
        timestamp: '2026-06-10T12:00:00.000Z',
        signature: 'signature',
        user_id: 'user-1',
        job_id: 'job-rejected',
        job_complete: true,
        job_success: false,
        result: { ResultCode: '1022', ResultText: 'No Match' },
      }),
    ).toEqual({
      userStatus: 'REJECTED',
      verificationStatus: 'REJECTED',
      requiresManualReview: false,
    });
  });

  it('uses Smile Job ID as the idempotent provider reference', () => {
    expect(
      smileProviderReference({
        timestamp: '2026-06-10T12:00:00.000Z',
        signature: 'signature',
        user_id: 'user-1',
        job_id: 'partner-job-1',
        job_complete: true,
        job_success: true,
        result: {
          SmileJobID: 'smile-job-1',
        },
      }),
    ).toBe('smile-job-1');
  });

  it('redacts Smile ID callback data before audit/provider-event storage', () => {
    const payload: SmileCallbackFixture = {
      timestamp: '2026-06-10T12:00:00.000Z',
      signature: 'raw-signature',
      user_id: 'user-1',
      job_id: 'job-1',
      job_complete: true,
      job_success: true,
      result: {
        ResultCode: '1020',
        ResultText: 'Exact Match',
        SmileJobID: 'smile-job-1',
        ConfidenceValue: '99',
        PartnerParams: {
          document_id: 'document-1',
          id_type: 'NIN',
          national_id_number: '98765432109',
        },
      },
    };

    const redacted = redactSmileCallback(payload);
    const serialized = JSON.stringify(redacted);

    expect(redacted).toEqual({
      userId: 'user-1',
      jobId: 'job-1',
      providerReference: 'smile-job-1',
      jobComplete: true,
      jobSuccess: true,
      resultCode: '1020',
      resultText: 'Exact Match',
      confidenceValue: '99',
      idType: 'NIN',
      identifierMasked: '*******2109',
    });
    expect(serialized).not.toContain('98765432109');
    expect(serialized).not.toContain('raw-signature');
    expect(serialized).not.toContain(apiKey);
  });
});
