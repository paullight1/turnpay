# Loading improvements

Home starts bootstrap, transactions, collection accounts and beneficiaries concurrently instead of waiting for bootstrap before starting the remaining three requests. Refresh retains existing content with an explicit updating-balances indicator; failed responses remain visible errors. Pull-to-refresh now awaits completion and overlapping refresh triggers are coalesced.

Exchange form readiness depends on configuration and retry-journal recovery, independently of history. Slow history displays an inline loading message; failed history displays its own retry action. Pending-create recovery still blocks creating a replacement request. The shell retains the Exchange screen and draft after the first visit, disables hidden animations, and refreshes configuration/history when returning.

Verification: 30 Exchange, Home and financial-data-state tests passed. Added coverage for slow and failed history without blocking direction selection. Selected Flutter analysis passed. No numerical latency improvement is claimed; live network/server latency remains outside these UI changes.
