---
title: "Least-Privilege Database Access at Scale: What I Actually Built (and What I Considered)"
meta_title: "Least-Privilege DB Access: MongoDB Atlas & RDS at Scale"
description: "How I replaced shared atlasAdmin and RDS master credentials across 25+ microservices with scoped roles, IRSA, and Atlas Operator — without downtime or new tooling."
date: 2026-05-17T00:00:00+00:00
image: "https://i.ibb.co/39970dFh/least-privilege-db-cover.jpg"
categories:
  - "Platform Engineering"
  - "Security"
tags:
  - "mongodb"
  - "postgresql"
  - "kubernetes"
  - "least-privilege"
  - "atlas-operator"
  - "irsa"
  - "eso"
  - "security"
  - "platform-engineering"
  - "soc2"
draft: false
author: "Oren Sultan"
---

## TL;DR

Every service in our platform was sharing one of two credentials: an `atlasAdmin` MongoDB user or the RDS master password. I replaced both with per-service scoped roles — MongoDB via Atlas Kubernetes Operator + ESO, RDS via IRSA + RDS Proxy — without touching application code and without a single minute of downtime. Along the way I considered Teleport and HashiCorp Boundary, and chose not to use either. Here's the full reasoning.

---

## The Problem Nobody Talks About

There's a credential pattern that's embarrassingly common in microservice platforms, and almost nobody admits to it until something goes wrong: every service shares the same database admin credential.

In our case, it looked like this. MongoDB Atlas had a single user — `admin`, `atlasAdmin` role — and its password lived in AWS Secrets Manager as one secret, referenced by every service that touched MongoDB. RDS was the same story: the Pulumi provisioning stack grabbed the master credentials and wrote them verbatim into ~25 service secrets.

<!-- image_prompt:archive index=1 role=cover id=least-privilege-db-cover b64=U3BsaXQgaWxsdXN0cmF0aW9uIOKAlCBsZWZ0IHNpZGUgc2hvd3MgbXVsdGlwbGUgbWljcm9zZXJ2aWNlIHBvZHMgYWxsIGNvbm5lY3RpbmcgdG8gYSBzaW5nbGUgZGF0YWJhc2Ugd2l0aCBhIGdpYW50IHNrZWxldG9uIGtleSBsYWJlbGVkICJhZG1pbiIsIHJpZ2h0IHNpZGUgc2hvd3MgZWFjaCBwb2Qgd2l0aCBpdHMgb3duIHNtYWxsIHVuaXF1ZSBrZXkgY29ubmVjdGluZyB0byBzY29wZWQgZGF0YWJhc2Ugcm9sZXMuIERhcmsgYmFja2dyb3VuZCwgbW9kZXJuIHRlY2ggYWVzdGhldGljLCAxNjo5Lg -->
![Split illustration — left side shows multiple microservice pods all connecting to a single database with a giant skel...](https://i.ibb.co/39970dFh/least-privilege-db-cover.jpg)

Why does this happen? Because it's zero friction. When you're moving fast and spinning up a new service, the path of least resistance is to hand it the credential that already works. The "we'll scope this properly later" decision accumulates across every team until you have a platform where any single compromised pod has full admin access to all customer data across all tenants. Credential rotation means coordinating a simultaneous restart of every service. There's no audit trail distinguishing which service dropped a collection versus which one just ran a query.

That's the silent blast radius. And it's completely fixable — it just requires someone to sit down and actually design the access model before implementing it.

---

## Requirements Before Touching Code

Before writing a single line of Pulumi or YAML, I wrote an RFC and an ADR. Not because I love documentation — because scoping DB access across 25+ services touches every team simultaneously, and you do not want to discover your assumptions were wrong mid-migration.

The non-negotiables I landed on:

- **Per-service scoped roles** — a compromised pod may only reach its own schema
- **Automated rotation** — no human-coordinated rotation events, ever
- **Zero-downtime migration** — parallel-role approach; old credential stays valid for 2 weeks post-cutover per service
- **Developer experience must not degrade** — local dev runs identically; staging/prod access via `aws sso login` (already the daily habit)
- **SOC2 CC6.x evidence** — per-operation audit trail to Datadog, quarterly access review runbook

<!-- image_prompt:archive index=2 b64=Q2xlYW4gY2hlY2tsaXN0IGdyYXBoaWMgd2l0aCA1IHJlcXVpcmVtZW50cyBhcyBjaGVja2JveGVzLCBlbmdpbmVlcmluZyBub3RlYm9vayBhZXN0aGV0aWMsIGdyZWVuIGNoZWNrbWFya3MsIGRhcmsgbW9kZS4 -->
![Clean checklist graphic with 5 requirements as checkboxes, engineering notebook aesthetic, green checkmarks, dark mode.](https://i.ibb.co/VWmyZCWh/img-2.jpg)

---

## Two Databases, Two Patterns, One Delivery Plane

The platform runs MongoDB Atlas and RDS PostgreSQL. They're fundamentally different systems, so the management plane differs — but I was deliberate about keeping the delivery plane identical: every service gets a Kubernetes Secret mounted as env vars. The source of that secret differs; the shape doesn't.

### MongoDB: Atlas Operator + ESO + Fixed Username

The Atlas Kubernetes Operator manages Atlas users as CRDs. The key insight that makes the whole pattern work: the operator needs a K8s Secret containing the password **before** it creates the Atlas user, and the service needs that same secret to connect. One secret, two consumers.

```
Pulumi generates password → Secrets Manager (prod/mongo-connectors-password)
       │
       ▼
ESO syncs → K8s Secret (atlas-connectors-password)
       │                    │
       ▼                    ▼
Atlas Operator        Service pod
creates Atlas user    reads password
connectors_prod_rw    as env var
```

Username convention: `<service>_<env>_<role>` — for example `connectors_prod_rw`. This never changes. Only the password rotates (every 90 days). Service configuration is static; the only thing that moves is the secret value.

Rotation propagation was the detail I almost missed. When ESO syncs a new password, the Atlas Operator reconciles and updates the Atlas user — but the running pod is still holding the old password in memory. The answer was already deployed: **Reloader** (Stakater), which runs cluster-wide via an ArgoCD ApplicationSet with `clusters: {}`. It watches K8s Secrets and triggers rolling restarts when values change. Zero manual steps on rotation.

<!-- image_prompt:archive index=3 b64=U2VxdWVuY2UgZGlhZ3JhbSBzaG93aW5nOiBTZWNyZXRzIE1hbmFnZXIgcGFzc3dvcmQgcm90YXRpb24g4oaSIEVTTyBzeW5jIOKGkiBLOHMgU2VjcmV0IHVwZGF0ZWQg4oaSIEF0bGFzIE9wZXJhdG9yIHVwZGF0ZXMgQXRsYXMgdXNlciDihpIgUmVsb2FkZXIgZGV0ZWN0cyBjaGFuZ2Ug4oaSIHJvbGxpbmcgcG9kIHJlc3RhcnQuIENsZWFuIHRlY2huaWNhbCBkaWFncmFtLCBkYXJrIGJhY2tncm91bmQu -->
![Sequence diagram showing: Secrets Manager password rotation → ESO sync → K8s Secret updated → Atlas Operator updates ...](https://i.ibb.co/3yXnMCdT/img-3.jpg)

### RDS: IRSA + RDS Proxy

RDS has a feature MongoDB doesn't: native IAM database authentication. A pod with the right IAM role can connect without a password — it generates a 15-minute token on connection. The `iam_database_authentication_enabled` flag was already set on all our prod RDS instances. The IRSA infrastructure (`KubernetesServiceAccount` component) was already built for S3 and SQS access.

The catch: a 15-minute token that expires mid-connection is a problem if the application doesn't refresh it. Enter **RDS Proxy** — it sits between the pod and RDS, handles token refresh transparently, and the application just sees a normal PostgreSQL connection string. No app code changes. No credential in any Secret.

```
Pod (IRSA role) → assumes IAM role → RDS Proxy → RDS
                                      ↑ handles 15-min token refresh
```

The management plane: Pulumi creates the per-service PostgreSQL role and `GRANT` statements in `postgresql_provision/provision.py`. ESO delivers the connection metadata (host, port, db name) — but not the password, because there isn't one.

---

## The Decision I Almost Got Wrong

Early on I considered having each service deploy its own `AtlasDatabaseUser` CRD via Helm — self-service, decoupled, teams own their DB users. It seemed elegant until I traced the dependency chain.

The Atlas Operator requires a K8s Secret with the password to exist *before* the CRD is applied. If the Helm chart creates the CRD, it also needs to create the Secret. If it creates the Secret, it needs a password. Where does the password come from? Either Helm generates it (regenerates on every `helm upgrade`, causing password churn on every deployment) or it pulls from Secrets Manager (which must be pre-populated — a centralized step anyway).

Per-service Helm doesn't eliminate the centralized provisioning requirement. It just hides it and couples DB privilege changes to service deployments, where reviewers are focused on application code, not IAM scope creep.

Centralized is the right answer. All `AtlasDatabaseUser` CRDs live in the infra/argocd repo with CODEOWNERS enforcement on the `atlas/users/` path. DB privilege changes are explicit, separately reviewed, and independently auditable. This is a feature, not bureaucracy.

---

## Break-Glass Without New Tooling

The hardest part of any least-privilege design is the break-glass path — how does the on-call engineer get full access during a production incident without undermining the entire security model?

I looked at what was already running. There was a GitHub Actions workflow (`.github/workflows/on_callers.yaml`) that polls PagerDuty every hour and updates Slack usergroups with the current on-call person. The scripts were already calling both the PagerDuty API and the Okta API in separate scripts.

The break-glass path turned out to be a third step in the existing workflow:

```
PagerDuty (prod-db-admin schedule) → polled hourly by GHA
  step 1: get-pagerduty-on-callers  → on_callers.json  ✅ exists
  step 2: set-slack-on-callers       → Slack groups     ✅ exists
  step 3: set-okta-db-admins         → sentra-db-admins ← to build
```

The `slack_assign_on_call_groups.py` script is the exact template — same logic, same structure, just targeting the Okta groups API instead of the Slack SDK. One new script, one new GHA step. The on-call engineer gets `atlasAdmin` and `break_glass_admin` (RDS) automatically when their shift starts, and loses it when it ends. No commands to run. Every access fires a P1 Datadog alert.

<!-- image_prompt:archive index=4 b64=Rmxvd2NoYXJ0IHNob3dpbmcgUGFnZXJEdXR5IHNjaGVkdWxlIGFzc2lnbm1lbnQg4oaSIEdpdEh1YiBBY3Rpb25zIGNyb24g4oaSIE9rdGEgZ3JvdXAgbWVtYmVyc2hpcCDihpIgQXRsYXMgcm9sZSBncmFudGVkIOKGkiBhdXRvbWF0aWMgUDEgYWxlcnQuIENsZWFuIGZsb3djaGFydCwgc2VjdXJpdHktdGhlbWVkIGNvbG9yIHBhbGV0dGUu -->
![Flowchart showing PagerDuty schedule assignment → GitHub Actions cron → Okta group membership → Atlas role granted → ...](https://i.ibb.co/Rk1hpGkD/img-4.jpg)

---

## Did I Consider Teleport and HashiCorp Boundary?

Yes. Both are purpose-built for privileged access management and worth evaluating seriously.

**Teleport** handles database access natively — it issues short-lived certificates, provides session recording, and integrates with your IdP for MFA-gated access. The UX is genuinely good: `tsh db connect <db-name>` and you're in. Audit logs are first-class. If you're starting from scratch with no existing tooling, Teleport is a strong choice.

**HashiCorp Boundary** takes a different approach — it's a network-layer proxy that brokers access to targets. You authenticate through Boundary and it proxies your connection. Clean separation of network access from credential management.

Why didn't I use either? Three reasons:

1. **We already had the pieces.** PagerDuty, Okta, GHA, Atlas Operator, ESO, Reloader — every component of the break-glass and credential delivery flow was already running. Adding Teleport or Boundary means operating one more system, training the team on one more tool, and creating a dependency on one more SLA.

2. **New tooling for an already-solved problem.** The actual security properties I needed — scoped credentials, automated rotation, JIT break-glass with audit trail — are achievable with what exists. Teleport would improve the UX of the break-glass path, but it wouldn't change the threat model meaningfully.

3. **Migration cost vs. incremental value.** Retrofitting Teleport into an existing Kubernetes platform isn't trivial. It requires deploying the Teleport operator, configuring database services for each RDS instance and Atlas cluster, and migrating the existing access patterns. That's months of work for a platform team that already has a defined migration path.

> If I were designing a greenfield platform today, Teleport would be in the architecture conversation from day one. Retrofitting it into an existing system with working alternatives is a different calculation.

The honest principle: reach for existing tooling before introducing new dependencies. You can always add Teleport in v3 when the team has bandwidth and the ROI is clear.

---

## The v2 Path: MongoDB Without Passwords

The current design uses username + password for MongoDB service connections — scoped, rotated, delivered via K8s Secret. It's secure. But it's not as clean as the RDS IRSA model where there's no stored credential at all.

MongoDB Atlas supports OIDC Workload Identity Federation: a service pod authenticates using its AWS IAM identity (IRSA role), Atlas validates the IAM role ARN, and the connection is established without a password. No Secret. No rotation event. No Reloader restart.

The catch is code changes. Every service needs its MongoDB driver upgraded (PyMongo ≥ 4.7, Node.js driver ≥ 6.3) and its connection string updated to use `authMechanism=MONGODB-OIDC`. That's a migration across every MongoDB-consuming service — worthwhile, but not v1 work.

The upgrade path is non-destructive: services migrate one at a time, the Atlas Operator CRD changes from `passwordSecretRef` to `oidcAuthType`, and the ESO ExternalSecret for that service's MongoDB password gets removed. Full parity with RDS in terms of stored credentials: zero.

---

## Lessons from Designing This

A few things I'd tell myself at the start:

**Write the ADR before the RFC.** I wrote the RFC first and iterated on it extensively. The ADR forced me to commit to specific decisions and document rejected alternatives — that discipline would have shortened the RFC process.

**Validate what actually exists before designing what you need.** I assumed Atlas Identity Federation was configured. It wasn't. I assumed RDS IAM auth needed to be enabled. It was already on. Checking the actual state of your infrastructure before writing the design doc saves you from building on false assumptions.

**The management plane and delivery plane are separate problems.** MongoDB and RDS have different management tools — that's fine. What matters is that the delivery interface to services is identical. Uniform delivery enables uniform service configuration, which enables uniform operations.

The full RFC and ADR for this design are available at **[github.com/OrenOren1/db-access-least-privilege](https://github.com/OrenOren1/db-access-least-privilege)** — genericised for reuse.

---

## Conclusion

Shared database admin credentials are a solved problem. The tooling to fix it — Kubernetes operators, ESO, IRSA, IAM DB auth — is mature, well-documented, and probably already running in your cluster. The work is in the design: defining the role taxonomy, tracing the credential delivery chain, building the migration strategy, and getting the governance model right.

The hardest part isn't the technology. It's convincing your team to treat "the admin credential works fine" as the security debt it actually is — before something forces the conversation.

---

*I write about platform engineering, Kubernetes, GitOps, and agentic DevOps on [app.sultano.blog](https://app.sultano.blog/blog/) — this post lives at [app.sultano.blog/blog/2026-05-17-least-privilege-db-access/](https://app.sultano.blog/blog/2026-05-17-least-privilege-db-access/).*

*Useful? Say so in the comments below, or follow on [LinkedIn](https://www.linkedin.com/in/oren-sultan-0527bab6/) and [Medium](https://medium.com/@orensito1).*

<!-- SOCIAL SNIPPETS -->

### LinkedIn (~1300 chars)

Every service in our platform shared one credential: atlasAdmin on MongoDB, master password on RDS. ~25 microservices, zero isolation, zero audit trail.

I just finished designing the fix — and the most interesting part wasn't the technology, it was all the things I considered and decided NOT to use.

Three things I learned:

1. Per-service Helm for DB user creation sounds elegant until you trace the dependency chain — it creates a chicken-and-egg problem that forces centralized provisioning anyway.

2. Teleport and HashiCorp Boundary are excellent tools. I chose not to use them because the security properties I needed were achievable with tooling already running in the cluster. Reach for existing tooling before adding new dependencies.

3. The management plane (how credentials are created) and the delivery plane (how they reach pods) are separate problems. MongoDB and RDS use different tools to manage credentials — that's fine. What matters is that the delivery interface to services is identical.

Full design — RFC + ADR — is open-sourced: github.com/OrenOren1/db-access-least-privilege

#PlatformEngineering #Security #Kubernetes #MongoDB #PostgreSQL #DevOps

---

### X / Twitter (≤280 chars)

Replaced shared DB admin creds across 25 microservices with scoped roles, IRSA, and Atlas Operator. Considered Teleport. Chose not to use it. Here's why — and the full ADR: github.com/OrenOren1/db-access-least-privilege #PlatformEngineering #Security

---

### Facebook (~450 chars)

Just open-sourced the architecture design for something we've been working on: replacing shared database admin credentials across a microservice platform with proper least-privilege access.

The post covers the full design decision — MongoDB via Atlas Operator, RDS via IRSA, break-glass via PagerDuty + Okta — and why I chose not to use Teleport or HashiCorp Boundary even though both are solid tools.

Full post + ADR on GitHub: github.com/OrenOren1/db-access-least-privilege

---

### Instagram (~180 chars)

Replaced shared DB admin creds with scoped per-service roles across 25 microservices 🔐 Atlas Operator + IRSA + ESO. Full ADR open-sourced — link in bio. #DevOps #Security #Kubernetes #PlatformEngineering #MongoDB #AWS
