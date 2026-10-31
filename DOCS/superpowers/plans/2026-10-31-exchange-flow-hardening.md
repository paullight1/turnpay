# Exchange flow and codebase hardening

The user requested a critique and implementation using the already selected manual product behavior: cedis fund an NGN TrustPay wallet; naira funds a cedi bank/MoMo payout performed by the assigned admin. Kora stays unactivated.

1. Add failing policy, real-database and Flutter cases for new delivery choices; make server configuration authoritative and reject unsupported new orders after checking durable replay. Preserve historical orders and journal recovery. Put Cedis to naira first and describe actual receiving outcomes plainly.
2. Add a real-database regression for payout claims under a reconciliation hold. Require fresh customer eligibility and settlement checks before claim succeeds, with the existing transaction/audit/idempotency boundaries.
3. Add validated cursor pagination for the manual admin queue and global status counts. Preserve the old array endpoint for existing callers; migrate the operator UI to the new envelope and account-scoped queries, bounded pages and Load more. Test older obligations, filter consistency and UI navigation.
4. Run focused Flutter and financial cases, full backend tests, lint/type checks and admin desktop/phone browser tests; independently review the isolated patch and fix material findings. Document remaining architectural limits without claiming a whole-repository security audit.

No production migration, wallet movement, external message or deployment is part of this task. New behavior is verified on disposable local data. Existing dirty work remains uncommitted and unchanged outside the scoped files.
