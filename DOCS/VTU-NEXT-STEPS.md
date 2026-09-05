# VTU setup: next steps

## Current state

Local code only; these changes have not been deployed to Render.
The signed callback worker independently confirms outcomes through authenticated
VTpass requery. All 74 VTU unit tests pass, including conflicting callback status
and provider outage cases. These are automated tests, not a certification of live
provider delivery. Cable renewal still cannot proceed without a provider-supplied
renewal price; change-package is the tested workaround.

## What the owner should do now

1. Keep VTpass in sandbox. Do not change to real-money keys yet.
2. Contact VTpass support from the dashboard and ask:

   “We are configuring transaction-update callbacks. Your public documentation
   does not specify signature verification. Do you supply a signed callback
   header and verification secret, or another supported way to authenticate
   callback delivery? Please send the exact verification specification and a
   sample sandbox transaction-update payload. Our DStv/GOtv sandbox verification
   also returns no Renewal_Amount for test card 1212121212; please supply a test
   fixture with a valid renewal amount.”

3. Share their reply, with credentials and customer details removed.
4. Before real-money rollout, move the Render service off the sleeping Free
   instance after reviewing its price. Confirm database/Redis health afterward.

## About the URL

Your backend domain is `https://api.trustpayhq.com`. Its existing signed receiver
is `https://api.trustpayhq.com/api/webhooks/vtu/vtpass`.
Do NOT enter this as a direct VTpass callback yet: it requires the
`x-trustpay-vtpass-signature` header. No compatible provider-authenticated gateway
has been deployed or verified. Do not paste API keys or secrets into the URL.

Once authentication is resolved, deploy only a reviewed commit containing the
VTU changes, configure the verified callback URL, and trigger sandbox callbacks.
Verify duplicate delivery, pending recovery, single debit/refund, and receipts
through the app before authorizing a limited live smoke test. The current
worktree contains extensive unrelated changes; do not blindly deploy all of it.
