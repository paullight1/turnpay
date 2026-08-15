# 04 — Operations, Backups, and Resilience

## Goal

Keep the service available, observable, recoverable, and controlled during incidents.

## Owner

Infrastructure/DevOps lead and incident commander.

## Steps

- [ ] Create separate production, staging, and development environments with separate databases, Redis instances, secrets, provider accounts, and domains.
- [ ] Deploy non-root containers with health checks, TLS, firewall/WAF rules, rate limits, alerting, and restricted network access.
- [ ] Configure structured logs, error tracking, metrics, traces, uptime checks, provider-health alerts, webhook-failure alerts, and reconciliation alerts.
- [ ] Enable encrypted automated database backups and define retention, RPO, and RTO targets.
- [ ] Perform a restore to a clean environment; verify users, wallets, ledger entries, audit logs, webhook evidence, and migrations.
- [ ] Test Redis loss, database failover, provider timeout, webhook backlog, bad deployment, and secret rotation.
- [ ] Write incident runbooks for payment outage, suspected fraud, data leak, reconciliation mismatch, and rollback.
- [ ] Assign on-call coverage and perform a tabletop incident exercise before launch.

## Evidence required

Architecture diagram, environment inventory, alert screenshots, backup policy, restore transcript, disaster-recovery results, runbooks, and on-call rota.

## Exit criteria

The service can be restored within the agreed RTO, data loss stays within the agreed RPO, alerts reach an owner, and rollback has been rehearsed.
