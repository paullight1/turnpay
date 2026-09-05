# Compact Exchange direction cards

Replaced tall paper-image cards and currency-symbol illustrations with compact horizontal rows, Nigeria/Ghana flag pairs, green NGN gradients and gold GHS gradients. Enabled choices retain Material tap feedback; unavailable directions remain explicitly labelled and disabled.

Also corrected grouped-number handling: input validation and submission now normalize thousands separators, preserving canonical API amount text.

Nine screen/converter tests passed, including GHS input leading to NGN payout selection and exact reverse preview arithmetic. Backend TypeScript checks passed. This does not verify live reverse settlement: the deployed API still needs reverse-direction deployment/configuration, approved rates, and financial integration verification. Simulator visual review requires the user to unlock the rebuilt app.
