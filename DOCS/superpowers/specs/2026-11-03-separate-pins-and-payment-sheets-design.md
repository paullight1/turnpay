# Separate PINs and faster payment confirmation

The owner requested distinct transaction and app-unlock PINs, optional phone-security unlock, faster reliable PIN handling, and larger review sheets that slide from the bottom.

## Approach

Use two independent credentials, as requested. The transaction PIN remains server-owned and authorizes money movements. A separately managed device-local PIN unlocks the app; supported phones may instead use OS authentication, including the phone's screen-lock credential. Keeping the current shared PIN would preserve the reported confusion. Using only phone authentication would remove the separately configurable unlock PIN the owner requested. Neither alternative is selected.

## Credential boundaries and migration

- Creating, checking, or changing the transaction PIN never stores or rewrites a device unlock PIN. Never persist a raw transaction PIN.
- Preserve the existing local unlock credential for existing installations; identify it to the user as the app-unlock PIN, and let them replace it independently. Do not silently disable an existing lock.
- App-PIN setup/change uses secure local storage, random salt, the existing PBKDF2 strength, lockouts, and authenticated-user binding. Changing an existing app PIN requires the current app PIN or fresh OS authentication. Changing users/signing out clears the appropriate device state.
- Enabling phone-security unlock requires a successful OS prompt. It can work without a custom app PIN. The browser has an app-PIN option; phone authentication is offered only where the platform supports it. Account-password recovery remains available.
- Keep server PIN lockouts, payment reset holds, idempotency, KYC, and all money-endpoint enforcement. Explain a reset hold and its end time rather than presenting it as a broken PIN.

## Faster authorization

Current payment approval performs a separate server PIN verification and then hashes/saves the same PIN locally before submitting a transaction that verifies it again. Remove local PIN work from transaction approval. Collect the freshly entered transaction PIN and send it only with the actual money request, whose server verifier remains authoritative. A collection screen must not claim the transaction has succeeded or the PIN has been verified. Invalid PIN and locked/held states remain actionable and retryable without creating a duplicate payment attempt.

Load transaction-PIN status alongside payment preparation where practical, so keypad presentation does not wait for unrelated device biometrics or secure-storage checks. No cached success can authorize another transaction. Local app-unlock hashing should use asynchronous platform/browser cryptography or a background isolate while preserving existing digest compatibility and work factors.

## Screens and sheets

The Security screen has two clear sections: **Transaction PIN — approve payments and transfers**, and **App unlock — open TrustPay**. Each has its own setup/change action and status. Phone-security unlock sits in the app-unlock section. Remove developer-facing explanations about server challenges and current implementation behavior.

Payment review uses a rounded bottom sheet with a drag handle, generous spacing, a prominent amount/currency, readable recipient details, a full-width bold Continue button (at least 56 px tall), and a large secondary Edit action. It scrolls on short displays and at large text scales. Dismiss/edit makes no financial request. PIN entry has clear transaction versus app-unlock titles, responsive keypad feedback, visible progress, and duplicate-submit prevention.

## Verification and delivery

Regression coverage must prove transaction PIN creation/change/approval cannot modify the app-unlock PIN; app-unlock PIN changes cannot modify the server credential; failed server PINs never move money; and transaction collection avoids standalone verify/local hashing. Cover app-PIN lockouts, user switching, device-auth availability/cancellation, web/native hash compatibility, short screens/large text, sheet cancel/edit, and repeated taps. Use disposable backend fixtures for payment authorization; never submit a real purchase or change a customer's genuine PIN during agent testing.

Run the relevant Flutter suite, analysis, backend authorization tests if backend behavior changes, and inspect the security/review UI in Chrome. Preserve unrelated checkout changes. No reduction to cryptographic strength or server payment protection is part of this design.
