import { BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import {
  fromMinorUnit,
  toMinorUnit,
  toProviderDecimalString,
} from "./provider-amount";

describe("provider amount mapping", () => {
  it("maps Decimal amounts to exact minor units", () => {
    expect(toMinorUnit(new Decimal("1000.25"))).toBe(100025);
  });

  it("rejects amounts with unsupported precision for minor units", () => {
    expect(() => toMinorUnit(new Decimal("1000.255"))).toThrow(
      BadRequestException,
    );
  });

  it("maps provider minor units back to Decimal major units", () => {
    expect(fromMinorUnit(100025).toFixed(2)).toBe("1000.25");
  });

  it("emits exact decimal strings for providers that accept major units", () => {
    expect(toProviderDecimalString(new Decimal("1000.2"))).toBe("1000.20");
  });
});
