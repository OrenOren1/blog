---
theme: seriph
colorSchema: dark
title: "Credentials & Access Platform"
author: "Oren Sultan | Senior DevOps & Platform Engineer | Tikal"
date: "2026-06-08"
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: fade
mdc: true
css: style.css
layout: cover
background: /cover-hero.jpg
---

# Credentials &
# Access Platform

<div style="margin-top: 1.2em; font-size: 0.85em; opacity: 0.9;">

**Oren Sultan** | Senior DevOps & Platform Engineer | Tikal | 2026

</div>

<FloatingIcon icon="🔐" />

<!--
<div dir="rtl">

פתיחה. הדק הולך מהבעיה דרך הארכיטקטורה אל ההחלטות הפתוחות. קהל: פלטפורמה,
אבטחה, SRE. יעד היישור — מודל ארבעת המקרים לבני אדם, Workload OIDC לשירותים,
ושלוש שכבות IaC (ADR-008). ~25 דק' + שאלות.

</div>
-->

---
layout: default
transition: fade-out
---

## 🚨 Current State Is Not Acceptable

<GlassCard>

- **One shared SCRAM secret** for every workload **and** every human — across 3× RDS + 1× MongoDB (mid-split) in `prod-us`
- **27 K8s Secrets · ages 87–291 days · no rotation in practice** — RDS Secrets Manager Lambda exists, but downstream `kubectl` roll is manual ⇒ never done
- **No rotation-compatible path** — rotating the shared secret = coordinated **restart across 27 workloads + every human session** · zero-downtime rotation is impossible by design
- **16 Atlas `ORG_OWNER`s + 9 `ORG_OWNER` API keys + 18 dormant accounts ≥12 months** — verified 2026-06-07
- **G-4 audit attribution gap** — `pasha_boss` at 03:17 unanswerable · 3 of 16 RDS still without IAM DB auth
- **About to multiply** — `prod-eu` going live · MongoDB splitting per-tenant · more RDS incoming → debt compounds per **region × database**

</GlassCard>

> Compromised on-call laptop + one stale K8s Secret = **persistent full-org write on all customer data** — and we are weeks from shipping this same model into a second region. *Below: the 🔒 **non-negotiable** principles that constrain every fix.*

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-02.jpg" alt="kids-book accent — rabbit with broken key" style="width:100%;height:auto;display:block;" /></div>

<!--
<div dir="rtl">

לפתוח עם דחיפות. סוד SCRAM משותף לכל workload ולכל אדם הוא הסיכון המוביל —
לפטופ on-call שנפרץ + סוד K8s ישן = כתיבה מתמשכת על כל הדאטה. מספרים להזכיר:
27 K8s Secrets בגילאים 87–291 ימים, 16 ORG_OWNERs באטלס, 18 חשבונות לא
פעילים מעל 12 חודש. הוק: "עומד להכפיל את עצמו" — prod-eu עולה והחוב גדל
לפי region × DB.

</div>
-->

---
layout: default
transition: fade-out
---

## ⚓ Locked Architectural Principles

<GlassCard>

- **Decompose by audience** — services vs humans, *not* by DB technology 
- **Split source-of-truth** — Okta authoritative for humans · IaC authoritative for services 
- **Workload-native identity** — no stored DB passwords for services in steady state 
- **4-case human model** — standing RO · JIT RW · JIT admin · break-glass 
- **Three-layer IaC** — Pulumi bootstrap · admin-baseline (Tier 2a) · per-region self-service (Tier 2b)

</GlassCard>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-03.jpg" alt="kids-book accent — smiling anchor character" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
class: slide-context-combined
---

## 🌐 Context View — Black Box & External Dependencies

```mermaid
graph TD
    Services["Service Workloads"]
    Humans["Engineers / On-call /<br/>Analysts"]
    Admins["Platform<br/>Administrators"]
    System["🔐 Credentials &<br/>Access Platform"]
    Twingate["🛡️ Twingate<br/>(ZTNA gate)"]
    Okta["🪪 Okta<br/>(IdP)"]
    PD["📟 PagerDuty<br/>(on-call schedule)"]
    Atlas["🍃 MongoDB Atlas"]
    AWS["☁️ AWS<br/>(RDS / IAM / STS)"]
    EKS["⎈ EKS OIDC Provider"]

    Services -->|"assume DB role"| System
    Humans -->|"DB access (4-case model)"| System
    Admins -->|"manage roles, groups, bindings"| System

    Humans -.->|"always-on session"| Twingate
    Twingate -.->|"gates network reach"| Atlas
    Twingate -.->|"gates network reach"| AWS

    System -->|"read groups · admin writes"| Okta
    System -->|"on-call events · roster"| PD
    System -->|"auth · admin ops"| Atlas
    System -->|"auth · admin ops"| AWS
    System -->|"verify workload identity"| EKS

    Okta -->|"SAML group attributes"| System
    Atlas -->|"DB audit log"| System
    AWS -->|"CloudTrail · pgaudit"| System
```

<div class="ctx-foot">

- **Dependencies (human path only · services bypass all three):** 🪪 Okta · 📟 PagerDuty · 🛡️ Twingate · 📊 SIEM / Datadog *(D-6)*
- **🐘 RDS PostgreSQL** — 16 instances · 5 AWS accounts · 13 IAM-DB-auth on / 3 off
- **🍃 MongoDB Atlas** — 3 projects · 4 clusters · 23 DB users
- **🌍 Regions** — `prod-us` · `prod-eu` · `platform-tools`

</div>

> **Key boundary:** platform owns the credential lifecycle — humans never type a DB password, services never store one. Dependencies serve the **human path only**; services authenticate via Workload OIDC.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-04.jpg" alt="kids-book accent — sealed black box peeking eyes" style="width:100%;height:auto;display:block;" /></div>

---
layout: section
transition: fade
---

# ⚙️ Functional

## <span class="neon">View</span>

<div style="position:absolute;right:3rem;bottom:4rem;width:180px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-05.jpg" alt="kids-book accent — gear character mid-turn" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
class: slide-functional-combined
---

## ⚙️ Functional Elements & Interactions

<div class="fn-grid">
<div class="fn-diagram">

```mermaid
graph TD
    EM["📋 Eligibility<br/>Manager"]
    TBM["🔗 Trust-Binding<br/>Manager"]
    SRR["🛠️ Service Role<br/>Reconciler"]
    WIV["🪪 Workload Identity<br/>Verifier"]
    IF["🌉 Identity<br/>Federator"]
    GRP["⏱️ JIT Role Materializer<br/>(open — D-1)"]
    PDS["📟 PD-to-Grant<br/>Synchronizer"]
    ASR["🔍 Access State<br/>Reconciler"]
    AUD["📊 Audit<br/>Aggregator"]
    ARA["📑 Access Review<br/>Aggregator"]

    TBM -->|"declares bindings"| SRR
    SRR -->|"provisions DB roles + trust"| WIV
    PDS -->|"writes on-call membership"| EM
    EM -->|"publishes eligibility rules"| GRP
    GRP -->|"writes time-bound membership"| EM
    EM -->|"groups bound into SAML/OIDC"| IF
    EM --> ASR
    TBM --> ASR
    WIV --> AUD
    GRP --> AUD
    ASR --> AUD
    AUD --> ARA
```

</div>
<div class="fn-side">

**🧩 Core Elements**

- **📋 Eligibility Manager** — Okta groups + group→DB-role gating (humans side of SoT)
- **🔗 Trust-Binding Manager** — workload-identity → DB-role bindings as IaC (services side of SoT)
- **🛠️ Service Role Reconciler** — produces DB roles + cloud-IAM trust artefacts
- **🪪 Workload Identity Verifier** — verifies workload assertion at connect-time → short-lived DB cred
- **🌉 Identity Federator** — carries Okta identity into DB auth path (SAML now · OIDC future)
- **⏱️ JIT Role Materializer** — Okta eligibility + trigger → time-bound membership *(open — D-1)*

</div>
</div>

> **Naming discipline:** elements are responsibilities, not products. Product mapping shows up only in the Deployment view.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-06.jpg" alt="kids-book accent — interlocking puzzle pieces" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: zoom-out
---

## 🧩 Core Functional Elements

<CardGrid :cols="3">

<Card3D title="📋 Eligibility Manager">

Maintains Okta groups + group→DB-role gating rules (humans side of split source-of-truth)

</Card3D>

<Card3D title="🔗 Trust-Binding Manager">

Maintains workload-identity → DB-role bindings as IaC (services side of split source-of-truth)

</Card3D>

<Card3D title="🛠️ Service Role Reconciler">

Watches declared bindings → produces DB-side roles + cloud-IAM trust artefacts

</Card3D>

<Card3D title="🪪 Workload Identity Verifier">

Verifies workload assertion at connect-time → issues short-lived DB-bound credential

</Card3D>

<Card3D title="🌉 Identity Federator">

Carries Okta identity into the downstream DB auth path via SAML (active) / OIDC (future)

</Card3D>

<Card3D title="⏱️ JIT Role Materializer">

Converts Okta eligibility + trigger into time-bound group membership (mechanism open — D-1)

</Card3D>

</CardGrid>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-07.jpg" alt="kids-book accent — row of tiny mascots" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: zoom-out
---

## 🔬 Functional View — Three Stakeholder Questions

<CardGrid :cols="3">

<Card3D title="🔒 Security — Blast radius?">

- Only **two trust gates** (Workload Identity Verifier · Twingate)
- Compromise bounded to **one binding** — no shared secret
- No element holds **both audiences'** credentials
- **Coding agents** inherit only their owner's permissions
- Audit Aggregator = single attribution point

</Card3D>

<Card3D title="🔮 Evolution — New DB next year?">

- Element graph **unchanged** — same 10 responsibilities
- One new **adapter** inside the Service Role Reconciler
- **D-1** lives below this layer — decide later
- Region split (`prod-us` → `prod-eu`) doesn't change the model

</Card3D>

<Card3D title="🧑‍💻 Usability — Who learns what?">

- **Engineers** — standing RO for daily reads · JIT only when needed
- **Security Officers** — IaC PRs · `git log` is the audit
- **On-call** — PagerDuty drives admin grants · no extra workflow
- **Permission expansion** — dev + approver only · no platform team
- **Auditors** — one Audit Aggregator covers everything

</Card3D>

</CardGrid>

> 🔍 **Observability hook:** Audit Aggregator is the spine · every element emits to it.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-08.jpg" alt="kids-book accent — three heads peering through magnifying glass" style="width:100%;height:auto;display:block;" /></div>

---
layout: two-cols-header
transition: slide-left
---

# 🔀 Two Audiences, Two Paths

::left::

<div class="highlight-box">

### 🤖 Service Access Flow
- Trust binding declared in **IaC** (Git)
- **EKS OIDC** at connect-time · short-lived DB-bound credential
- **Okta not in this path** · no stored passwords

</div>

::right::

<div class="highlight-box">

### 👤 Human Access Flow
- Eligibility lives in **Okta groups** · **SAML** carries group attribute
- **4-Case Model** (ADR-004):
  - **A · Standing RO** — direct group → `_engineering_ro` · no JIT · audit-friendly default
  - **B · JIT RW** — peer-approved · TTL-bound · ticket reference
  - **C · JIT admin** — **PagerDuty** drives it · shift starts → grant · ends → revoke
  - **D · Break-glass** — runbook · 1h default / 4h cap · pages `#sec-ops` every connect
- All four emit **Audit Events** · gated by Twingate at the network layer

</div>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-09.jpg" alt="kids-book accent — robot and human shaking hands" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
---

## 🤖 Service Access — Workload Identity Flow

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant Git as Git (IaC)
    participant TBM as Trust-Binding<br/>Manager
    participant SRR as Service Role<br/>Reconciler
    participant CIAM as Cloud IAM<br/>(STS · Atlas)
    participant Pod as Service Pod<br/>(EKS)
    participant WIV as Workload Identity<br/>Verifier
    participant DB as DB Target

    Note over Dev,SRR: Declarative grant — once per binding (PR-time)
    Dev->>Git: PR — workload → DB role binding
    Git->>TBM: merged binding (source of truth)
    TBM->>SRR: declared spec
    SRR->>DB: create / update scoped DB role
    SRR->>CIAM: create trust artefact<br/>(IRSA · Atlas OIDC mapping)

    Note over Pod,DB: Connect-time — every pod start
    Pod->>Pod: read projected SA token (EKS OIDC)
    Pod->>WIV: present workload assertion
    WIV->>CIAM: verify signature + binding match
    CIAM-->>Pod: short-lived credential<br/>(IAM DB auth token · Atlas X.509)
    Pod->>DB: connect with scoped DB role
```

> **No stored passwords.** Identity flows K8s SA → EKS OIDC → cloud IAM trust → DB · TTL 15 min · auto-refresh on the pod side · no human, no Okta, no Twingate.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-10.jpg" alt="kids-book accent — robot handing envelope to server" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
---

## 🙋 Case B — Developer-Requested JIT RW

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant Req as Access Request<br/>(PR / Form)
    participant Mgr as Manager
    participant Okta as Okta
    participant IF as Identity Federator
    participant DB as DB Target

    Dev->>Req: request RW · scope + reason + TTL
    Req->>Mgr: approval needed
    Mgr->>Req: approve
    Req->>Okta: add Dev to ttl_admin_rw group
    Dev->>Okta: authenticate (SAML)
    Okta->>IF: SAML assertion + group attr
    IF->>DB: federated session as admin_rw
    Note over Req,Okta: TTL expires
    Req->>Okta: remove Dev from group
```

> **Manager-approved, TTL-bound.** No platform team in the loop — developer + manager only. Grant + revoke both audited.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-11.jpg" alt="kids-book accent — big key with mini-keys dangling" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
---

## 📟 Case C — JIT Admin (PagerDuty-Triggered)

```mermaid
sequenceDiagram
    autonumber
    participant PD as PagerDuty
    participant PDS as PD-to-Grant Sync
    participant Okta as Okta
    participant Human as On-call
    participant TG as Twingate
    participant IF as Identity Federator
    participant DB as DB Target

    PD->>PDS: on-call assignment event
    PDS->>Okta: add user to oncall_admin group
    Human->>TG: establish ZTNA session
    Human->>Okta: authenticate (SAML)
    Okta->>IF: SAML assertion + admin group attr
    IF->>DB: federated session as oncall_admin
    Note over PD,PDS: Shift ends
    PD->>PDS: assignment-end event
    PDS->>Okta: remove user from group
```

> **Latency depends on D-1.** Hourly under GHA-cron sub-variant · seconds under PD-webhook sub-variant.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-12.jpg" alt="kids-book accent — pager with on-call bandana" style="width:100%;height:auto;display:block;" /></div>

---
layout: section
transition: slide-up
---

# 📦 Information

## <span class="neon">View</span>

<div style="position:absolute;right:3rem;bottom:4rem;width:180px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-13.jpg" alt="kids-book accent — open ledger book character" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
class: slide-dense
---

## 📦 Entities & Integrity Invariants

```mermaid
erDiagram
    HUMAN_IDENTITY ||--o{ GROUP_MEMBERSHIP : "has"
    GROUP ||--o{ GROUP_MEMBERSHIP : "contains"
    GROUP ||--o{ GROUP_TO_DB_ROLE_GATE : "gates"
    DB_ROLE ||--o{ GROUP_TO_DB_ROLE_GATE : "gated-by"
    SERVICE_IDENTITY ||--o{ TRUST_BINDING : "subject"
    DB_ROLE ||--o{ TRUST_BINDING : "target"
    ON_CALL_ASSIGNMENT }o--o{ GROUP_MEMBERSHIP : "produces"
    HUMAN_IDENTITY ||--o{ AUDIT_EVENT : "subject"
    SERVICE_IDENTITY ||--o{ AUDIT_EVENT : "subject"
```

<CardGrid :cols="2">

<Card3D title="🔒 Security lens">

**Four invariants:**
- No **standing** RW/admin for humans
- No **stored** DB passwords for services → **no rotation, no service restart**
- Audit Events **append-only**
- Every materialized DB Role traces to a **Gate** or **Binding**

**Sensitive entities — guard tight:**
- **Trust Binding** — write access *is* effectively granting access
- **Audit Event** — points to **who did what**
- **Group Membership** — **continuous reconciliation** avoids permission drift

</Card3D>

<Card3D title="🔍 Observability hook">

- All **role + permission associations** managed by code — **single source of truth**
- Every change captured in **git commits** + **Audit Events**
- `Audit Event` is the **observability carrier** · **append-only** (no Update / no Delete)
- **Retention:** 18 months target
- **Read access** limited to `Auditor` + `Security Reviewer` roles

</Card3D>

</CardGrid>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-14.jpg" alt="kids-book accent — stack of folders with padlocks" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
class: slide-access-topology
---

## 🔑 Access Topology — Who Reaches What, How, With Which Role

<div class="topo-grid">
<div class="topo-side">

**Two auth backbones · three human flavors · one service path:**

- **Humans** always transit 🪪 **Okta SAML** — three flavors:
  - *Standing R&D group* → SAML attr (RO only)
  - *JIT Platform* — TTL + approval
  - *Break-glass* — bypasses JIT · paged
- **Services** never touch Okta — direct **Workload OIDC**:
  - EKS IRSA → RDS
  - Atlas Workload OIDC → Mongo

</div>
<div class="topo-diagram">

```mermaid
graph LR
    subgraph S["👥 SUBJECTS"]
        direction TB
        H_RO["👤 Engineer<br/>(standing)"]
        H_JIT["👤 Engineer<br/>(JIT RW)"]
        H_OC["📟 On-call"]
        H_BG["🚨 Platform Admin<br/>(break-glass)"]
        SVC["🤖 Service workload<br/>(per domain)"]
        ANL["🤖 Analytics workload"]
    end

    subgraph OKTA_STACK["🪪 OKTA SAML — human auth backbone"]
        direction TB
        G_OKTA["R&D Okta group<br/>group → SAML attr at login<br/>(standing · no JIT)"]
        subgraph GJIT_BOX["⏱️ JIT Platform"]
            G_JIT["Path A / B / C — D-1<br/>request · approve · TTL<br/>writes time-bound<br/>Okta group membership"]
        end
        subgraph BG_BOX["🚨 Break-glass · BYPASSES JIT"]
            G_BG["Okta-gated retrieval of<br/>shared <b>admin</b> SCRAM (RDS)<br/>+ Atlas <b>ORG_OWNER</b> API key<br/>· paged · 1h cap"]
        end
    end

    subgraph OIDC_STACK["🪪 WORKLOAD OIDC — service auth backbone (direct, NOT via Okta)"]
        direction TB
        G_WL["EKS OIDC · IRSA<br/>Atlas Workload OIDC<br/>15-min credentials"]
    end

    subgraph R["🎭 ROLES"]
        direction TB
        R_RO["engineering_ro<br/>SELECT · standing"]
        R_JIT["jit_*_rw<br/>scoped RW · TTL"]
        R_OC["oncall_admin<br/>full · shift TTL"]
        R_BG["legacy admin<br/>full · 1h cap · paged"]
        R_SVC["&lt;svc&gt;_svc_rw<br/>own schema · 15-min creds"]
        R_ANL["analytics_ro<br/>cross-DB read · 15-min creds"]
    end

    subgraph T["🗃️ TARGETS"]
        direction TB
        RDS["🐘 RDS<br/>(per-domain · prod-us · prod-eu)"]
        ATLAS["🍃 MongoDB Atlas<br/>(per-tenant clusters)"]
    end

    H_RO --> G_OKTA --> R_RO
    H_JIT --> G_JIT
    H_OC --> G_JIT
    G_JIT --> R_JIT
    G_JIT --> R_OC
    H_BG -.-> G_BG -.-> R_BG
    SVC --> G_WL --> R_SVC
    ANL --> G_WL --> R_ANL

    R_RO --> RDS
    R_RO --> ATLAS
    R_JIT --> RDS
    R_OC --> RDS
    R_OC --> ATLAS
    R_BG -.-> RDS
    R_BG -.-> ATLAS
    R_SVC --> RDS
    R_SVC --> ATLAS
    R_ANL --> RDS

    classDef human fill:#1e3a5f,stroke:#5a8cc8,color:#fff
    classDef service fill:#5f3a1e,stroke:#c89c5a,color:#fff
    classDef grant fill:#3a1e5f,stroke:#9c5ac8,color:#fff
    classDef grantbg fill:#5f1e1e,stroke:#c85a5a,color:#fff,stroke-dasharray: 5 3
    classDef role fill:#2a2a2a,stroke:#aaa,color:#fff
    classDef target fill:#1e5f3a,stroke:#5ac88c,color:#fff
    class H_RO,H_JIT,H_OC,H_BG human
    class SVC,ANL service
    class G_OKTA,G_JIT,G_WL grant
    class G_BG grantbg
    class R_RO,R_JIT,R_OC,R_BG,R_SVC,R_ANL role
    class RDS,ATLAS target
    style OKTA_STACK fill:#142838,stroke:#5a8cc8,stroke-width:2px,color:#fff
    style OIDC_STACK fill:#1f1a14,stroke:#c89c5a,stroke-width:2px,color:#fff
    style GJIT_BOX fill:#2d1748,stroke:#b07adb,stroke-width:3px,color:#fff
    style BG_BOX fill:#3a1414,stroke:#c85a5a,stroke-width:3px,stroke-dasharray:8 4,color:#fff
```

</div>
</div>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-15.jpg" alt="kids-book accent — treasure map with winding path" style="width:100%;height:auto;display:block;" /></div>

---
layout: section
transition: zoom-out
---

# 🚢 Deployment

## <span class="neon">View</span>

<div style="position:absolute;right:3rem;bottom:4rem;width:180px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-16.jpg" alt="kids-book accent — friendly cargo ship" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: slide-left
---

## 🔬 Deployment View — R&W Perspectives

<CardGrid :cols="3">

<Card3D title="🛡️ Security & Resilience">

*Confinement of damage — malicious or accidental*

- **One hardened admin plane** in `platform-tools` — strictest controls
- **Trust zones don't cross regions** — US can't touch EU, EU can't touch US
- **Admin plane outage** → running services unaffected
- **Region plane outage** → only *new* provisioning paused

</Card3D>

<Card3D title="⚡ Performance">

*Latency & operational friction at runtime*

- **Region-local auth** — no cross-region SAML or DB hops
- **One Twingate session** per human · zero per-connect cost
- **15-min IAM tokens** auto-refresh · no manual rotation
- **Services skip Okta entirely** — connect-time OIDC only

</Card3D>

<Card3D title="⚖️ Regulation">

*Compliance & auditability surface*

- **`git log` is the access-change audit trail** — every grant ties to a PR
- **Data residency** — EU data in `eu-central-1`, US in `us-east-1`
- **No implicit cross-region reach** — controllers region-scoped
- **Tier 2a pinned** for SOC2 evidence · retention target D-6

</Card3D>

</CardGrid>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-17.jpg" alt="kids-book accent — two binoculars characters" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
class: slide-multi-region
---

## 🚢 Multi-Region Topology

<div class="multi-region-diagram">

```mermaid
flowchart TB
    subgraph PT["🛠️ platform-tools · eu-central-1 (admin plane)"]
        direction TB
        EM["📋 Eligibility<br/>Manager"]
        ASR["🔍 Access State<br/>Recon"]
        AUD["📊 Audit<br/>Aggregator"]
        T2A["🧩 Tier 2a · Cluster-API CRDs"]:::tier
        EM ~~~ T2A
        ASR ~~~ T2A
        AUD ~~~ T2A
    end

    subgraph REGIONS[" "]
        direction LR
        subgraph US["🇺🇸 prod-us · us-east-1"]
            direction TB
            WL_US["📦 Service workload"]
            T2B_US["🧩 Tier 2b · Cluster-API CRDs"]:::tier
            WL_US ~~~ T2B_US
        end
        subgraph EU["🇪🇺 prod-eu · eu-central-1"]
            direction TB
            WL_EU["📦 Service workload"]
            T2B_EU["🧩 Tier 2b · Cluster-API CRDs"]:::tier
            WL_EU ~~~ T2B_EU
        end
    end

    JIT["⏱️ JIT Platform<br/>(role materializer · D-1)"]

    subgraph EXT["🌐 External platforms"]
        direction LR
        Okta["🪪 Okta"]
        PD["📟 PagerDuty"]
        Atlas["🍃 Atlas"]
        AWS_IAM["☁️ AWS IAM/STS"]
    end

    EM -->|"admin API"| Okta
    PD -->|"on-call events"| JIT
    JIT -->|"TTL group writes"| Okta

    WL_US -->|"OIDC"| Atlas
    WL_US -->|"IRSA"| AWS_IAM
    WL_EU -->|"OIDC"| Atlas
    WL_EU -->|"IRSA"| AWS_IAM

    classDef tier fill:#2d1748,stroke:#b07adb,stroke-width:2px,color:#e6d9ff
    style REGIONS fill:transparent,stroke:transparent
```

</div>

<div class="tier-explainer">

<div class="tier-card tier-2a">

**🧩 Tier 2a — baseline** *(platform-tools · cross-region)*

- **Crossplane** providers — AWS · Kubernetes
- **MongoDB Atlas Operator** — DB users · org roles
- **PagerDuty** provider — on-call schedule sync

</div>

<div class="tier-card tier-2b">

**🧩 Tier 2b — per-region** *(self-service · bounded blast radius)*

- **Crossplane** regional AWS provider (US-only / EU-only)
- **Per-service** Role + RoleBinding CRDs
- **Atlas Database** CRDs scoped to the region's cluster

</div>

</div>

> **Blast radius:** `prod-us` controllers cannot reach `prod-eu` resources · region-bounded by design.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-18.jpg" alt="kids-book accent — two globes holding hands across bridge" style="width:100%;height:auto;display:block;" /></div>

---
layout: section
transition: fade
---

# 🛠️ Development

## <span class="neon">View</span>

<div style="position:absolute;right:3rem;bottom:4rem;width:180px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-19.jpg" alt="kids-book accent — friendly hammer and wrench" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: slide-left
---

## 🔬 Development View — R&W Perspectives

<CardGrid :cols="3">

<Card3D title="🔮 Evolution">

*Ability to absorb change without restructure*

- Templates folder mirrors **external systems**, not services
- Adding a 3rd DB technology = one new `templates/{tech}/` folder
- **No chart restructure** required
- Sub-chart routing is the abstraction line

</Card3D>

<Card3D title="⚖️ Regulation">

*Compliance & auditability of access changes*

- All access changes flow through **Git PRs** — auditable · reviewable · signed
- Sub-chart **versions pinned** (crossplane 1.18 · atlas-operator 2.5)
- `access-matrix.md` is the **human-readable audit joint**
- **CI lints** block out-of-band grants (e.g. `psql GRANT` outside `templates/`)

</Card3D>

<Card3D title="🧑‍💻 Usability">

*Ease of adoption for service teams*

- `examples/*.yaml` are **runnable snippets** per use-case
- First PR copies **one file**, not the whole chart
- **Onboarding measured in minutes**
- Teams **own their workload permissions** — no platform-team dependency (velocity win)
- **CODEOWNERS** gates access-PR review — clear ownership

</Card3D>

</CardGrid>

> 🔍 **Observability hook:** `git log` of the chart **is** the human-readable change-audit timeline · `access-matrix.md` is the queryable summary.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-20.jpg" alt="kids-book accent — brick wall character with protective arms" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: slide-left
class: slide-tools-selection
---

## 🛠️ Tools Selection — Crossplane (Tier Structure) vs Pulumi

<div class="tools-table">

| Aspect | 🟧 **Pulumi** *(existing)* | 🟦 **Crossplane** *(tier structure)* | Score *(/5)* |
|---|---|---|:---:|
| **👤 Human access** | Shared SCRAM · no JIT · no per-user audit | Okta + SAML · 4-case JIT · per-user audit | 🟧 **1** · 🟦 **5** |
| **🤖 Workload access** | Shared password stored in env/Secret · manual rotation | OIDC + IRSA · 15-min creds · no stored secret | 🟧 **1** · 🟦 **5** |
| **💾 State management** | External state file (S3) · auditable history · manual `pulumi refresh` | K8s etcd · live state · controllers heal drift automatically | 🟧 **4** · 🟦 **4** |
| **🧑‍🔧 Platform-team involvement** | **HIGH** — gatekeeps every change · centralized stack ownership | **LOW** — owns providers; service teams self-serve via CRDs | 🟧 **2** · 🟦 **5** |
| **⏱️ Effort per change** | Code change · CI run · `plan` + `apply` · stack-secret rotation | `kubectl apply` (or PR merge) · controller reconciles | 🟧 **2** · 🟦 **5** |
| **🔄 Infra ↔ code alignment** | **Two PRs** in separate repos · order-sensitive deploy · risk of drift between role + consumer | **Single PR** — Role/Binding CRD ships with the service manifest · atomic helm release | 🟧 **2** · 🟦 **5** |
| **🔐 Authority of permissions** | Stack-level — hard to delegate safely | K8s RBAC per-CRD · CODEOWNERS · narrow grants | 🟧 **2** · 🟦 **5** |
| **⚡ Performance & stability** | Run-based · cold-start each CI · drift surfaces on next plan | Continuous reconciliation · auto-heal · backoff retries | 🟧 **3** · 🟦 **5** |

</div>

<div class="tools-conclusion">

**🎯 Conclusion** — Total: 🟧 **Pulumi 17 / 40** · 🟦 **Crossplane 39 / 40**

- **State management** is the only tie — Pulumi's explicit history vs Crossplane's live etcd
- **🟧 Tier 1 bootstrap** stays with Pulumi — VPCs · AWS accounts · EKS · pre-cluster
- **🟦 Tier 2a onward** goes to Crossplane — continuous reconciliation, per-team self-service, narrow per-CRD grants
- **Net effect** — platform-team bottleneck removed · cross-repo coordination eliminated · per-team velocity multiplied

</div>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-21.jpg" alt="kids-book accent — three big eyes peering at scroll" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade-out
---

## 📁 `sentra-db-permissions` — Chart Tree

<GlassCard>

- **Umbrella chart** · `Chart.yaml` + pinned sub-charts (crossplane 1.18 · atlas-operator 2.5)
- **`templates/`** · 6 folders, one per target system (crossplane · iam-ic · mongodb · rds · okta · observe)
- **`values/`** · environment overlays (`staging.yaml`, `prod.yaml`) + `access-matrix.md`
- **`examples/`** · runnable onboarding snippets per use-case

</GlassCard>

> **One chart, six target-system folders, one access-matrix.** The whole platform fits in one Helm release per cluster.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-22.jpg" alt="kids-book accent — tree with file-folder leaves" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
---

## 🛠️ Controller Plane — Backends Behind `db-permissions`

```mermaid
graph TD
    Chart["📁 <b>db-permissions</b> Helm chart<br/>(umbrella · sub-charts pinned · one release per cluster)"]

    subgraph CP["🛠️ Crossplane (Tier 2a · platform-tools)"]
        direction TB
        P_AWS["provider-aws<br/>IAM Identity Center<br/>· IAM roles · permission sets"]
        P_OKTA["provider-okta<br/>groups · group→app assignments<br/>· SAML attribute statements"]
        P_PD["provider-pagerduty<br/>rosters · schedules<br/>→ feeds PD-to-Grant Sync"]
        P_SQL["provider-sql<br/>PostgreSQL roles · grants<br/>· role memberships"]
    end

    subgraph AO["🍃 MongoDB Atlas Operator (Tier 2a · platform-tools)"]
        direction TB
        AO_USER["AtlasDatabaseUser<br/>SCRAM · X.509 · OIDC users"]
        AO_ROLE["AtlasCustomRole<br/>per-DB scoped roles"]
        AO_FED["AtlasFederatedAuth +<br/>WorkloadIdentity bindings<br/>(SAML + Workload OIDC)"]
    end

    Chart -->|"templates/crossplane/"| P_AWS
    Chart -->|"templates/crossplane/"| P_OKTA
    Chart -->|"templates/crossplane/"| P_PD
    Chart -->|"templates/rds/"| P_SQL
    Chart -->|"templates/mongodb/"| AO_USER
    Chart -->|"templates/mongodb/"| AO_ROLE
    Chart -->|"templates/mongodb/"| AO_FED

    AWS_API["☁️ AWS<br/>IAM · STS · IAM IC"]
    OKTA_API["🪪 Okta Admin API"]
    PD_API["📟 PagerDuty REST API"]
    RDS_API["🐘 RDS PG SQL endpoint"]
    ATLAS_API["🍃 Atlas Admin API"]

    P_AWS -->|"reconcile"| AWS_API
    P_OKTA -->|"reconcile"| OKTA_API
    P_PD -->|"reconcile"| PD_API
    P_SQL -->|"reconcile"| RDS_API
    AO_USER -->|"reconcile"| ATLAS_API
    AO_ROLE -->|"reconcile"| ATLAS_API
    AO_FED -->|"reconcile"| ATLAS_API

    classDef chart fill:#142838,stroke:#5a8cc8,stroke-width:3px,color:#fff
    classDef provider fill:#2d1748,stroke:#b07adb,color:#fff
    classDef atlas fill:#1e5f3a,stroke:#5ac88c,color:#fff
    classDef extapi fill:#2a2a2a,stroke:#aaa,color:#fff
    class Chart chart
    class P_AWS,P_OKTA,P_PD,P_SQL provider
    class AO_USER,AO_ROLE,AO_FED atlas
    class AWS_API,OKTA_API,PD_API,RDS_API,ATLAS_API extapi
    style CP fill:#1f1430,stroke:#9c5ac8,stroke-width:2px,color:#fff
    style AO fill:#143020,stroke:#5ac88c,stroke-width:2px,color:#fff
```

> **One Helm chart, two reconciliation backends.** **Crossplane** owns everything that lands in AWS / Okta / PagerDuty / PostgreSQL (4 providers, 4 upstream APIs). **MongoDB Atlas Operator** owns everything that lands in Atlas (3 CRDs, 1 upstream API). The chart routes each `templates/{system}/` folder to its matching backend — *one PR adds a role across all five upstream systems consistently*.

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-23.jpg" alt="kids-book accent — robot conductor with baton" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: fade
class: slide-observability-fit
---

## 🔍 Observability — Closing the G-4 Attribution Gap

```mermaid
graph LR
    subgraph SRC["📤 Signal Sources (functional elements + DB targets)"]
        direction TB
        H["👥 Human DB connect<br/>(SAML / vault retrieval)"]
        S["🤖 Service DB connect<br/>(Workload OIDC)"]
        G["🎫 Grant / revoke events<br/>(JIT Platform · Okta · PD)"]
        R["🛠️ Reconciler activity<br/>(Crossplane · Atlas Op)"]
    end

    subgraph CAP["🪵 Native Capture Layer"]
        direction TB
        PG["pgaudit (RDS)"]
        ATLAS_AUD["Atlas audit log"]
        CT["AWS CloudTrail"]
        OKTA_LOG["Okta System Log"]
        PD_LOG["PagerDuty audit"]
        METRICS["Prometheus<br/>(controller health)"]
    end

    SINK["📊 Datadog / SIEM<br/>(D-6 picks specific sink)"]
    DASH["📈 Dashboards + SLOs"]
    ALERT["🚨 Alerts<br/>(privileged ops · break-glass connect · drift)"]
    REVIEW["📑 Quarterly access review<br/>(Access Review Aggregator)"]

    H --> PG
    H --> ATLAS_AUD
    S --> PG
    S --> ATLAS_AUD
    G --> OKTA_LOG
    G --> PD_LOG
    R --> CT
    R --> METRICS

    PG --> SINK
    ATLAS_AUD --> SINK
    CT --> SINK
    OKTA_LOG --> SINK
    PD_LOG --> SINK
    METRICS --> SINK

    SINK --> DASH
    SINK --> ALERT
    SINK --> REVIEW

    classDef src fill:#1e3a5f,stroke:#5a8cc8,color:#fff
    classDef cap fill:#5f3a1e,stroke:#c89c5a,color:#fff
    classDef sink fill:#1e5f3a,stroke:#5ac88c,color:#fff
    classDef consumer fill:#2a2a2a,stroke:#aaa,color:#fff
    class H,S,G,R src
    class PG,ATLAS_AUD,CT,OKTA_LOG,PD_LOG,METRICS cap
    class SINK sink
    class DASH,ALERT,REVIEW consumer
```

> **Closes G-4 (today's question: *"who was `pasha_boss` at 03:17?"* — unanswerable).** Every connection now carries the federated identity that authorized it · pgaudit + Atlas audit record the principal · SIEM correlates across the full chain. **Open: D-6 picks the sink (Datadog vs alternative SIEM) + retention period.**

**SLOs — three axes, one table:**

| Signal | SLO target | Why it matters |
|---|---|---|
| **JIT grant latency** (request → SAML attribute live) | **< 60s P95** | On-call usability — Case C automatic grant must beat the page |
| **Audit egress lag** (DB connect → in SIEM) | **< 5 min P99** | Forensics + alerting need near-real-time |
| **Drift reconcile cadence** (Git vs reality) | **every 5 min** | Detect out-of-band grants before they age |
| **Break-glass connect → `#sec-ops` page** | **< 30s** | If `admin` SCRAM is in use, security must know now |
| **Identity attribution coverage** | **100%** of DB connects | Closes G-4 — no `pasha_boss` mystery left |
| **Audit retention** | **18 months** (target) | SOC2 minimum + intra-year incident lookback |

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-24.jpg" alt="kids-book accent — owl in cyan glasses with log scroll" style="width:100%;height:auto;display:block;" /></div>

---
layout: section
transition: slide-up
---

# 📑 Decisions

## <span class="neon">& What's Open</span>

<div style="position:absolute;right:3rem;bottom:4rem;width:180px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-25.jpg" alt="kids-book accent — scales of justice character" style="width:100%;height:auto;display:block;" /></div>

---
layout: default
transition: zoom-out
class: slide-dense
---

## 📑 Decisions — Locked + Open

<CardGrid :cols="3">

<Card3D title="🎯 Locked">

**Group → Role** — Okta group → scoped IAM + Atlas roles · *rejected:* per-user grants

**Break-Glass** — `admin` + `ORG_OWNER` → 2–3 humans · 1h cap · *rejected:* status quo

**Okta + JIT = SoT** — standing via Okta · time-bound via JIT · *rejected:* DB-as-truth

</Card3D>

<Card3D title="🔮 D-1 — JIT Path">

**🅰️ Path A** — Okta API build · Lambda + GHA + Slack · needs Lifecycle Mgmt uplift

**🅲 Path C** — Self-managed OIDC broker · Keycloak / Dex · sidesteps Okta uplift

**🅱️ Path B** — Vendor (Britive / BeyondTrust / Snyk) · SOC2 · 4 integrations required

</Card3D>

<Card3D title="🛠️ D-2 — IaC Tool">

**Scope 1** — `db-permission-module` · Pulumi (typed) vs Crossplane (drift)

**Scope 2** — Workload bindings · Pulumi (per-team) vs Crossplane (K8s-native)

**Sub-Q** — Workload-auth migration timing *(ADR-003 locked OIDC; pace open)*

</Card3D>

</CardGrid>

<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="/chalk-26.jpg" alt="kids-book accent — locked + open padlock friends" style="width:100%;height:auto;display:block;" /></div>

---
layout: cover
transition: fade
background: /thanks-hero.jpg
class: thanks-slide
---

# Thank You
## Questions?

**Oren Sultan** · Senior DevOps & Platform Engineer · Tikal
[app.sultano.blog](https://app.sultano.blog) · [linkedin.com/in/oren-sultan-0527bab6](https://www.linkedin.com/in/oren-sultan-0527bab6/) · [github.com/orenoren1](https://github.com/orenoren1)

<!--
<div dir="rtl">

סיכום. שלוש בקשות מהקהל: פידבק על מודל ארבעת המקרים (הליבה הרעיונית),
העדפה ל-Path A / B / C עבור D-1 (ההחלטה הפתוחה), וכל תרחיש blast-radius
שפספסתי בניתוח אזורי האמון. פרטי קשר על המסך — Slack, LinkedIn, GitHub.

</div>
-->
