import { expect, test } from "@playwright/test";

import {
  maskAccountNumber,
  maskEmail,
  maskKycId,
  maskPhone,
  redactTransactionMetadata,
} from "../src/lib/privacy";
import { createMoneyAttemptIdempotencyKey } from "../src/lib/idempotency";

test.describe("privacy helpers", () => {
  test("masks identity and contact fields without exposing full values", () => {
    expect(maskKycId("12345678901")).toBe("*******8901");
    expect(maskAccountNumber("0123456789")).toBe("01****6789");
    expect(maskPhone("+2348012345678")).toBe("+234******5678");
    expect(maskEmail("customer@example.com")).toBe("c******r@example.com");
  });

  test("allowlists transaction metadata and masks sensitive account fields", () => {
    const rows = redactTransactionMetadata({
      provider: "Paystack",
      accountNumber: "0123456789",
      recipientNumber: "08012345678",
      bvn: "12345678901",
      password: "secret",
      rawProviderPayload: { accountNumber: "0123456789" },
    });

    expect(rows).toEqual([
      { label: "Provider", value: "Paystack" },
      { label: "Account number", value: "01****6789" },
      { label: "Recipient", value: "080****5678" },
    ]);
  });

  test("creates scoped idempotency keys for visible money attempts", () => {
    const first = createMoneyAttemptIdempotencyKey("withdraw");
    const second = createMoneyAttemptIdempotencyKey("withdraw");

    expect(first).toMatch(/^withdraw:[0-9a-f-]{36}$/);
    expect(second).toMatch(/^withdraw:[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});
