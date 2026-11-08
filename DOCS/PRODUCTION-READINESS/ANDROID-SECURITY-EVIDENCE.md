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

### TrustPay API rotation decision

On 8 November 2026, public DNS for the API resolved to the Contabo host
used by Dokploy, and the live leaf was issued by Let's Encrypt (YR2).
Its observed DER SHA-256 was
`f4f883630b926da81724301c12a760a9f8e67feaa906382ee26ba22cd201bf8e`,
with expiry on 31 January 2027 at 13:12:36 UTC. Recheck before signing.

Confirm the actual certificate resolver in Dokploy. Dokploy supports importing
a custom certificate into Traefik. The TLS operator can evaluate issuing a
replacement leaf for the same hostname via DNS-01 before cutover, without
changing the serving certificate. First rehearse serving each leaf on an
isolated endpoint with the API hostname and normal chain and hostname
validation. Verify that the approved leaf is the one Traefik will serve at
cutover and that automatic renewal cannot switch it unexpectedly.
Record how future rotations will reach existing app installs before the
last pinned leaf expires. Keep private keys in the TLS operator's custody.

References: [Dokploy certificate configuration](https://docs.dokploy.com/docs/core/certificates)
and [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/).

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
