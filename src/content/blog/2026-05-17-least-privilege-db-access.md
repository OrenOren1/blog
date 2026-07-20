---
title: "Least-Privilege Database Access at Scale: What I Actually Built (and What I Considered)"
meta_title: "Least-Privilege DB Access: MongoDB Atlas & RDS at Scale"
description: "How I replaced shared admin credentials for both services and humans — scoped roles via Atlas Operator and IRSA, plus JIT time-boxed access for engineers."
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
  - "jit-access"
  - "okta"
  - "security"
  - "platform-engineering"
  - "soc2"
draft: false
author: "Oren Sultan"
---

## TL;DR

Every service in our platform was sharing one of two credentials: an `atlasAdmin` MongoDB user or the RDS master password. And every engineer who needed to debug production was borrowing the same admin logins. I fixed both halves. Services got per-service scoped roles — MongoDB via Atlas Kubernetes Operator + ESO, RDS via IRSA + RDS Proxy — without touching application code. Humans got a two-tier model: a read-only baseline through SSO, and every write elevated just-in-time through an access broker with an approval trail and a hard TTL. Along the way I chose to manage the whole authorization model — permission sets, Atlas federation, JIT workflows — as one IaC module (Terraform first, since migrated to Pulumi) instead of extending our GitOps operator stack. Here's the full reasoning.

---

## The Problem Nobody Talks About

There's a credential pattern that's embarrassingly common in microservice platforms, and almost nobody admits to it until something goes wrong: every service shares the same database admin credential.

In our case, it looked like this. MongoDB Atlas had a single user — `admin`, `atlasAdmin` role — and its password lived in AWS Secrets Manager as one secret, referenced by every service that touched MongoDB. RDS was the same story: the Pulumi provisioning stack grabbed the master credentials and wrote them verbatim into ~25 service secrets.

<!-- image_prompt:archive index=1 role=cover id=least-privilege-db-cover b64=U3BsaXQgaWxsdXN0cmF0aW9uIOKAlCBsZWZ0IHNpZGUgc2hvd3MgbXVsdGlwbGUgbWljcm9zZXJ2aWNlIHBvZHMgYWxsIGNvbm5lY3RpbmcgdG8gYSBzaW5nbGUgZGF0YWJhc2Ugd2l0aCBhIGdpYW50IHNrZWxldG9uIGtleSBsYWJlbGVkICJhZG1pbiIsIHJpZ2h0IHNpZGUgc2hvd3MgZWFjaCBwb2Qgd2l0aCBpdHMgb3duIHNtYWxsIHVuaXF1ZSBrZXkgY29ubmVjdGluZyB0byBzY29wZWQgZGF0YWJhc2Ugcm9sZXMuIERhcmsgYmFja2dyb3VuZCwgbW9kZXJuIHRlY2ggYWVzdGhldGljLCAxNjo5Lg -->

The human side was no better — just quieter. When an engineer needed to inspect a production collection or run a migration query, the path was the same shared admin login everyone else used. No per-person attribution, no expiry, no record of who held write access at any given moment.

Why does this happen? Because it's zero friction. When you're moving fast, the path of least resistance is to hand a new service — or a new engineer — the credential that already works. The "we'll scope this properly later" decision accumulates until any single compromised pod has full admin access to all customer data, and any laptop with the shared login is one phishing email away from the same. Credential rotation means coordinating a simultaneous restart of every service. There's no audit trail distinguishing which service — or which person — dropped a collection.

That's the silent blast radius. And it's completely fixable — it just requires someone to sit down and actually design the access model before implementing it.

---

## Requirements Before Touching Code

Before writing a single line of Pulumi or Terraform, I wrote an RFC and an ADR. Not because I love documentation — because scoping DB access across 25+ services and every engineering team touches everyone simultaneously, and you do not want to discover your assumptions were wrong mid-migration.

The non-negotiables I landed on:

- **Per-service scoped roles** — a compromised pod may only reach its own schema
- **No standing write access for humans** — read-only by default; every write is requested, approved, and time-boxed
- **Automated rotation** — no human-coordinated rotation events, ever
- **Zero-downtime migration** — parallel-role approach; old credential stays valid for 2 weeks post-cutover per service
- **Developer experience must not degrade** — local dev runs identically; staging/prod access via `aws sso login` and browser SSO (already the daily habit)
- **SOC2 CC6.x evidence** — per-operation audit trail, per-grant approval records, quarterly access review runbook

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

<!-- diagram_mermaid:archive index=1 id=mongo-rotation b64=Zmxvd2NoYXJ0IExSCiAgc3ViZ3JhcGggbWdtdFsi4piB77iPIE1hbmFnZW1lbnQgUGxhbmUiXQogICAgUFVMVU1JWyJQdWx1bWlcbmdlbmVyYXRlcyBwYXNzd29yZCJdCiAgICBTTVsiU2VjcmV0cyBNYW5hZ2VyXG5wcm9kL21vbmdvLWNvbm5lY3RvcnMtcGFzc3dvcmQiXQogICAgUFVMVU1JIC0tPnx3cml0ZXN8IFNNCiAgZW5kCiAgc3ViZ3JhcGggZGVsaXZlcnlbIuKYuO+4jyBEZWxpdmVyeSBQbGFuZSJdCiAgICBFU09bIkVTT1xuc3luY3MgZXZlcnkgMWgiXQogICAgSzhTWyJLOHMgU2VjcmV0XG5hdGxhcy1jb25uZWN0b3JzLXBhc3N3b3JkIl0KICAgIEFUTEFTX09QWyJBdGxhcyBPcGVyYXRvciJdCiAgICBBVExBU19VU0VSWyJBdGxhcyBVc2VyXG5jb25uZWN0b3JzX3Byb2RfcnciXQogICAgUkVMT0FERVJbIlJlbG9hZGVyXG5TdGFrYXRlciJdCiAgICBQT0RbIlNlcnZpY2UgUG9kIl0KICBlbmQKICBTTSAtLT58c3luY3wgRVNPCiAgRVNPIC0tPiBLOFMKICBLOFMgLS0+fHBhc3N3b3JkIHJlZnwgQVRMQVNfT1AKICBLOFMgLS0+fGVudiB2YXJ8IFBPRAogIEFUTEFTX09QIC0tPnxjcmVhdGUvdXBkYXRlfCBBVExBU19VU0VSCiAgUkVMT0FERVIgLS0+fGRldGVjdHMgc2VjcmV0IGNoYW5nZXwgSzhTCiAgUkVMT0FERVIgLS0+fHJvbGxpbmcgcmVzdGFydHwgUE9E -->
![MongoDB credential rotation — Secrets Manager → ESO → K8s Secret → Atlas Operator + Reloader](https://i.ibb.co/n8rMCmmK/mongo-rotation.jpg)

### RDS: IRSA + RDS Proxy

RDS has a feature MongoDB doesn't: native IAM database authentication. A pod with the right IAM role can connect without a password — it generates a 15-minute token on connection. The `iam_database_authentication_enabled` flag was already set on all our prod RDS instances. The IRSA infrastructure (`KubernetesServiceAccount` component) was already built for S3 and SQS access.

The catch: a 15-minute token that expires mid-connection is a problem if the application doesn't refresh it. Enter **RDS Proxy** — it sits between the pod and RDS, handles token refresh transparently, and the application just sees a normal PostgreSQL connection string. No app code changes. No credential in any Secret.

```
Pod (IRSA role) → assumes IAM role → RDS Proxy → RDS
                                      ↑ handles 15-min token refresh
```

The management plane: Pulumi creates the per-service PostgreSQL role and `GRANT` statements in `postgresql_provision/provision.py`. ESO delivers the connection metadata (host, port, db name) — but not the password, because there isn't one.

One thing I noted in the ADR but deferred: **EKS Pod Identity** is a cleaner alternative to IRSA for new clusters. Instead of annotating every service account with an IAM role ARN, you create an `EksPodIdentityAssociation` at the cluster layer — the binding lives outside Kubernetes manifests, trust policies don't need per-cluster OIDC conditions, and AWS's tooling handles credential delivery via a DaemonSet. The application code doesn't change; it's a pure infrastructure refactor. If I were building this from scratch on a new cluster, I'd use Pod Identity from day one. For an existing platform, IRSA works and the migration cost isn't worth it until you have dedicated headspace.

---

## The Decision I Almost Got Wrong

Early on I considered having each service deploy its own `AtlasDatabaseUser` CRD via Helm — self-service, decoupled, teams own their DB users. It seemed elegant until I traced the dependency chain.

The Atlas Operator requires a K8s Secret with the password to exist *before* the CRD is applied. If the Helm chart creates the CRD, it also needs to create the Secret. If it creates the Secret, it needs a password. Where does the password come from? Either Helm generates it (regenerates on every `helm upgrade`, causing password churn on every deployment) or it pulls from Secrets Manager (which must be pre-populated — a centralized step anyway).

Per-service Helm doesn't eliminate the centralized provisioning requirement. It just hides it and couples DB privilege changes to service deployments, where reviewers are focused on application code, not IAM scope creep.

Centralized is the right answer. All `AtlasDatabaseUser` CRDs live in the infra/argocd repo with CODEOWNERS enforcement on the `atlas/users/` path. DB privilege changes are explicit, separately reviewed, and independently auditable. This is a feature, not bureaucracy.

---

## Humans Are the Harder Half

Service access is a solved-shape problem: a pod has one identity and one job, so you scope a role and you're done. Humans are messier. The same engineer who only reads dashboards on Monday needs to run a schema migration on Thursday. Grant for the worst case and you've recreated the shared-admin problem with extra steps.

The design that actually held up is a two-tier model, built on one principle: **directory groups describe who you are, never what you can do.** An Okta group like `platform-team` is identity. Capability — "can write to prod Postgres" — is a projection layered on top, and the projection is what gets time-boxed.

[IMAGE_PROMPT: Two-tier access pyramid illustration — wide base layer labeled "Baseline: read-only via SSO, permanent" in cool blue, narrow top layer labeled "JIT: writes, approved, expires in hours" in warm amber, with a small clock icon on the top tier. Dark background, modern flat tech aesthetic, 16:9.]

### Tier 1: a read-only baseline that's actually useful

Every engineer's steady-state access comes through SSO and contains reads only — enough to debug 90% of incidents without asking anyone. On the RDS side this leans on the same IAM database authentication the services use. Pulumi provisions tiered PostgreSQL users (`db_readonly_*`, `db_migration_*`, `db_breakglass_*`) with their grants; the AWS-side gate is a single IAM statement deciding which of those users your SSO session may log in as:

```json
{
  "Effect": "Allow",
  "Action": "rds-db:connect",
  "Resource": "arn:aws:rds-db:*:<account>:dbuser:*/db_readonly_*"
}
```

The baseline permission set carries only the `db_readonly_*` ARN. `aws sso login`, generate a 15-minute auth token, connect with `psql`. No password exists for humans at all — the load-bearing detail is that `rds-db:connect` is scoped to a *specific database user*, not to the instance. Miss that and IAM auth silently grants nothing.

On the MongoDB side, the baseline is the Atlas **console** through SAML federation: Okta authenticates, and Atlas org role mappings translate each engineering group into project data-access roles — read-write on staging, read-only on production, Browse Collections in the UI. We prototyped Atlas Workforce Identity Federation (browser-SSO `mongosh`/Compass) and ultimately removed it — the console covers the read-mostly baseline, and standing shell access to prod data wasn't a capability we wanted to keep alive. Nobody holds a Mongo password.

### Tier 2: every write is a JIT grant

If an action changes state — DDL, DML, dropping a collection, rotating a secret — it does not exist in the baseline. Period. Writes come from an access broker (we use BeyondTrust Entitle; ConductorOne and Opal play the same position) as **bundles**: pre-composed grant sets a developer requests with a justification, a team-lead approval, and a TTL measured in hours.

The mechanics differ per plane but the shape is identical:

- **AWS cloud writes:** approval creates an ephemeral IAM Identity Center assignment to a per-team "extended" permission set carrying that team's observed write actions — Athena, Glue, S3, whatever the usage data justified. On expiry the assignment is deleted. Sessions show up in CloudTrail under the extended role name, so attribution is free.
- **RDS writes:** a separate migration-tier bundle attaches the permission set whose only meaningful statement is `rds-db:connect` on the `db_migration_*` PostgreSQL users — read plus DDL/DML, no superuser. The database-side grants never change; the JIT grant only decides who may log in as that user, and for how long.
- **MongoDB:** approval makes the broker mint a **temporary Atlas database user** with read-write on the production projects — real `mongosh`/Compass credentials, issued by the broker, destroyed at expiry. No standing DB users are ever created; the write path exists only inside the grant window.

The part I underestimated: deciding *what goes in each team's write bundle*. Guessing produces either a useless bundle or a shadow admin role. Instead I queried three months of CloudTrail through Athena, attributed every write action to a team, and made the observed set the policy. Least privilege isn't a philosophy debate when you have the actual usage data — it's a `GROUP BY`.

### Developer experience: wrap it in a Taskfile

None of this survives contact with engineers if requesting access means archaeology in a web console. The whole flow is wrapped in `go-task` targets that live in the same repo as the IaC:

```bash
task bundles:request -- rnd-extended-myteam 3   # broker request: team write bundle, 3h
task bundles:my-requests                        # my recent grants + their status
task mongo:console                              # browser SSO → Atlas console session
```

Time from "I need prod write access" to an approved, scoped, expiring session: a few minutes. That's the bar — if JIT access is slower than asking a teammate for the shared password used to be, people will route around it.

---

## The Design That Died on a Licensing Line Item

The elegant version of the MongoDB human-access story wasn't supposed to involve a broker at all. The plan: an Okta Custom Authorization Server with a token claim expression projecting identity groups into capability claims (`db-prod-readonly`, `db-prod-readwrite`), consumed directly by Atlas federation. Pure static mapping, no moving parts, all declarative.

It died in one `terraform apply`. Creating a Custom Authorization Server requires Okta's **API Access Management** add-on — a contract line item, not a permission. Our tenant didn't have it. Okta's org-level authorization server can't emit group claims where that design needed them, so no amount of Terraform was going to fix it. The error (`E0000015`) looks like a permissions problem; it's a procurement problem.

I'd validated the infrastructure assumptions carefully — which Atlas features were configured, which RDS flags were enabled. I never thought to validate the *license* assumptions. An afternoon of reverting Terraform later, the JIT-broker path became the design instead of the fallback — and honestly it's the better model: the static-claims version would have given engineers *standing* write capability, just neatly labeled. The broker version time-boxes it. We eventually decommissioned the Workforce-OIDC human path altogether: the console covers baseline reads, and JIT write arrives as a broker-issued temporary database user rather than a token claim.

---

## Break-Glass Is Just Another Bundle

The hardest part of any least-privilege design is the break-glass path — how does the on-call engineer get full access during a production incident without undermining the entire model?

My first instinct was to build plumbing: a scheduled job syncing the PagerDuty on-call schedule into an admin group. It would have worked, but once the JIT broker was in place for everything else, break-glass stopped being special. It's just one more bundle with a more permissive approval rule.

The break-glass bundle carries the admin-tier grants on both planes — on RDS that's the `db_breakglass_*` superuser-tier PostgreSQL users, again gated purely by `rds-db:connect`. Its workflow is a short ordered rule list: requesters in the trusted operator groups who are **actually on the on-call schedule** auto-approve — no human in the loop at 3 AM (the broker checks the PagerDuty schedule natively, so the sync job I almost built never existed); a tiny super-admin set auto-approves unconditionally; everyone else needs a platform-team human and gets a tighter duration cap. Every grant is logged with requester, justification, and expiry, and notifies the platform channel so an admin session is never silent.

[IMAGE_PROMPT: Flowchart of break-glass access — on-call engineer requests admin bundle from access broker, broker checks membership in on-call group, auto-approves with hard TTL, grants admin roles on MongoDB Atlas and RDS, fires alert to monitoring, grant auto-expires. Dark background, clean flowchart style, 16:9.]

The property that matters: **there is no standing admin credential anywhere.** Not for services, not for engineers, not for on-call. Admin access exists only as a time-boxed grant with a paper trail — and the quarterly SOC2 access review becomes "export the broker's grant log" instead of a spreadsheet safari.

---

## GitOps Operators or One IaC Module?

The services got their access through Kubernetes-native machinery — Atlas Operator CRDs, ESO, ArgoCD. So the obvious first instinct for the *human* access model was more of the same: a Helm chart rendering Atlas CRDs for the custom roles and federation role-mappings, Crossplane providers reconciling the PostgreSQL roles and Okta objects, everything synced by ArgoCD. Declarative, reconciled, self-healing — the platform aesthetic.

I built a good chunk of that version before concluding it was the wrong shape, for three reasons:

1. **The operators don't cover the model.** The Atlas Operator's federation CRD manages role mappings but can't create the identity providers themselves — that's Admin-API-only, so a second tool is required regardless. The Crossplane providers involved (SQL, Okta) were the least mature components in the stack. Access control is the one domain where I refuse to make an experimental controller the source of truth.

2. **The model spans systems that have no operator at all.** IAM Identity Center permission sets, Entitle workflows and integrations, Okta groups — most of the human-access graph lives outside Kubernetes entirely. The chart could only ever own the MongoDB slice, fragmenting one access model across a Helm repo, a Terraform repo, and click-ops.

3. **Reconciliation is the wrong property for access control.** A controller that continuously "heals" grants is a controller that can silently re-create an access path someone deliberately removed. For workload credentials I want self-healing; for human privilege I want every change to be a reviewed, point-in-time decision.

So the human-access plane became **one IaC root spanning four providers**: identity-center (base + extended permission sets), the access broker (workflows, integrations, bundles), MongoDB Atlas (federation config, role mappings), and Okta (groups, service-app wiring). The payoff is that cross-system references are literal graph edges in one plan — a bundle points at a permission-set ARN, a workflow rule points at a directory-group ID — and a single PR diff shows the full blast radius of an access change across every plane. One review covers the whole story; CODEOWNERS on one repo governs it.

It started as a Terraform root with a module per system and later migrated — import, zero-diff — into a single **Pulumi** program living in the same repo as the rest of our infrastructure. Same shape, same properties; the migration was about consolidating on one IaC toolchain, not about the model.

The honest trade-offs: plan-based IaC doesn't reconcile, so drift is caught at the next plan rather than healed — which I just argued is a feature, but it does mean plans must actually run. And the broker's provider is young: bundle *renames* are destroy-and-recreate, role lists must match the API's ordering or every plan shows phantom drift, integration credentials and workflow assignment can only be managed out-of-band. For a while the bundle write-path drifted badly enough that bundle definitions lived in the UI behind `ignore_changes`; provider fixes and a stricter declaration style brought them back into code. Owning a model in IaC only works when you know exactly where the provider is trustworthy — draw that line explicitly rather than fighting drift forever.

> The delivery plane for services stayed GitOps. The authorization model for humans became plan-based IaC. Same platform, different properties needed — reconciliation for credentials, deliberation for privilege.

---

## The v2 Path: MongoDB Without Passwords

The current design uses username + password for MongoDB service connections — scoped, rotated, delivered via K8s Secret. It's secure. But it's not as clean as the RDS IRSA model where there's no stored credential at all.

MongoDB Atlas supports OIDC Workload Identity Federation: a service pod authenticates using its AWS IAM identity (IRSA role), Atlas validates the IAM role ARN, and the connection is established without a password. No Secret. No rotation event. No Reloader restart.

The catch is code changes. Every service needs its MongoDB driver upgraded (PyMongo ≥ 4.7, Node.js driver ≥ 6.3) and its connection string updated to use `authMechanism=MONGODB-OIDC`. That's a migration across every MongoDB-consuming service — worthwhile, but not v1 work.

On EKS, the concrete setup looks like this. The pod gets a **projected service account token** mounted at a known path, with the audience set to `mongodb`:

```yaml
volumes:
  - name: mongo-token
    projected:
      sources:
        - serviceAccountToken:
            audience: mongodb      # must match the Atlas IdP audience
            expirationSeconds: 86400
            path: token
containers:
  - volumeMounts:
      - name: mongo-token
        mountPath: /var/run/secrets/mongodb
```

The application reads that token file and passes it as the OIDC callback — no password, no secret:

```python
# PyMongo ≥ 4.7
client = MongoClient(
    uri,
    authMechanism="MONGODB-OIDC",
    authMechanismProperties={
        "OIDC_CALLBACK": lambda _: {
            "access_token": open("/var/run/secrets/mongodb/token").read()
        }
    }
)
```

Atlas validates the token against the configured OIDC identity provider (your EKS cluster's OIDC issuer URL), maps the `sub` claim (`system:serviceaccount:<ns>:<sa>`) to an `AtlasDatabaseUser`, and grants the connection. No password anywhere in the chain.

The upgrade path is non-destructive: services migrate one at a time, the Atlas Operator CRD changes from `passwordSecretRef` to `oidcAuthType`, and the ESO ExternalSecret for that service's MongoDB password gets removed. Full parity with RDS in terms of stored credentials: zero.

---

## Lessons from Designing This

A few things I'd tell myself at the start:

**Validate license assumptions like infrastructure assumptions.** I checked which Atlas features were configured and which RDS flags were enabled before designing. I never checked which Okta add-ons were *licensed* — and an entire authorization design died on a procurement line item. "Does the API allow it" and "does the contract allow it" are separate questions.

**Derive policy from usage data, not intuition.** Three months of CloudTrail, attributed per team, told me exactly what belonged in each write bundle. Every least-privilege effort I've seen fail failed at the "what do people actually need" step — and that step is a query, not a workshop.

**Keep identity and capability in separate systems.** Directory groups say who you are; grants say what you can do, and only grants expire. The moment a group named `db-prod-admin` exists, someone will be added to it "temporarily" — and temporary standing access is just standing access with a guilty conscience.

**The management plane and delivery plane are separate problems.** MongoDB and RDS have different management tools — that's fine. What matters is that the interface is uniform: services always get a K8s Secret; humans always get an SSO session plus, when needed, a time-boxed grant. Uniform interfaces enable uniform operations.

The full RFC and ADR for this design are available at **[github.com/OrenOren1/db-access-least-privilege](https://github.com/OrenOren1/db-access-least-privilege)** — genericised for reuse.

---

## Conclusion

Shared database admin credentials are a solved problem — for services *and* for the people who operate them. The tooling is mature and probably already in your stack: Kubernetes operators, ESO, IRSA, IAM database auth, an IdP, and some form of JIT access broker. The work is in the design: defining the role taxonomy, tracing the credential delivery chain, measuring what each team actually does, and getting the governance model right.

The hardest part isn't the technology. It's convincing your team to treat "the admin credential works fine" as the security debt it actually is — before something forces the conversation.

---

<!-- SOCIAL SNIPPETS -->

### LinkedIn (~1300 chars)

Every service in our platform shared one credential: atlasAdmin on MongoDB, master password on RDS. Every engineer debugging prod borrowed the same admin logins. ~25 microservices, one team, zero isolation, zero attribution.

I finished designing the fix for both halves — services AND humans — and the most interesting lessons weren't about technology:

1. Humans are the harder half. Services get scoped roles (Atlas Operator + ESO, IRSA + RDS Proxy). Humans need a two-tier model: read-only baseline via SSO, and every write elevated just-in-time with an approval and a TTL. No standing admin anywhere — including on-call.

2. Derive policy from data, not intuition. Three months of CloudTrail, attributed per team, defined exactly what belongs in each team's write bundle. Least privilege is a GROUP BY, not a workshop.

3. Validate license assumptions like infrastructure assumptions. My cleanest design — static Okta claim projection into Atlas federation — died on an unlicensed Okta add-on. The API said no; the contract was the reason.

4. Reconciliation is the wrong property for access control. Our services stayed GitOps, but the human authorization model became one IaC module — permission sets, Atlas federation, JIT workflows in a single plan. A controller that self-heals grants can silently re-create an access path someone deliberately removed.

Full design — RFC + ADR — is open-sourced: github.com/OrenOren1/db-access-least-privilege

#PlatformEngineering #Security #Kubernetes #MongoDB #PostgreSQL #DevOps

---

### X / Twitter (≤280 chars)

Killed shared DB admin creds for services AND humans: scoped roles + IRSA for pods, read-only SSO baseline + JIT time-boxed grants for engineers. No standing admin anywhere. Full ADR: github.com/OrenOren1/db-access-least-privilege #PlatformEngineering #Security

---

### Facebook (~450 chars)

Just open-sourced the architecture design for replacing shared database admin credentials across a microservice platform — for the services and for the humans operating them.

The post covers per-service scoped roles (Atlas Operator, IRSA + RDS Proxy), a two-tier human access model where every prod write is a just-in-time expiring grant, break-glass without standing admin, and why the human authorization model ended up in one IaC module instead of our GitOps operator stack.

Full post + ADR: github.com/OrenOren1/db-access-least-privilege

---

### Instagram (~180 chars)

No standing admin. Anywhere. 🔐 Scoped service roles + JIT expiring grants for humans across MongoDB Atlas & RDS. Full ADR open-sourced — link in bio. #DevOps #Security #Kubernetes #PlatformEngineering #MongoDB #AWS
