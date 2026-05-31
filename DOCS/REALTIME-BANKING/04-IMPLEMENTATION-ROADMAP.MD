# Real-Time Banking Implementation Roadmap

## Phase Order

1. Compliance and Provider Readiness
2. Data Model and Ledger Foundation
3. Virtual Accounts and Deposits
4. Internal Transfers
5. Withdrawals and Beneficiaries
6. Admin Operations and Reconciliation
7. Frontend, Mobile, and Launch Readiness

## Dependency Rules

- Do not build provider account provisioning before compliance/provider readiness is confirmed.
- Do not build deposits, transfers, or withdrawals before ledger and provider event storage exist.
- Do not build frontend submit flows before backend idempotency contracts are stable.
- Do not launch live provider credentials before admin operations and reconciliation are complete.

## Definition Of Done For Every Phase

- DTOs and schemas are defined.
- `DOCS/SECURITY-RULES.MD` is satisfied.
- Tests cover duplicate request, failure, and permission boundaries.
- Admin visibility exists for any new money movement.
- Logs are structured and do not expose secrets or full account numbers.
- Rollback or recovery behavior is documented.

## Recommended Branching

Use one branch per phase:

- `codex/banking-phase-01-readiness`
- `codex/banking-phase-02-ledger-foundation`
- `codex/banking-phase-03-virtual-accounts`
- `codex/banking-phase-04-internal-transfers`
- `codex/banking-phase-05-withdrawals`
- `codex/banking-phase-06-admin-reconciliation`
- `codex/banking-phase-07-frontend-launch`

Each phase should merge only after review by the required role owners in `02-TEAM-AND-ASYNC-WORKFLOW.MD`.

