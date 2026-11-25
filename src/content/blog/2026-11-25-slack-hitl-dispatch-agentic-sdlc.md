---
title: "Dispatching the AI Factory from Slack — HITL Infrastructure for an Agentic SDLC"
meta_title: "Slack HITL for Agentic SDLC: Argo Events, Helm, and Real Infra"
description: "How we wired a Slack slash command to dispatch Kubernetes-native AI missions, the three bugs that swallowed it silently, and the dedup guard that prevents double-runs."
date: 2026-11-25T14:00:00+00:00
image: "/images/blog/2026/slack-hitl-dispatch/cover.png"
categories:
  - "Agentic AI"
  - "Platform Engineering"
tags:
  - "argo-events"
  - "argo-workflows"
  - "agentic-sdlc"
  - "slack"
  - "hitl"
  - "platform-engineering"
  - "helm"
  - "kubernetes"
  - "event-driven"
  - "devsecops"
draft: false
author: "Oren Sultan"
---

## TL;DR

We built a `/adlc run <project>#<issue>` Slack slash command that dispatches an AI mission pod on a Kubernetes cluster without anyone touching the cluster. Getting there required splitting the platform's Argo Events ownership, writing a three-layer allowlist in the Sensor, and fixing three silent bugs that swallowed every command on the cluster. This post walks through the full infrastructure stack, the HITL alternatives we considered, and the dedup guard that keeps two eager engineers from spawning two parallel missions on the same ticket.

## Why Human-in-the-Loop Dispatch at All?

An agentic SDLC pipeline automates spec → code → open MR. The intent gate approved the issue. The platform owns the cluster. Nobody needs to type anything — until they do.

There are real cases where a human hand on the trigger is the right call:

- **Re-runs.** The first mission ran against a stale spec. A tech lead wants a fresh pass, now.
- **Selective launch.** Not every approved issue should auto-dispatch. Some clients gate on a human review before the AI touches their codebase.
- **On-call response.** An incident opened an issue at 2am. Someone picks it up from their phone, types one command, and the factory takes it from there.

Each of these is HITL in the original sense: a human makes the go/no-go call, the machine executes. The question is what the trigger interface looks like. We evaluated four options before settling on Slack.

<!-- image_prompt:archive index=1 b64=Rm91ci1xdWFkcmFudCBjb21wYXJpc29uIGRpYWdyYW06ICJNYW51YWwgQ0xJIiAoZGV2ZWxvcGVyIG9uIGxhcHRvcCwgb25lLW9mZiwgbm8gY2x1c3RlciBhY2Nlc3MgbmVlZGVkKSwgIkNyb24gcG9sbGluZyIgKE4tbWluIGxhdGVuY3ksIEFQSSBjb3N0IGF0IHNjYWxlKSwgIkdpdExhYiBsYWJlbCB3ZWJob29rIiAobGF0ZW5jeS1mcmVlIGJ1dCBvcGVyYXRvciBtdXN0IHRvdWNoIHRoZSB0cmFja2VyKSwgIlNsYWNrIHNsYXNoIGNvbW1hbmQiIChhc3luYywgbW9iaWxlLWZyaWVuZGx5LCBhdWRpdGFibGUpLiBHcmVlbiBzdGFyIG9uIFNsYWNrLiBEYXJrLWJsdWUgb24gd2hpdGUsIGNsZWFuIHRlY2huaWNhbCBzdHlsZS4 -->
![Four-quadrant comparison diagram: "Manual CLI" (developer on laptop, one-off, no cluster access needed), "Cron pollin...](https://i.ibb.co/x8zgQbs4/img-1.jpg)

### Option 1 — Manual CLI

`factory-mission --issue <ref>` on a developer laptop. Zero infrastructure. Works fine for a team of two where everyone has cluster access and a local dev environment. Breaks down the moment you want non-engineers in the loop, want an audit trail, or want to dispatch from a phone at 2am.

### Option 2 — Cron Polling

A `CronWorkflow` queries the GitLab API every N minutes for approved, unstarted issues and dispatches them. Simple mental model; miserable operational reality. Up to N minutes of latency. API cost grows with backlog depth. Dedup needs a separate `argo list` query — out-of-band state that drifts. We ruled this out fast.

### Option 3 — GitLab Label Webhook

A human stamps `agent-dispatch` on an issue in GitLab; an Argo Events sensor picks it up and fires. Zero polling latency. The problem: it requires a GitLab session, it's not mobile-friendly, and stamping a label is one more context switch away from wherever the conversation already is. This path works well for *automated* lifecycle transitions (the companion post on the review-lane self-heal covers exactly this), but it's friction for a human operator.

### Option 4 (Chosen) — Slack Slash Command

`/adlc run tikalk/agentic-sdlc/my-service#42` in any approved channel. Async, mobile-first, native to where the team already works. Signed with an HMAC secret so the cluster refuses forged payloads. Auditable in the channel. Chosen.

---

## The Infrastructure Stack

This is not a single component. It's a chain of seven, each with its own ownership and failure mode.

<!-- image_prompt:archive index=1 role=cover id=slack-hitl-dispatch-cover b64=V2lkZSBhcmNoaXRlY3R1cmUgZGlhZ3JhbSBzaG93aW5nIHRoZSBmdWxsIGNoYWluOiBTbGFjayBBUEkgKmV4dGVybmFsKiDihpIgQVdTIFNlY3JldHMgTWFuYWdlciDihpIgRVNPIOKGkiBLdWJlcm5ldGVzIFNlY3JldCDihpIgU2xhY2sgRXZlbnRTb3VyY2UgKEFyZ28gRXZlbnRzKSDihpIgU2Vuc29yIChrOHMgZmlsdGVyKSDihpIgV29ya2Zsb3dUZW1wbGF0ZSBkaXNwYXRjaCAoZ2F0ZSArIG1pc3Npb24gcG9kKS4gTGFiZWxlZCBib3hlcywgQXJHb0NEIGRlcGxveW1lbnQgbGF5ZXIsIGRhcmsgYmx1ZSBiYWNrZ3JvdW5kLCBjeWFuIGFjY2VudCBsaW5lcywgMTY6OS4= -->

### 1. Slack API — The Slash Command

A Slack slash command is registered in the Slack app manifest at `adlc-argo-wf/slack/adlc-app.manifest.yaml`. The command sends a signed POST to the platform's inbound endpoint. The signing mechanism is HMAC-SHA256 over the raw request body plus a timestamp. Argo Events verifies this only when `signingSecret` is set in the EventSource — a missing signing key means the EventSource accepts forged payloads. The chart fails template rendering if the key is omitted. This is not optional.

### 2. AWS Secrets Manager + ESO

The bot token and the signing secret belong to a **dedicated ADLC Slack bot** — a purpose-built agent registered in the platform's Slack workspace with its own designated dispatch channel. They live in AWS SM and are pulled by ESO into one Kubernetes Secret every hour:

```yaml
slackExternalSecret:
  targetSecretName: argo-workflow-slack-bot-token
  secretPath: dev/adlc-agent          # dedicated bot, not a shared service
  secretProperty: SLACK_BOT_TOKEN
  extraData:
    - secretKey: signing-secret
      secretProperty: SLACK_SIGNING_SECRET
```

No credential baked into the chart. The bot is scoped to its own channel — commands from any other channel are dropped at the Sensor's `channelIds` filter before they reach the regex or the cluster. The secret rotates independently of the chart release.

### 3. Slack EventSource — The Inbound Receiver

The `adlc-mission-runner` Helm chart owns this resource (ADR-316-amendment-2). The platform's `argo-events` chart installs only the controller and the EventBus. This split matters: a second definition of the same EventSource from a different chart would create an ArgoCD ownership conflict and a double-webhook on the GitLab project side.

```yaml
# charts/adlc-mission-runner/templates/slack-eventsource.yaml
spec:
  slack:
    adlc-command:
      webhook:
        endpoint: /slack/adlc
        method: POST
        port: "12001"
      token:
        name: argo-workflow-slack-bot-token
        key: bot-token
      signingSecret:
        name: argo-workflow-slack-bot-token
        key: signing-secret
```

The EventSource is `enabled: false` by default. Exactly one chart release per cluster enables it. Other releases reference it by name in their Sensor dependencies. Without this discipline, two clusters fighting over the same Slack app endpoint corrupt each other's event streams.

### 4. The Sensor — Three-Layer Allowlist

The Sensor's `kind: slack` collector is the gatekeeper. By the time an event reaches a workflow, it has cleared three filters:

**Layer 1 — Channel allowlist.** `channelIds: [C123, ...]` — events from any other channel are dropped before the regex even runs.

**Layer 2 — Command regex.** The `REF_RE` anchored regex simultaneously filters the text and extracts the normalized `issue_ref`:

```
^[[:space:]]*run[[:space:]]+(https://gitlab.tikalk.dev/)?(g/a|g/b)(#|/-/issues/|/-/work_items/)([0-9]+)[[:space:]]*$
```

Group 2 is the project path. Group 4 is the issue IID. Free text — a question, an accidental command, a typo — matches nothing and dispatches nothing.

**Layer 3 — Label allowlist.** The issue must carry `agent-can-execute`. The Sensor reads this from the GitLab API in the gate step, not at event-filter time, to avoid stale label checks on cached events.

<!-- image_prompt:archive index=2 b64=VGhyZWUtbGF5ZXIgZnVubmVsIGRpYWdyYW06ICJDaGFubmVsIGZpbHRlciIgYXQgdG9wIChTbGFjayBjaGFubmVsSWRzKSwgIlJlZ2V4IGFsbG93bGlzdCIgaW4gbWlkZGxlIChhbmNob3JlZCBSRUZfUkUpLCAiTGFiZWwgZ2F0ZSIgYXQgYm90dG9tIChhZ2VudC1jYW4tZXhlY3V0ZSkuIEV2ZW50cyB0aGF0IGNsZWFyIGFsbCB0aHJlZSByZWFjaCB0aGUgV29ya2Zsb3dUZW1wbGF0ZS4gRXZlbnRzIHJlamVjdGVkIGF0IGVhY2ggbGF5ZXIgd2l0aCBhIHNtYWxsIFguIE1vbm9jaHJvbWUsIGNsZWFuIHRlY2huaWNhbCBzdHlsZS4 -->
![Three-layer funnel diagram: "Channel filter" at top (Slack channelIds), "Regex allowlist" in middle (anchored REF_RE)...](https://i.ibb.co/bjN822fj/img-2.jpg)

### 5. WorkflowTemplate — Gate Step + Mission

The WorkflowTemplate dispatch carries two parameters extracted from the regex: `issue_ref` (normalized `path#iid`) and `run_id` (the Slack `trigger_id`). It runs two sequential steps:

**Gate step** (Itai Or's work): checks the issue's current label state against the platform's allowlist, stamps `executing`, and writes `pass` or `fail` to an output file. The `when` condition on the mission step reads that file. This is where three bugs lived before the Slack path ever ran on a real cluster:

1. `git_secret_name` declared in the gate template but never passed by the trigger. Argo rejected every Slack-path Workflow at submit with an unresolved parameter error — no pod, no log, nothing visible.
2. `outputs.result` wired to a file path instead of stdout. `outputs.result` IS the script's stdout in Argo. The gate always returned empty, `when` never saw `pass`, the mission never ran.
3. No `tolerations` on the gate pod. The runner nodes are tainted. The pod stayed Pending indefinitely — again, silently.

Three bugs, each one enough to silently kill every command. All three found and fixed by Itai in `cbcda99`.

**Mission step**: runs the full `factory-mission` workflow against the dispatched issue, same as a GitLab-triggered run.

### 6. Deterministic Workflow Name — The Dedup Guard

`generateName` meant two concurrent `/adlc run` commands on the same issue spawned two pods. ADR-316-amendment adds a deterministic name for Slack triggers:

```
metadata.name: adlc-mission-<workspace>-slack-<sha1(issue_ref)[:10]>
```

Same project + IID always hashes to the same name. The Kubernetes API server refuses a second `create` with `AlreadyExists`. The Sensor logs it and creates no pod. Race-free, no extra component, no new RBAC. The API server IS the distributed lock.

GitLab collectors keep `generateName` — a GitLab redelivery of the same event is not the same semantics as a concurrent human command.

### 7. Deployment — Helm + ArgoCD

One `adlc-mission-runner` Helm release per cluster. The overlay enables `slackEventSource.enabled: true` and `slackExternalSecret.enabled: true` for the cluster that owns the inbound endpoint. Other clusters set both to false and reference the EventSource by name in their Sensor values. This keeps exactly one webhook registration alive, prevents duplicate event delivery, and makes the ownership explicit in git.

---

## What Three Months of Real Cluster Runs Taught Us

**Signing verification is not optional, but easy to miss.** Argo Events silently skips HMAC verification when `signingSecret` is absent. We made the chart fail on a missing `signingSecretKey`. If your EventSource renders without it, the first thing that connects to your endpoint controls your cluster.

**Toleration gaps kill pods silently.** A pod stuck in Pending is invisible in the Sensor logs. The fix is mechanical — copy `runnerDefaults.tolerations` to every step — but the failure mode looks exactly like a network issue, which costs hours.

**Outputs in Argo are stdout, not files.** This is documented, but it burns everyone once. `outputs.result` is the script's captured stdout. A script that writes to `/tmp/gate/result` and prints nothing returns an empty result. Add a `cat /tmp/gate/result` at the end, or use an output parameter backed by the file.

**Re-run policy is still open.** A completed Workflow object holds the name. The next `/adlc run` on the same issue is refused until the object is deleted or expires. No `ttlStrategy` is set today. This is a known gap: without it, re-triggering a finished mission requires manual `argo delete`, which defeats the purpose of the Slack interface.

---

## The Bigger Picture

The platform has two HITL trigger paths now:

- **GitLab label webhook**: used by the review-lane self-heal sensor. A lifecycle label stamped by the agent itself is the trigger. Zero human involvement — the platform responds to its own state machine.
- **Slack slash command**: used for operator-driven dispatch. A human makes the call, the platform executes.

Both follow the same event-driven pattern — EventSource → Sensor filter → WorkflowTemplate dispatch — but they serve different actors in the loop. Neither is a workaround. They're two distinct points on the HITL spectrum: one automated, one intentionally human-gated.

The infrastructure described here is what it takes to make a Slack message a credible cluster trigger: signing verification, allowlisted channels, regex-validated payloads, credentialed gate steps, and a distributed lock backed by the Kubernetes API server. Skip any one of these and you either have a system that doesn't run, or one that runs too freely.

---

*Originally published at [orensultan.com](https://orensultan.com/posts/slack-hitl-dispatch-agentic-sdlc/).*

*Found this useful? Follow me on [LinkedIn](https://www.linkedin.com/in/orensultan/) or [Medium](https://medium.com/@orensultan) for more on platform engineering, cloud-native infrastructure, and agentic AI/DevOps.*

<!-- SOCIAL SNIPPETS -->

**LinkedIn** (~1400 chars):
We wired a Slack slash command to dispatch AI missions on Kubernetes. The command looks like this: `/adlc run my-org/my-service#42`. What happens next is seven infrastructure components working in sequence — and three bugs that swallowed every command silently until Itai found them.

The stack:
→ Slack API → AWS Secrets Manager + ESO → Argo Events Slack EventSource → 3-layer Sensor allowlist → WorkflowTemplate gate step → mission pod → deterministic Workflow name as a distributed lock

The three silent killers on the cluster:
1. `git_secret_name` declared but never passed → Argo refused submit with no visible error
2. `outputs.result` wired to a file path instead of stdout → gate always returned empty, mission never ran
3. No tolerations on the gate pod → Pending indefinitely, nothing in the logs

And the dedup guard: `generateName` on a Slack trigger means two engineers typing the same command = two parallel missions. Fixed with `sha1(issue_ref)[:10]` as the Workflow name. The Kubernetes API server refuses the second create. No external lock, no extra RBAC.

Full post on the infra, the HITL alternatives we ruled out, and what's still open:

[link]

#AgenticAI #PlatformEngineering #Kubernetes #ArgoWorkflows #Slack #HITL #DevOps #CloudNative

---

**X / Twitter** (280 chars):
Wired a Slack slash command to dispatch AI missions on k8s. 7 infra components, 3 silent bugs, 1 dedup guard backed by the k8s API server.

What it took to make a Slack message a credible cluster trigger: [link]

#AgenticSDLC #Kubernetes #ArgoEvents

---

**Facebook** (~500 chars):
Interesting engineering challenge this week: how do you make a Slack slash command a credible trigger for a Kubernetes-native AI mission? Not just "receive a webhook" — the full stack: secrets, event filtering, gate steps, and a distributed lock that prevents duplicate runs.

Wrote it up with the full architecture, the HITL alternatives we considered, and the three bugs that made every command fail silently until they were found and fixed:

[link]

---

**Instagram** (~180 chars):
Slack slash command → AI mission on Kubernetes. The full infra story: 7 components, 3 silent bugs, 1 clever dedup guard. Link in bio. #DevOps #AgenticAI #Kubernetes #PlatformEngineering #ArgoEvents #Slack #HITL #CloudNative

<!-- /SOCIAL SNIPPETS -->
