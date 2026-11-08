# Android production security review

Record the full candidate commit from protected main, Android version code,
device models and Android versions, test date, reviewer, and links to results.
Record the signed artifact SHA-256 and compare its upload certificate against
Play Console before uploading.

## Certificates and rotation

The app pins SHA-256 hashes of leaf certificate DER bytes for
`api.trustpayhq.com`. Obtain the currently served leaf and an approved
replacement leaf from the TLS operator. Verify both cover the API hostname
and record their issuer, validity and fingerprint. Use
`openssl x509 -in leaf.pem -outform DER | openssl dgst -sha256` for a PEM file.
Never substitute an intermediate or an expired certificate for the replacement.

Document who controls the certificate switch, how the next leaf is provisioned
before the current one expires, how both leaves are tested before rollout,
and the rollback and renewal alert procedures. If the managed TLS service
cannot supply a known next leaf, resolve the TLS architecture before enabling
production pinning. Never install an unverified backup fingerprint.

## Physical Android checks

Use a release build from the candidate commit. Record pass or fail with
redacted logs for each check:

- Sign in and refresh a session using each approved certificate in a controlled
  environment. Confirm both authenticated clients reject a valid but unpinned
  leaf, an invalid chain and a hostname mismatch.
- Confirm sensitive actions work on a supported device and fail safely when
  the integrity signal is risky or unavailable. Use test accounts and avoid
  live money movement.
- Install and upgrade from build 2, then verify session recovery, logout,
  and retry after network loss.

Publish the reviewed evidence at a protected HTTPS URL. Set
`MOBILE_PLATFORM_SECURITY_EVIDENCE_URL` and
`MOBILE_PLATFORM_SECURITY_EVIDENCE_COMMIT` on the GitHub production environment,
then set `MOBILE_PLATFORM_SECURITY_GATE` to `verified` after independent sign-off.
Keep upload keys, passwords and customer data out of the evidence.
