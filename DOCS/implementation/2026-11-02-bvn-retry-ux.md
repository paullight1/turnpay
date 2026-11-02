# BVN profile retries and TrustPay account UX

The profile-save step could return an internal error when its unique phone constraint was violated. `UsersService.update` now translates that precise Prisma conflict into `409 PROFILE_PHONE_IN_USE`; other database errors retain their original handling. The failed transaction cannot consume the profile edit or write its success audit. Existing identity locks, validation, authentication, audit and idempotency controls remain in force.

Flutter reads both flat and standard nested conflict envelopes. A phone conflict stays correctable, while a locked identity still requires support. A temporary profile-save error explains that the BVN request has not been sent from that step; retry first reads the saved profile, preserving recovery after a lost successful PATCH response. An uncertain BVN-provider response tells the customer to check verification status, without claiming acceptance, rejection or approval. Pending attempts retain their existing idempotency and reconciliation behavior.

Bank options are prefetched, coalesced and cached for five minutes per KYC service instance. Empty or failed responses remain retryable. The screen does not hold a permanently failed prefetch future. The default HTTP timeout is shorter than the cache lifetime.

Customer account presentation uses TrustPay branding. Receive-money empty/pending states are compact top-aligned cards, with a clear TrustPay receiving-account action. Actual bank names/provider identifiers and explicit third-party verification/account-creation consent remain truthful. BVN inputs have persistent labels, larger bold values, more spacing and responsive actions, including narrow dark mode with large text.

Verification: 84 focused Flutter regressions, 64 backend KYC/profile tests, two synthetic phone/dark-large-text visual capture scenarios, Flutter analysis, backend build, affected backend lint and whitespace checks passed. The phone conflict, lost-profile-response handling, cache behavior, nested error envelope and uncertain-verification copy were observed failing before their fixes. Independent review found no important blocker in the profile/cache changes.

No real BVN submission, bank-account creation, profile unlock, identity decision or tier promotion was performed by the agent. Genuine identity confirmation remains dependent on the provider result. Read-only investigation and synthetic fixtures do not constitute live provider acceptance.
