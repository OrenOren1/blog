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

An agentic SDLC platform runs AI missions on a Kubernetes cluster that no developer SSHes into. When a human needs to pull the trigger — a re-run, a selective launch, an on-call response at 2am — the platform needs a credible dispatch interface. This post covers the infra problem, the four options we evaluated, and what it takes to make a chat message a production-grade cluster trigger: signing verification, layered filtering, credentialed gate steps, and a distributed dedup lock backed by the Kubernetes API server.

## The Infrastructure Context

The agentic SDLC platform runs `factory-mission` pods on a Kubernetes cluster. The cluster is managed by the platform team. Developers don't have direct cluster access — they don't need it. ArgoCD owns deployments, Argo Workflows owns execution, and the platform owns the trigger path.

This is the right architecture. It keeps the blast radius contained, makes the audit trail clean, and prevents "just SSH in and run it manually" from becoming the operational default.

It also creates a problem: when a human needs to initiate something, there's no obvious door.

<!-- image_prompt:archive index=1 b64=QXJjaGl0ZWN0dXJlIGRpYWdyYW0gc2hvd2luZyB0aGUgYWdlbnRpYyBTRExDIGNsdXN0ZXIgYm91bmRhcnkg4oCUIEt1YmVybmV0ZXMgY2x1c3RlciBvbiB0aGUgcmlnaHQgKEFyZ29DRCwgQXJnbyBXb3JrZmxvd3MsIG1pc3Npb24gcG9kcyksIGh1bWFuIG9wZXJhdG9ycyBvbiB0aGUgbGVmdCB3aXRoIG5vIGRpcmVjdCBTU0ggcGF0aCwgYSBsYWJlbGVkICJ0cmlnZ2VyIGludGVyZmFjZSIgYXMgdGhlIG9ubHkgaW5ib3VuZCBjaGFubmVsLiBEYXJrLWJsdWUgdGVjaG5pY2FsIHN0eWxlLCBjeWFuIGFjY2VudCBmb3IgdGhlIHRyaWdnZXIgcGF0aCwgMTY6OS4 -->
![Architecture diagram showing the agentic SDLC cluster boundary — Kubernetes cluster on the right (ArgoCD, Argo Workfl...](https://i.ibb.co/cS3W8Ynz/img-1.jpg)

## When Humans Need to Pull the Trigger

Full automation — issue approved, platform dispatches immediately — is the goal for steady-state operation. But there are real cases where a human hand on the trigger is the right call:

**Re-runs.** The first mission ran against a stale spec or hit a transient API error. A tech lead wants a fresh pass, now, without waiting for the next cron cycle or touching the GitLab UI.

**Selective launch.** Not every approved issue should auto-dispatch. Some clients gate on a human review before the AI touches their codebase. The intent gate approved the ticket; the launch is still a human decision.

**On-call response.** An incident opened a ticket at 2am. Someone picks it up from their phone, issues one command, and the factory takes it from there. The alternative — spinning up a laptop, setting up local credentials, running a CLI against a remote cluster — is not acceptable on-call UX.

Each of these is HITL in the original sense: the human makes the go/no-go call, the platform executes. The question is what the trigger interface looks like.

## Four Options Considered

Before choosing an interface, we evaluated four dispatch architectures.

<!-- image_prompt:archive index=2 b64=Rm91ci1xdWFkcmFudCBjb21wYXJpc29uIGRpYWdyYW06ICJNYW51YWwgQ0xJIiAoZGV2IGxhcHRvcCwgbm8gYXVkaXQgdHJhaWwsIHJlcXVpcmVzIGNsdXN0ZXIgY3JlZHMpLCAiQ3JvbiBwb2xsaW5nIiAoTi1taW4gbGF0ZW5jeSwgQVBJIGNvc3QgYXQgc2NhbGUpLCAiVHJhY2tlciBsYWJlbCB3ZWJob29rIiAoemVybyBsYXRlbmN5LCByZXF1aXJlcyB0cmFja2VyIHNlc3Npb24sIG5vdCBtb2JpbGUtZnJpZW5kbHkpLCAiQ2hhdCBzbGFzaCBjb21tYW5kIiAoYXN5bmMsIG1vYmlsZS1maXJzdCwgYXVkaXRhYmxlLCBjaG9zZW4pLiBHcmVlbiBjaGVja21hcmsgb24gdGhlIGZvdXJ0aC4gQ2xlYW4gdGVjaG5pY2FsIGRpYWdyYW0sIG1vbm9jaHJvbWUgd2l0aCBncmVlbiBhY2NlbnQgb24gY2hvc2VuIHBhdGgu -->
![Four-quadrant comparison diagram: "Manual CLI" (dev laptop, no audit trail, requires cluster creds), "Cron polling" (...](https://i.ibb.co/6RFhHfcb/img-2.jpg)

**Manual CLI — `factory-mission --issue <ref>` on a developer laptop.** Zero infrastructure. Works for a team of two where everyone has cluster access and a local dev environment. Breaks the moment non-engineers are in the loop, audit trails matter, or someone needs to dispatch from a phone.

**Cron polling — a CronWorkflow queries the API every N minutes.** Simple mental model, miserable operational reality. Up to N minutes of latency. API cost grows with backlog depth. Dedup needs a separate `argo list` query — out-of-band state that drifts. Ruled out fast.

**Tracker label webhook — a human stamps `agent-dispatch` on the issue; a Sensor fires.** Zero polling latency, and the trigger is explicit and auditable in the tracker. The problem: it requires a tracker session, it's one more context switch away from wherever the conversation is, and it's not mobile-friendly. This path works well for *automated* lifecycle transitions (the companion post on the review-lane self-heal covers exactly this), but it adds friction for a human operator.

**Chat slash command — `/adlc run <project>#<issue>` in an approved channel.** Async, mobile-first, native to where the team already works. Signed with an HMAC secret so the cluster refuses forged payloads. Auditable in the channel. The team operates in Slack; we chose Slack. The pattern generalizes to any chat platform that supports slash commands and signed webhooks.

---

## The Infrastructure Stack

A chat slash command reaching a Kubernetes pod is not a single component. It's a chain of seven, each with its own ownership and failure mode.

### 1. The Slash Command Registration

The command is registered in the platform's chat app manifest at `adlc-argo-wf/slack/adlc-app.manifest.yaml`. It sends a signed POST to the platform's inbound endpoint. Signing is HMAC-SHA256 over the raw request body plus a timestamp — standard for Slack, implementable for any equivalent platform.

The chart fails template rendering if the signing secret is omitted. This is enforced, not documented. If your EventSource renders without a signing key, the first thing that connects to your endpoint controls your cluster.

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

No credential baked into the chart. The bot is scoped to its designated dispatch channel — commands from any other channel are dropped at the Sensor before they reach the regex or the cluster.

### 3. Argo EventSource — Inbound Receiver

The `adlc-mission-runner` Helm chart owns the EventSource (ADR-316-amendment-2). The platform's `argo-events` chart installs only the controller and the EventBus. This split matters: a second definition of the same EventSource from a different chart creates an ArgoCD ownership conflict and double-webhook delivery.

The EventSource is `enabled: false` by default. Exactly one chart release per cluster enables it. This is not a convention — it's enforced in the values schema.

### 4. The Sensor — Three-Layer Allowlist

By the time an event reaches a workflow, it has cleared three filters:

**Layer 1 — Channel allowlist.** `channelIds: [C123, ...]` — events from any other channel are dropped before the regex runs.

**Layer 2 — Command regex.** An anchored regex simultaneously filters the text and extracts the normalized `issue_ref`:

```
^[[:space:]]*run[[:space:]]+(https://gitlab.tikalk.dev/)?(g/a|g/b)(#|/-/issues/|/-/work_items/)([0-9]+)[[:space:]]*$
```

Group 2 is the project path. Group 4 is the issue IID. Free text — a question, a typo, an accidental trigger — matches nothing and dispatches nothing.

**Layer 3 — Label gate.** The issue must carry `agent-can-execute`. This is checked by the gate step inside the WorkflowTemplate, not at Sensor filter time, to avoid stale checks on cached events.

### 5. WorkflowTemplate — Gate Step + Mission

The WorkflowTemplate dispatch carries two parameters: `issue_ref` (normalized `path#iid`) and `run_id`. It runs two sequential steps:

**Gate step** (Itai Or): checks the issue's current label state, stamps `executing`, writes `pass` or `fail`. The `when` condition on the mission step reads that file.

**Mission step**: runs the full `factory-mission` workflow against the dispatched issue.

Three bugs lived in this step before the dispatch path ever ran on a real cluster (see below).

### 6. Deterministic Workflow Name — Dedup Guard

`generateName` meant two concurrent commands on the same issue spawned two pods. The fix is a deterministic name for chat-triggered runs:

```
metadata.name: adlc-mission-<workspace>-slack-<sha1(issue_ref)[:10]>
```

Same project + IID always hashes to the same name. The Kubernetes API server refuses a second `create` with `AlreadyExists`. The Sensor logs it and starts no pod. Race-free, no extra component, no new RBAC. The API server IS the distributed lock.

GitLab collectors keep `generateName` — a redelivery of the same event is not the same semantics as a concurrent human command.

### 7. Deployment — Helm + ArgoCD

One `adlc-mission-runner` Helm release per cluster. The overlay enables the EventSource and ExternalSecret for the cluster that owns the inbound endpoint. Other clusters set both to false and reference the EventSource by name. Exactly one webhook registration is alive at any time.

---

## Three Silent Bugs That Killed Every Command

The gate step had three independent bugs before it ran. Each was sufficient to silently kill every dispatch:

**1. Unresolved parameter at submit.** `git_secret_name` was declared in the gate template but never passed by the trigger. Argo rejected every Slack-path Workflow at submit with an unresolved parameter error — no pod, no log, nothing visible in the channel.

**2. `outputs.result` wired to a file path instead of stdout.** `outputs.result` IS the script's stdout in Argo. The gate always returned empty, `when` never saw `pass`, the mission never ran. The fix: `cat /tmp/gate/result` at the end of the script, or use an output parameter backed by the file.

**3. No tolerations on the gate pod.** The runner nodes are tainted. The pod stayed Pending indefinitely — again, silently. The fix is mechanical: copy `runnerDefaults.tolerations` to every step template.

Three bugs, each enough to swallow every command. All three found and fixed by Itai Or in `cbcda99`.

---

## What's Still Open

**Re-run policy.** A completed Workflow object holds the name. The next command on the same issue is refused by `AlreadyExists` until the object is deleted or expires. No `ttlStrategy` is set today. Without it, re-triggering a finished mission requires manual `argo delete`, which defeats the purpose of a one-command interface. This is the most visible gap in the current design.

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
Your AI agents run on a Kubernetes cluster nobody SSHes into. Good architecture. One problem: when a human needs to pull the trigger — a re-run, a selective launch, an on-call response at 2am — there's no obvious door.

We built one. Here's what it took:

→ Signing verification on the inbound webhook (the cluster refuses unsigned payloads — this is not optional)
→ 3-layer Sensor allowlist: channel → regex → label gate
→ Deterministic Workflow names for dedup: `sha1(issue_ref)[:10]` as the name, Kubernetes API server as the distributed lock
→ Gate step + mission step: human approval checked at runtime, not at filter time

And three silent bugs that killed every command before we found them — each one enough to swallow a dispatch with no log, no pod, nothing visible.

Full post on the infra, the four dispatch options we considered, and what's still open:

[link]

#AgenticAI #PlatformEngineering #Kubernetes #ArgoWorkflows #HITL #DevOps #CloudNative

---

**X / Twitter** (280 chars):
AI agents on k8s, cluster nobody SSHes into. When a human needs to pull the trigger, what's the interface?

4 options, 7 infra components, 3 silent bugs, 1 dedup guard backed by the k8s API server.

[link] #AgenticSDLC #Kubernetes

---

**Facebook** (~500 chars):
Interesting infra problem: how do you give humans a trigger for an AI factory running on a Kubernetes cluster with no direct access?

The answer involves event-driven dispatch, layered allowlists, and a distributed lock backed by the Kubernetes API server. Plus three bugs that killed every command silently until they were found. Full write-up:

[link]

---

**Instagram** (~180 chars):
AI factory on Kubernetes, no SSH door. Built the on-switch: event-driven HITL dispatch with a 3-layer filter and k8s as the distributed lock. Full infra story — link in bio. #DevOps #AgenticAI #Kubernetes #PlatformEngineering #HITL #CloudNative

<!-- /SOCIAL SNIPPETS -->
