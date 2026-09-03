/**
 * Seeds the default VTU pricing rules (TrustPay's markup on top of VTPass
 * commission). Idempotent: re-running updates the same rules in place,
 * matched by metadata.seedKey. Admin can tune or deactivate them afterwards
 * in Admin -> VTU -> pricing rules.
 *
 * Airtime deliberately has NO rule: it sells at face value and earns the
 * 3-3.5% VTPass commission only, matching market pricing.
 *
 * Run with: npm run seed:vtu-pricing
 */
import { PrismaClient, Prisma, TransactionType } from "@prisma/client";

const prisma = new PrismaClient();

type SeedRule = {
  seedKey: string;
  serviceType: TransactionType;
  fixedMargin: string;
  percentMargin: string;
  note: string;
};

const RULES: SeedRule[] = [
  {
    seedKey: "ng-data-margin",
    serviceType: "DATA",
    fixedMargin: "0",
    percentMargin: "2",
    note: "2% margin on data bundles",
  },
  {
    seedKey: "ng-cable-fee",
    serviceType: "CABLE",
    fixedMargin: "100",
    percentMargin: "0",
    note: "NGN 100 convenience fee on cable TV",
  },
  {
    seedKey: "ng-electricity-fee",
    serviceType: "ELECTRICITY",
    fixedMargin: "100",
    percentMargin: "0",
    note: "NGN 100 convenience fee on electricity",
  },
];

async function main() {
  for (const rule of RULES) {
    const metadata = {
      seedKey: rule.seedKey,
      note: rule.note,
    } as Prisma.InputJsonValue;
    const data = {
      countryCode: "NG",
      serviceType: rule.serviceType,
      scope: "LOCAL" as const,
      fixedMargin: new Prisma.Decimal(rule.fixedMargin),
      percentMargin: new Prisma.Decimal(rule.percentMargin),
      priority: 10,
      isActive: true,
      metadata,
    };

    const existing = await prisma.vtuPricingRule.findFirst({
      where: { metadata: { path: ["seedKey"], equals: rule.seedKey } },
    });

    if (existing) {
      await prisma.vtuPricingRule.update({
        where: { id: existing.id },
        data,
      });
      console.log(`Updated pricing rule ${rule.seedKey} (${existing.id})`);
    } else {
      const created = await prisma.vtuPricingRule.create({ data });
      console.log(`Created pricing rule ${rule.seedKey} (${created.id})`);
    }
  }

  console.log(
    "Done. Airtime intentionally has no markup rule (face value + VTPass commission).",
  );
}

main()
  .catch((error) => {
    console.error("VTU pricing seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
