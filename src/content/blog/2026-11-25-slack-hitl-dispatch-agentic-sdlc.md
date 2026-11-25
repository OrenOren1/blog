---
title: "The On-Switch for Your AI Factory"
meta_title: "HITL Dispatch for Agentic SDLC: Designing Human-in-the-Loop Kubernetes Triggers"
description: "When AI agents run on a cluster nobody SSHes into, who pulls the trigger? The infra problem, four dispatch options, and what it takes to make a chat message a credible cluster trigger."
date: 2026-11-25T14:00:00+00:00
image: "/images/blog/2026/slack-hitl-dispatch/cover.png"
categories:
  - "Agentic AI"
  - "Platform Engineering"
tags:
  - "argo-events"
  - "argo-workflows"
  - "agentic-sdlc"
  - "hitl"
  - "platform-engineering"
  - "helm"
  - "kubernetes"
  - "event-driven"
draft: false
author: "Oren Sultan"
---

## TL;DR

An agentic SDLC platform runs AI agents as Kubernetes workloads — `factory-mission` codes and opens MRs, `factory-review` reads and self-heals them. The cluster is sealed: no developer SSH, no manual pod execution. When a human needs to pull the trigger — a selective launch, a re-run, an on-call response at 2am — the platform needs a credible dispatch interface. This post covers the infra we built to wire a chat slash command to a Kubernetes WorkflowTemplate: signing verification, layered filtering, credentialed gate steps, and a distributed dedup lock backed by the Kubernetes API server.

---

## The Mission Factory

The agentic SDLC platform treats software development as a production workflow. Issues move through stages — intent, planning, implementation, review — with AI agents executing each stage as Kubernetes pods.

`factory-mission` picks up an approved issue, reads the spec, writes code, and opens a merge request. `factory-review` reads the MR, classifies findings, and either approves or stamps `factory-stage:validation` to trigger a self-heal loop. Neither agent runs on a laptop. Both run on a managed Kubernetes cluster where ArgoCD owns deployments and Argo Workflows owns execution.

This is the right model for a production-grade agentic system. Agents run in reproducible, audited, resource-constrained environments. No "works on my machine" failures. No credential sprawl from developer laptops. The blast radius of any agent action is bounded by the pod's RBAC and network policies.

It also creates a constraint: when a human needs to initiate a mission, there's no obvious door into the cluster.

<!-- image_prompt:archive index=1 b64=RGlhZ3JhbSBvZiB0aGUgYWdlbnRpYyBTRExDIGZhY3RvcnkgbG9vcCDigJQgaXNzdWVzIGZsb3cgbGVmdCB0byByaWdodCB0aHJvdWdoIHN0YWdlczogaW50ZW50IGFwcHJvdmFsLCBmYWN0b3J5LW1pc3Npb24gKGNvZGUgKyBNUiksIGZhY3RvcnktcmV2aWV3IChjbGFzc2lmeSArIHNlbGYtaGVhbCksIG1lcmdlLiBLdWJlcm5ldGVzIGNsdXN0ZXIgYm91bmRhcnkgZHJhd24gYXJvdW5kIHRoZSBhZ2VudCBwb2RzLiBIdW1hbiBvcGVyYXRvciBzaG93biBvdXRzaWRlIHRoZSBib3VuZGFyeS4gRGFyay1ibHVlIHRlY2huaWNhbCBzdHlsZSwgY3lhbiBhY2NlbnQgZm9yIHRoZSBhZ2VudCBleGVjdXRpb24gcGF0aCwgMTY6OS4 -->
![Diagram of the agentic SDLC factory loop — issues flow left to right through stages: intent approval, factory-mission...](https://i.ibb.co/SDDtKbLy/img-1.jpg)

---

## The Infra Stack

The dispatch chain has seven components. Each has a job, an owner, and alternatives we considered.

### 1. Slash Command Registration

The `/adlc run <project>#<issue>` command is registered in the platform's chat app manifest at `adlc-argo-wf/slack/adlc-app.manifest.yaml`. It sends a signed POST to the platform's inbound endpoint on submit.

Signing is HMAC-SHA256 over the raw request body plus a timestamp. The chart fails template rendering if the signing secret is omitted — this is enforced, not documented.

**Alternative considered**: a custom REST endpoint with API key auth. Rejected: HMAC signing is the standard for chat webhooks, gives replay protection via the timestamp, and doesn't require provisioning a separate key pair per environment.

### 2. Credentials — Secrets Manager + ESO

The bot token and signing secret live in AWS Secrets Manager, pulled by ESO into one Kubernetes Secret every hour:

```yaml
slackExternalSecret:
  targetSecretName: argo-workflow-slack-bot-token
  secretPath: dev/adlc-agent
  secretProperty: SLACK_BOT_TOKEN
  extraData:
    - secretKey: signing-secret
      secretProperty: SLACK_SIGNING_SECRET
```

**Alternative considered**: secrets baked into Helm values or mounted from a manually-created Secret. Rejected: baked secrets rotate manually and leak into chart values history. ESO gives automated rotation with a single source of truth in AWS SM and no plaintext in the repo.

### 3. Argo EventSource — Inbound Receiver

The `adlc-mission-runner` Helm chart owns the EventSource (ADR-316-amendment-2). The platform's `argo-events` chart installs only the controller and EventBus. This split matters: a second definition of the same EventSource from a different chart creates an ArgoCD ownership conflict and double-webhook delivery.

The EventSource is `enabled: false` by default. Exactly one chart release per cluster enables it. This is enforced in the values schema.

**Alternative considered**: a custom webhook receiver service (Knative or a plain Deployment) forwarding to Argo. Rejected: introduces a new long-running service to operate, monitor, and secure. Argo Events already handles webhook ingestion, signing verification, and event routing — using it keeps the component count down.

### 4. The Sensor — Three-Layer Allowlist

By the time an event reaches a workflow, it has cleared three filters:

**Layer 1 — Channel allowlist.** `channelIds: [C123, ...]` — events from any other channel are dropped before the regex runs.

**Layer 2 — Command regex.** An anchored regex simultaneously filters the text and extracts the normalized `issue_ref`:

```
^[[:space:]]*run[[:space:]]+(https://gitlab.tikalk.dev/)?(g/a|g/b)(#|/-/issues/|/-/work_items/)([0-9]+)[[:space:]]*$
```

Group 2 is the project path. Group 4 is the issue IID. Free text — a question, a typo, an accidental trigger — matches nothing and dispatches nothing.

**Layer 3 — Label gate.** The issue must carry `agent-can-execute`. Checked inside the WorkflowTemplate (not at Sensor filter time) to avoid stale results on cached events.

**Alternative considered**: validating all three layers at Sensor filter time. Rejected: the label gate needs a live API call. Making the Sensor block on a GitLab API request during event processing adds latency and a failure mode — if the API is slow, the Sensor stalls. Pushing the gate into the WorkflowTemplate keeps the Sensor fast and stateless.

### 5. WorkflowTemplate — Gate Step + Mission

The WorkflowTemplate dispatch carries two parameters: `issue_ref` (normalized `path#iid`) and `run_id`. Two sequential steps:

**Gate step**: checks the issue's current label state, stamps `executing`, writes `pass` or `fail`. The `when` condition on the mission step reads that file.

**Mission step**: runs the full `factory-mission` workflow against the dispatched issue.

**Alternative considered**: a single-step WorkflowTemplate with no gate — just dispatch and trust the Sensor's label filter. Rejected: the Sensor filter uses a cached event snapshot. By the time the Workflow starts, the label may have been removed (human changed their mind, ops intervention). The gate step does a live check at execution time.

### 6. Deterministic Workflow Name — Dedup Guard

`generateName` meant two concurrent commands on the same issue spawned two pods. The fix is a deterministic name for chat-triggered runs:

```
metadata.name: adlc-mission-<workspace>-slack-<sha1(issue_ref)[:10]>
```

Same project + IID always hashes to the same name. The Kubernetes API server refuses a second `create` with `AlreadyExists`. The Sensor logs it and starts no pod. Race-free, no extra component, no new RBAC.

**Alternative considered**: a Redis lock or a ConfigMap-based state tracker. Rejected: both require an extra component (Redis) or a read-modify-write cycle with its own race window (ConfigMap). The Kubernetes API server is already strongly consistent — using it as the distributed lock is free and correct.

### 7. Deployment — Helm + ArgoCD

One `adlc-mission-runner` Helm release per cluster. The overlay enables the EventSource and ExternalSecret for the cluster that owns the inbound endpoint. Other clusters set both to false and reference the EventSource by name.

**Alternative considered**: raw manifests managed by hand. Rejected: the EventSource enable/disable pattern and the ESO configuration are per-environment values. Helm's values overlay model handles this cleanly with no extra files.

<!-- image_prompt:archive index=2 b64=U2V2ZW4tY29tcG9uZW50IGNoYWluIGRpYWdyYW0sIGxlZnQgdG8gcmlnaHQ6ICJTbGFzaCBjb21tYW5kIiDihpIgIkhNQUMgdmVyaWZ5IiDihpIgIkV2ZW50U291cmNlIiDihpIgIlNlbnNvciAoMyBsYXllcnMpIiDihpIgIldvcmtmbG93VGVtcGxhdGUiIOKGkiAiR2F0ZSBzdGVwIiDihpIgIk1pc3Npb24gcG9kIi4gQmVsb3cgZWFjaCBjb21wb25lbnQgc2hvdyB0aGUgYWx0ZXJuYXRpdmUgY29uc2lkZXJlZCB3aXRoIGFuIFggdGhyb3VnaCBpdC4gRGFyay1ibHVlIHRlY2huaWNhbCBzdHlsZSwgY3lhbiBhY2NlbnQgZm9yIHRoZSBjaG9zZW4gcGF0aCwgMTY6OS4 -->
![Seven-component chain diagram, left to right: "Slash command" → "HMAC verify" → "EventSource" → "Sensor (3 layers)" →...](https://i.ibb.co/zVFFFQzY/img-2.jpg)

---

## When Humans Need to Pull the Trigger

Full automation — issue approved, platform dispatches immediately — is the goal for steady-state operation. But there are three cases where automation stops and a human must decide:

**Re-runs.** The first mission ran against a stale spec or hit a transient API error. A tech lead wants a fresh pass, now, without waiting for the next cron cycle or touching the GitLab UI.

**Selective launch.** Not every approved issue should auto-dispatch. Some clients gate on a human review before the AI touches their codebase. The intent gate approved the ticket; the launch is still a human decision.

**On-call response.** An incident opened a ticket at 2am. Someone picks it up from their phone, issues one command, and the factory takes it from there. Spinning up a laptop, setting up local credentials, running a CLI against a remote cluster — not acceptable on-call UX.

Each of these is HITL in the original sense: the human makes the go/no-go call, the platform executes.

---

## Four Dispatch Options Evaluated

Before choosing an interface, we evaluated four architectures.

**Manual CLI — `factory-mission --issue <ref>` on a developer laptop.** Zero infrastructure. Works for a team of two where everyone has cluster access and a local dev environment. Breaks the moment non-engineers are in the loop, audit trails matter, or someone needs to dispatch from a phone.

**Cron polling — a CronWorkflow queries the API every N minutes.** Simple mental model, miserable operational reality. Up to N minutes of latency. API cost grows with backlog depth. Dedup needs a separate `argo list` query — out-of-band state that drifts. Ruled out fast.

**Tracker label webhook — a human stamps `agent-dispatch` on the issue; a Sensor fires.** Zero polling latency, explicit and auditable. The problem: requires a tracker session, one more context switch away from wherever the conversation is, not mobile-friendly. This path works well for *automated* lifecycle transitions (the companion post on the review-lane self-heal covers exactly this), but it adds friction for a human operator.

**Chat slash command — `/adlc run <project>#<issue>` in an approved channel.** Async, mobile-first, native to where the team already works. Signed with an HMAC secret so the cluster refuses forged payloads. Auditable in the channel. The team operates in Slack; we chose Slack. The pattern generalizes to any chat platform that supports slash commands and signed webhooks.

---

## Three Silent Bugs That Killed Every Command

The gate step had three independent bugs before it ran. Each was sufficient to silently kill every dispatch:

**1. Unresolved parameter at submit.** `git_secret_name` was declared in the gate template but never passed by the trigger. Argo rejected every Slack-path Workflow at submit with an unresolved parameter error — no pod, no log, nothing visible in the channel.

**2. `outputs.result` wired to a file path instead of stdout.** `outputs.result` IS the script's stdout in Argo. The gate always returned empty, `when` never saw `pass`, the mission never ran. The fix: `cat /tmp/gate/result` at the end of the script, or use an output parameter backed by the file.

**3. No tolerations on the gate pod.** The runner nodes are tainted. The pod stayed Pending indefinitely — again, silently. The fix is mechanical: copy `runnerDefaults.tolerations` to every step template.

Three bugs, each enough to swallow every command. All three found and fixed by Itai Or in `cbcda99`.

---

## What's Still Open

**Re-run policy.** A completed Workflow object holds the name. The next command on the same issue is refused by `AlreadyExists` until the object is deleted or expires. No `ttlStrategy` is set today. Without it, re-triggering a finished mission requires manual `argo delete`, which defeats the purpose of a one-command interface.

**Dispatch feedback.** The Sensor logs `AlreadyExists` but sends no reply to the channel. A duplicate command is silently ignored from the operator's perspective. A `response_url` reply ("already running — see #run-id") would close this gap.

---

## The HITL Spectrum

The platform now has two trigger paths:

- **Tracker label webhook**: used by the review-lane self-heal sensor. A lifecycle label stamped by the agent itself is the trigger. Zero human involvement — the platform responds to its own state machine.
- **Chat slash command**: used for operator-driven dispatch. A human makes the call, the platform executes.

Both follow the same event-driven pattern — EventSource → Sensor filter → WorkflowTemplate dispatch — but they serve different actors. Neither is a workaround. They're two distinct points on the HITL spectrum: one automated, one intentionally human-gated.

The infrastructure described here is what it takes to make a chat message a credible cluster trigger: signing verification, allowlisted channels, regex-validated payloads, credentialed gate steps, and a distributed lock backed by the Kubernetes API server. Skip any one of these and you either have a system that doesn't run, or one that runs too freely.

---

*Originally published at [orensultan.com](https://orensultan.com/posts/the-on-switch-for-your-ai-factory/).*

*Found this useful? Follow me on [LinkedIn](https://www.linkedin.com/in/orensultan/) or [Medium](https://medium.com/@orensultan) for more on platform engineering, cloud-native infrastructure, and agentic AI/DevOps.*

<!-- SOCIAL SNIPPETS -->

**LinkedIn** (~1400 chars):
Your AI factory runs `factory-mission` pods on a Kubernetes cluster nobody SSHes into. Good architecture. One problem: when a human needs to pull the trigger — a re-run, a selective launch, an on-call response at 2am — there's no obvious door.

We built one. Here's the full infra stack and the alternatives we rejected along the way:

→ HMAC-signed slash command (not API key auth — replay protection matters)
→ ESO-backed credentials (not baked secrets — no plaintext in chart history)
→ Argo EventSource over custom webhook service (less to operate)
→ 3-layer Sensor: channel → regex → label gate
→ Deterministic Workflow name as dedup lock (not Redis — k8s API server is already strongly consistent)
→ Gate step at execution time (not Sensor filter — cached events are stale)

Plus three silent bugs that killed every command before we found them, and what's still open.

Full post: [link]

#AgenticAI #PlatformEngineering #Kubernetes #ArgoWorkflows #HITL #DevOps #CloudNative

---

**X / Twitter** (280 chars):
AI factory on k8s, sealed cluster. Human needs to trigger a mission at 2am.

7 infra components, 3 silent bugs, 1 dedup guard backed by the k8s API server.

What we built + every alternative we rejected:

[link] #AgenticSDLC #Kubernetes

---

**Facebook** (~500 chars):
Interesting infra problem: how do you give humans a trigger for an AI factory running on a Kubernetes cluster with no direct access?

The answer involves event-driven dispatch, layered allowlists, and a distributed lock backed by the Kubernetes API server — plus the alternatives we considered and rejected for each component. Full write-up:

[link]

---

**Instagram** (~180 chars):
AI factory on Kubernetes, no SSH door. Built the on-switch: event-driven HITL dispatch with a 3-layer filter and k8s as the distributed lock. Full infra story — link in bio. #DevOps #AgenticAI #Kubernetes #PlatformEngineering #HITL #CloudNative

<!-- /SOCIAL SNIPPETS -->
