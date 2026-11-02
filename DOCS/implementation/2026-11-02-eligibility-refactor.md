# KYC and transaction eligibility refactor

This pass improves reliability around the approved BVN-first policy. It preserves Paystack BVN, Ninja NIN, the earned-tier policy, existing financial controls and the surrounding work already in the checkout.

## Changes

- Web eligibility is now a pure function shared by profile checks and the TanStack Query hook. The hook owns fetching; the function owns status precedence, tier eligibility and exact amount comparisons. The KYC page uses the same tier parser.
- Web and Flutter recognize only supported tiers 0–3, retaining compatible numeric payloads. Malformed values such as `TIER_99`, `TIER_-1` or `invalid2` cannot make the interface advertise transaction eligibility. Flutter overview presentation and route checks share the same core parser.
- Fresh web status overrides stale profile data. Account restriction takes priority, earned Tier 2 does not keep old Tier 1 caps, and an explicit invalid/missing Tier 1 policy produces support guidance. Older payloads without the optional policy field remain compatible.
- Backend wallet debits and external exchange share one eligibility assertion. External Tier 1 exchange checks the state returned with the wallet lock, rather than relying solely on the earlier user read; an observed restriction/revocation blocks the order and an observed upgrade stops applying stale Tier 1 limits. Existing Tier 2 external orders still do not require a source wallet.
- Pending BVN confirmation cannot advertise active Tier 1 or continue directly to NIN, even if a caller supplies a continuation callback. Verified BVN retains the optional upgrade action.
- The three existing KYC visual fixtures now open the current history control and check the pending-state status button at phone, dark/large-text and tablet sizes.

The client gates explain eligibility; server-side authorization remains authoritative. No new financial endpoint, schema, provider operation, production setting or deployment was introduced.

## Regression evidence

Before fixes, the new regressions failed on malformed client tiers, stale server-status handling, Tier 1 exact limits, pending-confirmation continuation and external eligibility changes between the initial user read and wallet query. A separate regression reproduced a stale Tier 1 cap after an observed upgrade. The three pre-existing visual tests also failed against the old history selector before repair.

Fresh verification logs are under `.superpowers/sdd/2026-11-02-reliability-refactor/`.

| Check | Result |
| --- | --- |
| Full backend unit suite | 770 passed across 103 suites |
| Isolated PostgreSQL/Redis financial integration | 89 passed across 13 suites |
| Full Flutter suite | 455 passed, including the three repaired visual fixtures |
| Pure web eligibility regressions | 8 passed |
| Desktop and phone KYC browser scenarios | 20 passed |
| Flutter screenshot fixtures | 3 passed at phone, dark/large-text and tablet sizes |
| Backend build, web TypeScript, affected ESLint | Passed |
| Flutter analysis | No issues found |

The first overlapping browser/full-mobile run was deliberately interrupted when local resource pressure left little free disk space. The financial and full-mobile runs subsequently finished successfully; the separate final browser run passed all 20 scenarios. No test fixture reached live provider identity or payment operations.

Screenshots: [pending phone confirmation](../../output/kyc-review/submitted-430-light.png), [dark mode with large text](../../output/kyc-review/submitted-320-dark-large.png), [tablet confirmation](../../output/kyc-review/submitted-726-light.png).
