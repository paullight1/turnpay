# BVN confirmation and receiving-account recovery

The owner requested working NGN account requests immediately after verified BVN, clearer account setup guidance, and verification emails through Resend or a configurable SMTP sender.

Read-only diagnostics found a verified Tier 1 customer and Paystack binding with an ACTION_REQUIRED account request. Paystack returned two eligible providers using `provider_slug`; the adapter reads `bank_slug`/`slug`, so it rejects the bank list before creating an account. No provider account creation was attempted in diagnostics.

Implementation:

1. Reproduce the official provider response in adapter tests, then fix bank selection without weakening verification, consent, recovery-before-create or account validation.
2. Ensure a saved setup request can continue promptly after confirmed BVN. Account creation still requires stored consent and provider confirmation. Replays must not issue another account.
3. Save a deduplicated customer inbox event and transactional-email outbox entry with confirmed BVN and account-ready state. Deliver asynchronously using a configured Resend API or SMTP transport; leave missing-configuration work queued and prevent ambiguous SMTP outcomes from generating automatic duplicate sends.
4. Explain verified identity, account preparation and retryable setup failures separately in Flutter. Keep a single clear next action, preserve consent/idempotency, and link notifications to verification/account screens.
5. Test provider response shape, verified-request recovery, webhook/event replay, email retry/claim/unknown states and mobile layouts. Use synthetic accounts/transports. No live account issuance or bulk retrospective notification sends in verification.

Supabase Auth remains the login/OTP sender. Transactional verification emails use the backend sender configuration, which can reuse Resend or SMTP credentials installed securely for the backend. Never place credentials in app defines or source.
