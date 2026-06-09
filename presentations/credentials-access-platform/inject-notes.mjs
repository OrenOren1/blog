#!/usr/bin/env node
// Inject one HTML-comment speaker-note block at the end of each slide body
// in slides.md. Notes are authored to be 2-4 sentences each, anchored in
// AD.md and the slide's own content. Slide numbering = 3032 source order
// (1 = cover, 27 = thank-you).

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLIDES = resolve(HERE, "slides.md");
const BACKUP = resolve(HERE, "slides.md.pre-notes.bak");

const NOTES = {
  1: `OPEN: this deck walks through Sentra's credentials & access platform from
problem to architecture to open decisions. Audience: platform eng, security,
SRE. Target outcome — alignment on the 4-case human model, Workload OIDC for
services, three-layer IaC (ADR-008). Plan ~25 min + Q&A.`,
  2: `Lead with urgency. Shared SCRAM secret across every workload + every human
is the headline risk — one stale K8s Secret = persistent full-org write on
all customer data. Numbers worth landing: 27 K8s Secrets, ages 87–291 d, 16
Atlas ORG_OWNERs, 18 dormant accounts ≥12 months. Hook: "about to multiply"
when prod-eu goes live — debt compounds per region × database.`,
  3: `Five non-negotiables — frame them as guardrails, not preferences. Pause on
"split source-of-truth": Okta authoritative for humans, IaC authoritative for
services — this is the hardest internalisation. "Three-layer IaC" is ADR-008:
Pulumi bootstrap (Tier 1) + Crossplane admin-baseline in platform-tools
(Tier 2a) + Crossplane per-region self-service (Tier 2b).`,
  4: `The platform is a black box; everything outside is either an actor (services
/ engineers / admins) or a hard dependency (Okta, PagerDuty, Twingate, the
DBs). Key boundary — humans never type a DB password, services never store
one. Reinforce: dependencies serve the human path only; services bypass
Okta / PD / Twingate entirely via Workload OIDC.`,
  5: `View transition. The functional view answers "what does the system do" —
responsibilities, not products. ~10 seconds; the next slide is the meat.`,
  6: `Ten elements, each a responsibility. The Eligibility Manager + Trust-Binding
Manager pair is the split-SoT realisation. Service Role Reconciler + Workload
Identity Verifier handle the service path. Identity Federator + JIT Role
Materializer carry the human path — JIT mechanism is still open (D-1).
Audit Aggregator → Access Review Aggregator closes the audit loop.`,
  7: `Six cards — the always-on responsibilities. The "open per D-1" element is
JIT Role Materializer; its realisation (Path A: Okta API build · Path B:
3rd-party vendor · Path C: hybrid) is the one undecided architectural piece
in ADR-007.`,
  8: `R&W functional-view pattern — pose the three perspectives that matter to
different stakeholders. Security asks blast radius. Evolution asks change
cost when a new DB type lands. Usability asks who-learns-what. Keep this
slide tight; it sets up the views to come.`,
  9: `Single most important framing in the deck. Two distinct identity paths:
humans via the Okta SAML backbone (3 flavors — standing RO from a group
attr · JIT Platform for RW + on-call admin · break-glass for the legacy
admin / ORG_OWNER retrieval) and services via Workload OIDC (no shared
secret, no Okta, no Twingate). Reinforce: services never touch Okta.`,
  10: `Walk the sequence: K8s ServiceAccount → EKS OIDC → AWS IAM trust → DB. TTL
15 min, auto-refresh on the pod side. No human, no Okta, no Twingate in the
hot path. RDS uses IRSA + IAM DB auth; Atlas uses Workload OIDC directly.
This is the steady-state credential lifecycle for services.`,
  11: `The one case with a human approval gate. Developer requests via the
platform (Slack command / web form), approver (peer or team lead) signs off,
ephemeral Okta group membership written for a bounded TTL, downstream
federation projects the new scoped role. Sub-variants here depend on D-1
(Path A timer, vendor, etc.).`,
  12: `On-call gets admin scope automatically — no ticket, no approver. PagerDuty
subscription drives the ephemeral Okta group membership. Latency is
trigger-dependent: hourly under the GHA-cron sub-variant; seconds under PD
webhook → Lambda or Slack-command sub-variants. User must reconnect to the
DB to pick up the new group attribute.`,
  13: `View transition. Information view = entities and the rules that protect
them. Next slide is the entity model + invariants.`,
  14: `Four core entities. Hammer on the four invariants — no standing RW/admin
for humans, no stored DB passwords for services, every materialized DB role
traces to a Gate or a Binding (origin), Trust Binding write = grant (audit
anchor). 18-month audit retention; Audit Event is append-only.`,
  15: `The mermaid traces every reach path. Two auth backbones, three human
flavors, one service path. "R&D group → SAML attr" is the standing-RO case
(no JIT). JIT Platform is boxed — it's where TTL + approval live. Break-
glass also boxed — bypasses JIT and pages on every use.`,
  16: `View transition. Deployment view = where elements actually run. Next: R&W
perspectives on the deployment, then the multi-region topology.`,
  17: `Three stakeholder perspectives on the deployment. SRE / on-call: where does
it run, who pages on it. Security: cross-cluster trust boundaries (especially
prod-us vs prod-eu isolation). Platform: operational ownership of the
admin plane vs the per-region planes.`,
  18: `The deployment map. platform-tools cluster (eu-central-1) holds the admin
plane — Eligibility Manager, PD-Sync, Audit Aggregator, plus Tier 2a
controllers (admin baseline, cross-region reach). prod-us and prod-eu each
hold their own Tier 2b controllers (region-scoped self-service). Blast
radius: prod-us controllers cannot reach prod-eu — region-bounded by
design. Every human DB hop transits Twingate.`,
  19: `View transition. Development view = how the platform's IaC + controllers
are organised as code. Next: R&W perspectives, then the Pulumi-vs-Crossplane
scored comparison.`,
  20: `Three perspectives on dev. Service teams: how do I add a DB role for my
service today (answer: one PR to the umbrella chart). Platform team: how do
I keep the chart consistent across 5 upstream systems. Operators: where do
I look when a CRD is stuck. Sets up why Crossplane wins Tier 2.`,
  21: `The scored comparison — Pulumi 17/40, Crossplane 39/40. Only tie is State
management (Pulumi's explicit history vs Crossplane's live etcd). Critical
row: Infra↔code alignment — Pulumi needs two PRs in separate repos and
order-sensitive deploy; Crossplane ships the role + binding CRD atomically
with the service helm release. Pulumi stays for Tier 1 (VPCs, EKS, AWS
accounts); Crossplane owns Tier 2 onward.`,
  22: `One umbrella helm chart, pinned sub-charts (Crossplane 1.18, Atlas Operator
2.5). Six templates/ folders, one per target system — crossplane, iam-ic,
mongodb, rds, okta, observe. Service teams contribute via PR; access-
matrix.md is the human-readable audit joint that joins it all.`,
  23: `One helm chart, two reconciliation backends. Crossplane handles AWS / Okta
/ PagerDuty / PostgreSQL (4 providers, 4 upstream APIs). MongoDB Atlas
Operator handles Atlas (3 CRDs, 1 upstream API). The chart routes each
templates/{system}/ folder to its matching backend — one PR adds a role
across all 5 upstream systems consistently.`,
  24: `G-4 is the audit attribution gap — the "pasha_boss at 03:17" moment that's
unanswerable today. Audit Event is the carrier; append-only invariant.
18-month retention target (SOC 2 minimum + intra-year incident lookback).
Coverage target: 100% of DB connects identity-attributable. Reconciler
activity (Crossplane + Atlas Op) feeds the same audit pipeline.`,
  25: `Closing section. Decisions = what's locked and what's still open. Next
slide is the takeaway summary.`,
  26: `Three columns. Locked — Group→Role (Okta group → scoped IAM + Atlas roles,
not per-user) · Break-Glass (admin + ORG_OWNER → 2–3 humans, 1h cap) ·
Okta+JIT = SoT (standing via Okta, time-bound via JIT, not DB-as-truth).
Open — D-1 JIT Path (A custom Okta build · B vendor like Britive · C
hybrid) — pick at next ADR review. D-2 Vendor — only triggers if D-1 →
Path B. IaC is *not* open — ADR-008 locks Pulumi + Crossplane tier
structure.`,
  27: `Wrap up. Three asks for the audience: feedback on the 4-case human model
(the conceptual core), Path A/B/C preference for D-1 (the open call), and
any blast-radius scenario I missed in the trust-zone analysis. Contact info
on screen — Slack, LinkedIn, GitHub.`,
};

function parseSlides(text) {
  const lines = text.split("\n");
  const slides = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() !== "---") i++;
  while (i < lines.length) {
    if (lines[i].trim() !== "---") break;
    const fmStart = i + 1;
    let j = fmStart;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j >= lines.length) break;
    const fm = lines.slice(fmStart, j);
    const bodyStart = j + 1;
    let k = bodyStart;
    while (k < lines.length && lines[k].trim() !== "---") k++;
    const body = lines.slice(bodyStart, k);
    slides.push({ fm, body });
    i = k;
  }
  return slides;
}

const src = readFileSync(SLIDES, "utf8");
copyFileSync(SLIDES, BACKUP);
console.log(`• backup → ${BACKUP}`);

const slides = parseSlides(src);
console.log(`• parsed ${slides.length} slides`);

let injected = 0;
for (let n = 0; n < slides.length; n++) {
  const slideNo = n + 1;
  const note = NOTES[slideNo];
  if (!note) continue;
  // Don't double-inject — if the body already has any <!-- block, skip
  const bodyText = slides[n].body.join("\n");
  if (/<!--[\s\S]*?-->/.test(bodyText)) {
    console.log(`  skip slide ${slideNo} (already has a comment block)`);
    continue;
  }
  // Trim trailing empties
  while (slides[n].body.length && slides[n].body[slides[n].body.length - 1].trim() === "") {
    slides[n].body.pop();
  }
  slides[n].body.push("");
  slides[n].body.push("<!--");
  for (const ln of note.split("\n")) slides[n].body.push(ln);
  slides[n].body.push("-->");
  slides[n].body.push("");
  injected++;
}

const out = [];
for (const s of slides) {
  out.push("---");
  out.push(...s.fm);
  out.push("---");
  out.push(...s.body);
}
writeFileSync(SLIDES, out.join("\n"), "utf8");
console.log(`✔ injected ${injected} speaker-note block(s) into slides.md`);
