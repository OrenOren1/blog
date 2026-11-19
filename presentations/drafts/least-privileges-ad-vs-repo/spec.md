---
status: proposed
slug: least-privileges-ad-vs-repo
title: "Sentra Least-Privileges — Five Systems, Five Auth Methods"
subtitle: "How Terraform (and friends) authenticates into every SaaS we touch"
shape: auth-methods-walk
talk_minutes: 20
target_slides: 13
length: focused
audience: devops-sre
audience_hint: "DevOps / SRE / Platform peers"
scope: mixed
sources:
  ad: /Users/oren.sultan/blog/presentations/least-privileges-high-level/AD.md
  repo: https://github.com/sentraio/sentra-least-privileges
  pulumi_pd: /Users/oren.sultan/sentra/sentra-infrastructure/Pulumi.pagerduty-provision.yaml
systems_covered: [Okta, Atlas, AWS-IdC, PagerDuty, Entitle]
auth_methods_covered:
  - AWS — GHA OIDC → IAM Role (federated, no static keys)
  - Okta — OAuth client_credentials + private JWK
  - Atlas — Admin API key pair (public + private)
  - Entitle — API PAT (+ Slack bot token + Okta JWK for its own integrations)
  - PagerDuty — API token (Crossplane Secret + Pulumi stack config — outside the TF repo)
theme: seriph
transition: slide-left
color_scheme: dark
visual_style: diagram-first
meta_slides:
  title: true
  about_me: true
  problem_frame: true
  closing: true
about_me:
  include: true
  placement: after-title
  name: Oren Sultan
  title: Senior DevOps / Platform Engineer
  company: Tikal
  years: 15
  specialties: [Kubernetes, ArgoCD, Crossplane, Platform Engineering, SRE]
  logo: null
presentation_craft:
  diagram_first: true
  one_slide_per_auth_method: true
  story_progression: true
  rw_methodology: false
output_path: /Users/oren.sultan/blog/presentations/drafts/least-privileges-ad-vs-repo
next: /presentation.clarify
---

# Sentra Least-Privileges — Five Systems, Five Auth Methods

> Each SaaS plane in our least-privilege stack uses a different mechanism to authenticate the IaC layer that manages it. One slide per method — concrete: cred name, scope, where it lives, how it rotates.

---

## Purpose

Show the audience the five SaaS systems we touch, then walk through the five distinct authentication mechanisms our IaC layer uses to manage them — what the credential is, what scope it has, where it's stored, and how it's renewed.

## Narrative arc

```
Why            Existing             How IaC auths into each one (one slide each)              How it runs end-to-end    What's next
the before  →  5 systems        →   AWS(OIDC)  Okta(JWK)  Atlas(key)  Entitle(PAT)  PD(token) →  prod-rw request      →  open items
              (overview slide)                                                                                              + roadmap
```

## Non-goals

- **No per-system deep-dive** — the matrix on slide 4 is the only system-by-system view.
- **No R&W viewpoint walk** (user explicit opt-out).
- **No end-user auth slides** — mongosh OIDC, AWS SSO, Entitle SAML are referenced inside the per-system auth slides as the *result* of IaC's work, not as their own slides.
- **No service-pod credential path** — out of scope.

## Slide outline

13 slides. Slide map:

| # | Slide id                       | Layout      | Diagram |
|---|--------------------------------|-------------|---------|
| 1 | s01-title                      | cover       | —       |
| 2 | s02-about-me                   | intro       | logo    |
| 3 | s03-the-before                 | statement   | shared-cred fan-out |
| 4 | s04-five-systems               | image-right | 5-plane diagram + compact matrix |
| 5 | s05-auth-aws-gha-oidc          | two-cols    | OIDC trust chain mermaid |
| 6 | s06-auth-okta-oauth-jwk        | two-cols    | client_credentials + JWK flow |
| 7 | s07-auth-atlas-api-keypair     | two-cols    | API key path mermaid |
| 8 | s08-auth-entitle-pat-plus      | two-cols    | three-cred constellation |
| 9 | s09-auth-pagerduty-token       | two-cols    | dual-controller (Crossplane + Pulumi) |
| 10| s10-end-to-end                 | image-right | sequence diagram |
| 11| s11-open-items                 | default     | checklist |
| 12| s12-whats-next                 | default     | roadmap |
| 13| s13-closing                    | end         | —       |

---

### s01-title
- **title**: "Sentra Least-Privileges — Five Systems, Five Auth Methods"
- **subtitle**: "How Terraform (and friends) authenticates into every SaaS we touch"
- **image_prompt**: dark Sentra-style cover, five labeled nodes (Okta · Atlas · AWS · PagerDuty · Entitle) in a pentagon, each with a small key icon labeled with its auth pattern.
- **speaker_notes**: One sentence — "Five SaaS systems, five different auth methods our IaC layer uses to manage them. Today we'll walk each one."

### s02-about-me
- **title**: "About me"
- **bullets**:
  - Oren Sultan · Senior DevOps / Platform Engineer @ Tikal
  - 15 years across infrastructure and platform engineering
  - Kubernetes · ArgoCD · Crossplane · Platform Engineering · SRE
- **speaker_notes**: 20 seconds.

### s03-the-before
- **title**: "Where we started"
- **key_message**: Shared admin creds, no attribution, no fast revocation.
- **bullets**:
  - Atlas: one `admin` user with `atlasAdmin`, shared by ~25 services + all humans
  - RDS: master credentials distributed verbatim into ~25 service secrets
  - No per-actor audit trail, no revocation under 24h
  - One compromised pod = full admin to all customer data
- **diagram**: simple before-state — one shared-cred key fanning out to 25 service icons + a human icon.
- **image_prompt**: a single key icon with 25 dotted lines fanning out.
- **speaker_notes**: 60 seconds. Get to the next slide fast.

### s04-five-systems
- **title**: "Five SaaS systems answer it"
- **key_message**: Five planes collaborate. Terraform binds four of them; PagerDuty is the exception.
- **layout**: pentagon diagram on top, compact matrix below.
- **diagram**: 5-plane pentagon — user enters via Slack, Entitle in the middle fans out to Okta / Atlas / AWS IdC / PagerDuty.
- **matrix** (compact — auth column is now just the *name* of the method; depth comes in slides 5-9):

  | System         | What TF owns                                                       | Auth pattern                  | Status        |
  |----------------|--------------------------------------------------------------------|-------------------------------|---------------|
  | **Okta**       | 3 apps + JIT group + SSO assignments                               | OAuth + private JWK *(s6)*    | 🟢 live       |
  | **Atlas**      | Workforce OIDC + role mappings                                     | Admin API key pair *(s7)*     | 🟢 live       |
  | **AWS IdC**    | PermissionSets + AccountAssignments                                | GHA OIDC → IAM Role *(s5)*    | 🟢 live       |
  | **PagerDuty**  | *(outside TF repo)* Schedules · Services                           | API token (split) *(s9)*      | 🟡 split-mgmt |
  | **Entitle**    | Workflows + integrations + bundles                                 | API PAT (+2 more) *(s8)*      | 🟢 live       |

- **image_prompt**: pentagon — Okta top, Atlas right, AWS bottom-right, PagerDuty bottom-left, Entitle left; Slack entry-point; "TF monorepo" central glue.
- **speaker_notes**: 2 minutes — the anchor slide. Read the matrix, point at the pentagon, then say "now we'll see what each of those auth columns actually means."

### s05-auth-aws-gha-oidc
- **title**: "Auth #1 — AWS · GHA OIDC → IAM Role"
- **status**: 🟢 federated (no static AWS keys anywhere)
- **two-cols**:
  - **The mechanism** *(left)*
    - GitHub Actions OIDC issues a short-lived JWT identifying the workflow + repo + ref
    - AWS trusts `token.actions.githubusercontent.com` as an OIDC IdP
    - `aws-actions/configure-aws-credentials@v4` exchanges the JWT for STS creds via `sts:AssumeRoleWithWebIdentity`
    - The exchanged session is bound to the IAM role `CrossplaneIdentityCenterAdmin` (name historical)
    - That role has the IdC management permissions; it's *also* trusted by IRSA (platform-tools EKS) and AWS SSO (humans), so the role is multi-trusted
  - **The wiring** *(right)*
    - Trust policy on the IAM role pins:
      - `token.actions.githubusercontent.com` (OIDC IdP)
      - `repo:sentraio/sentra-least-privileges:ref:refs/heads/main` (which workflow can assume)
    - No GHA Secrets used for AWS — purely federation
    - Session name: `terraform-sentra-least-privileges`
    - Region: `us-east-1`
    - Rotation: nothing to rotate — JWTs are minted per run, expire in 15 min
- **diagram**: mermaid — GitHub Actions runner → mints JWT → STS AssumeRoleWithWebIdentity → IAM role `CrossplaneIdentityCenterAdmin` → IdC API calls.
- **image_prompt**: a GitHub Actions icon issuing a token-shape into an AWS shield, with three other trust arrows feeding into the same shield (IRSA, SSO).
- **speaker_notes**: 90 seconds. Best-case auth: no static keys, short-lived, audit-logged in CloudTrail.

### s06-auth-okta-oauth-jwk
- **title**: "Auth #2 — Okta · OAuth client_credentials + private JWK"
- **status**: 🟢 live (used in two places)
- **two-cols**:
  - **The mechanism** *(left)*
    - Okta service app: API Services type (no human in the flow)
    - Client authentication = `private_key_jwt` — TF signs a JWT with a private key; Okta verifies it against the public JWK registered on the app
    - Token endpoint returns a bearer access token scoped to the OAuth scopes the app has been granted
    - **Used in TWO places**:
      - Our TF service app `Crossplane` (`0oa13mcky9z2aeC9m698`) — what `terraform apply` uses
      - Entitle's Okta API Services app — what *Entitle* uses to call Okta API (provisioned by our `modules/okta/apps_entitle_api.tf`)
  - **The wiring** *(right)*
    - TF cred files (local):
      - `~/sentra/.okta-terraform-app-private.pem` — TF's private key
      - `~/sentra/.okta-entitle-api-jwk.private.json` — Entitle's private JWK
    - GHA secrets: `OKTA_CLIENT_ID` · `OKTA_PRIVATE_KEY` · `ENTITLE_OKTA_PRIVATE_JWK` · `ENTITLE_OKTA_JWK_KID` · `_N`
    - Scopes (TF app): `apps/groups/policies/roles.{read,manage}` · `appGrants.{read,manage}` · `users.read`
    - Bootstrap: an Okta Super Admin grants those scopes manually on greenfield
    - Rotation: rotate the JWK pair → update the GHA secret + local file → re-register the public JWK on the app
- **diagram**: mermaid — TF signs JWT with private key → POST `/oauth2/v1/token` with `private_key_jwt` → Okta verifies vs public JWK → access token → API calls. Side: same flow used by Entitle.
- **image_prompt**: an Okta-orange lock with a JWT-shape going in and a bearer token coming out; a side icon shows the same flow reused by Entitle.
- **speaker_notes**: 90 seconds. Highlight the *reuse* — the same pattern is used by Entitle to call Okta back; we provision that app from this repo.

### s07-auth-atlas-api-keypair
- **title**: "Auth #3 — Atlas · Admin API key pair"
- **status**: 🟢 live · 🟡 rotation policy missing
- **two-cols**:
  - **The mechanism** *(left)*
    - Atlas Admin API uses HTTP digest auth — public key as username, private key as password
    - Keys are scoped at the org or project level; ours is org-level
    - Built-in roles: ORG_OWNER required for federation config (Workforce OIDC IdP + role mappings)
    - There's no JWT, no short-lived token — the key pair *is* the credential
  - **The wiring** *(right)*
    - Local cred: `~/sentra/.atlas-federation-apikey.json` (json: `{publicKey, privateKey}`)
    - GHA secrets: `ATLAS_FEDERATION_PUBLIC_KEY` · `ATLAS_FEDERATION_PRIVATE_KEY`
    - Provider config: `provider "mongodbatlas" { public_key = var.atlas_public_key; private_key = var.atlas_private_key }`
    - Why ORG_OWNER (broad): federation config requires org-level write; can't be narrowed today
    - Rotation: ❌ no automated policy yet — manual rotate via Atlas UI → update SM + local file
- **diagram**: mermaid — TF → `provider mongodbatlas` → HTTP digest (public/private) → Atlas Admin API → federation + role-mapping calls.
- **image_prompt**: MongoDB leaf logo with a key-pair icon (two keys clasped); a small warning badge "ORG_OWNER".
- **speaker_notes**: 60 seconds. Call out the rotation gap (slide 11 picks it up).

### s08-auth-entitle-pat-plus
- **title**: "Auth #4 — Entitle · API PAT (+ Slack bot + Okta JWK)"
- **status**: 🟢 live
- **key_message**: Entitle itself takes a single PAT — but *its integrations* (Slack and Okta) each need their own credential, which TF passes through. Three creds total.
- **two-cols**:
  - **TF → Entitle: API PAT** *(left)*
    - Bearer token (PAT) — generated once in Entitle admin UI
    - Sent as `Authorization: Bearer <PAT>` to `https://api.us.entitle.io`
    - Local cred: `~/sentra/beyondtrust/.entitle-pat`
    - GHA secret: `ENTITLE_API_KEY`
    - Provider config: `provider "entitle" { api_key = var.entitle_api_key }`
    - No scope concept on the PAT — full Entitle admin
  - **What TF passes through to Entitle's integrations** *(right)*
    - **Slack bot token** (`ENTITLE_SLACK_BOT_TOKEN`) — Entitle posts approval messages + listens for button clicks → needs a Slack bot user in our workspace
    - **Okta private JWK** (`ENTITLE_OKTA_PRIVATE_JWK`) — Entitle calls Okta API (add user to group, remove user, etc.) → uses the *same auth pattern as slide 6*, on the Entitle Okta API Services app we provision
    - The Okta JWK is the link between slides 6 and 8 — same mechanism, different consumer
- **diagram**: a three-key constellation centred on Entitle: PAT (top), Slack bot token (left), Okta JWK (right). Each key labeled with its purpose.
- **image_prompt**: BeyondTrust shield with three keys laid around it — top labeled "PAT (TF→Entitle)", left labeled "Slack bot (Entitle→Slack)", right labeled "Okta JWK (Entitle→Okta)".
- **speaker_notes**: 90 seconds. The "why three creds?" moment — Entitle is itself a multi-tenant SaaS that needs to talk back into our Okta + Slack to function.

### s09-auth-pagerduty-token
- **title**: "Auth #5 — PagerDuty · API token (used by two controllers)"
- **status**: 🟡 split-managed (intentional, ADR-009)
- **two-cols**:
  - **Same auth mechanism, two consumers** *(left)*
    - PagerDuty REST API uses a single bearer-style token: `Authorization: Token token=<api-token>`
    - The token is generated in PD UI (User-scoped or General-Access)
    - **PD is NOT in `sentra-least-privileges`** — it's managed by two different controllers, each holding the token separately
    - Consumer A: **Crossplane** `provider-pagerduty` on `platform-tools` EKS → manages Schedules · ScheduleLayer · ScheduleOverride (ADR-009)
    - Consumer B: **Pulumi** `sentra-infrastructure/pagerduty_provision/` → manages ~80 Services + escalation-policy bindings
  - **Where each token lives** *(right)*
    - Crossplane: K8s `Secret` on `platform-tools` cluster; provider reads from there. Stakater Reloader watches it for rotation.
    - Pulumi: `Pulumi.pagerduty-provision.yaml` config stanza `pagerduty.token.secure` — encrypted with the Pulumi stack passphrase
    - Datadog also has a *read-only* PD key (`pager_duty_read_only_key`) for incident sync — same auth pattern, separate token
    - Rotation: manual via PD UI → update both Secret + Pulumi config + Datadog secret
- **diagram**: dual-controller mermaid — left "Crossplane on platform-tools" reading K8s Secret → PD API; right "Pulumi" reading stack config → PD API. Both point at the same PagerDuty SaaS box.
- **image_prompt**: PagerDuty triangle logo split down the middle — left half "K8s/Crossplane (Secret)", right half "Pulumi (encrypted config)".
- **speaker_notes**: 90 seconds. Yes, two IaC tools for one SaaS; yes, on purpose; ADR-009 scoped Crossplane to schedules only.

### s10-end-to-end
- **title**: "A real `prod-rw` request, end-to-end"
- **key_message**: Slack command → Entitle workflow → grant lands in Okta + Atlas + AWS in ~30 seconds. Every auth mechanism on slides 5-9 fires.
- **bullets** (the diagram carries it):
  1. User in Slack: `/access request prod-rw`
  2. Approver in Slack approves *(or on-call auto-approves via Break-glass workflow — PagerDuty schedule check)*
  3. Entitle → Okta (Okta JWK, slide 6+8): user added to `db-prod-readwrite-jit`
  4. Atlas Workforce OIDC sees new group at next token refresh → custom role applies
  5. AWS IdC AccountAssignment added → user runs `aws sso login` → temporary creds with `rds-db:connect`
  6. User runs `mongosh --authMechanism MONGODB-OIDC ...` + `psql` via IAM token — both work, both audit-logged
  7. TTL expires → Entitle reverses every grant in the same order
- **diagram**: sequence diagram with swim-lanes — User · Slack · Entitle · Okta · AWS IdC · Atlas · DB. Dotted reverse arrows for TTL teardown.
- **image_prompt**: horizontal 7-step sequence illustration with dotted reverse-arrows showing teardown.
- **speaker_notes**: 2 minutes. The *aha* slide.

### s11-open-items
- **title**: "Open items"
- **bullets**:
  - 🟡 **Atlas key rotation policy** — ORG_OWNER pair has no automated rotation (slide 7 gap)
  - 🟡 **PR #11** — finalise Entitle `db-rw` `allowedDurations`
  - 🟠 **Legacy `charts/` cleanup** — argocd ApplicationSet still references superseded Crossplane Helm charts
  - 🟠 **PD rationalisation** — Crossplane vs Pulumi split is intentional but worth revisiting
  - 🟡 **`terragrunt.hcl` stub** — wire the umbrella or delete it
  - 🔴 **Destroy guardrails** — add `prevent_destroy` on IdP + workflows + the Okta `Crossplane` service app (losing that app = lockout)
- **image_prompt**: a checklist on a clipboard with items colour-tagged.
- **speaker_notes**: 60 seconds. Frame as "next week's PRs."

### s12-whats-next
- **title**: "What's next"
- **bullets**:
  - **Atlas key rotation runbook** + Entitle bundle so the operator can run it from Slack
  - **Tear down legacy `charts/`** + argocd ApplicationSet — close the Crossplane→TF migration
  - **Destroy guardrails** + per-resource `prevent_destroy`
  - **PD rationalisation** — evaluate whether `provider-pagerduty` covers Services well enough to consolidate
  - **Story #70394** — `okta_assign_db_admins.py` to land (ADR-001 §Pattern C reinstated)
  - **Beyond v1**: Atlas Workload Identity Federation for services (ADR-001 Option 5, deferred) → eliminate stored Atlas passwords for pods too
- **image_prompt**: a roadmap strip with 6 milestones.
- **speaker_notes**: 60 seconds. End on the v2 ambition — workload identity for services closes the loop.

### s13-closing
- **title**: "Thanks · Q&A"
- **bullets**:
  - Repo: [sentraio/sentra-least-privileges](https://github.com/sentraio/sentra-least-privileges)
  - AD: `~/blog/presentations/least-privileges-high-level/AD.md`
  - ADRs: ADR-001 · ADR-008 · ADR-009 — in `sentra-infrastructure/docs/`
  - Slack: `#devops`
- **image_prompt**: clean closing card with QR for repo + GitHub logo.
- **speaker_notes**: Take Q&A.

---

## Open structural questions for `/presentation.clarify`

1. **Slide 4 matrix** — the auth column is now just a method name + slide reference. Worth its weight as an anchor, or should the slide be all-diagram (move the matrix to a backup slide)?
2. **Slide 6 (Okta auth)** — covers both TF→Okta *and* Entitle→Okta on one slide. If that's confusing, split into two slides and drop slide 12 (what's next) to stay at 13.
3. **Slide 8 (Entitle auth)** — three creds on one slide is dense. If you prefer a single-cred focus, give the PAT this slide and move the Slack/Okta-JWK callouts to slide 10 (end-to-end) speaker notes.
4. **End-user auth absent by design** — mongosh OIDC, AWS SSO, Entitle SAML SSO are *not* their own slides; they appear on the end-to-end slide as outputs. Confirm that's the right call for a DevOps audience.

## Change Log

- 2026-06-30 specify: restructured around five auth-method slides (one per IaC→SaaS mechanism). Replaced abstract "TF monorepo" + "how apply runs" + "meet Entitle" + "PagerDuty exception" slides with concrete auth slides (5: GHA OIDC, Okta JWK, Atlas key pair, Entitle PAT-plus, PD token). End-to-end flow (slide 10) explicitly ties back to which auth methods fire. 13 slides, no R&W methodology, no per-system loop (user explicit opt-outs).
- 2026-06-30 specify: merged status + implementation angles. [SUPERSEDED]
- 2026-06-30 specify: status-briefing across 5 SaaS systems. [SUPERSEDED]
- 2026-06-30 specify: tech-tour outline applied. [SUPERSEDED]
