---
title: "Closing the Loop: When Your AI Agent Gets a Code Review Rejection"
meta_title: "Agentic SDLC: Event-Driven Self-Healing for AI-Authored Code Reviews"
description: "How I wired Argo Events to close the agentic SDLC loop when human reviewers block agent-authored MRs — no human touch on the cluster."
date: 2026-11-25T12:00:00+00:00
image: "https://i.ibb.co/Dq45BPx/review-lane-self-heal-hero.jpg"
categories:
  - "Agentic AI"
  - "Platform Engineering"
tags:
  - "argo-events"
  - "argo-workflows"
  - "agentic-sdlc"
  - "platform-engineering"
  - "gitlab"
  - "kubernetes"
  - "code-review"
  - "event-driven"
draft: false
author: "Oren Sultan"
---

## TL;DR

An agentic SDLC pipeline automates spec → code → open MR. But when a human reviewer blocks the MR, someone still has to type the fix command — unless you close the loop. I built an event-driven sensor using Argo Events that watches a lifecycle label and auto-dispatches a self-healing workflow. Zero human touch on the cluster.

## The Gap Nobody Talks About

The pitch for agentic SDLC sounds clean: an AI agent reads a ticket, writes the code, opens an MR, and the platform takes it from there. We've been building exactly this at Tikal — `factory-mission` plans and codes, `factory-review` runs the review pass, the MR opens. So far so good.

Then a human reviewer reads the MR and posts "not able to merge — this needs rework."

On a developer laptop, that's a one-liner: `factory-review --pr 42 --self-heal`. The tool reads the reviewer's findings, converges the code, pushes a fix. Done.

On a cluster, there's nobody home. The MR sits in `factory-stage:validation` indefinitely. The developer doesn't notice until standup, or until a client asks why the ticket hasn't moved. The automation that was supposed to remove toil just moved the toil somewhere else.

This is the gap. Not "can an agent write code" — plenty of teams have that. The gap is *can the agent survive a code review rejection without a human on call*.

<!-- image_prompt:archive index=1 role=cover id=review-lane-self-heal-hero b64=U3BsaXQgaWxsdXN0cmF0aW9uIOKAlCBsZWZ0IHBhbmVsIHNob3dzIGEgZGV2ZWxvcGVyIGF0IGEgbGFwdG9wIHJ1bm5pbmcgImZhY3RvcnktcmV2aWV3IC0tc2VsZi1oZWFsIiBpbiBhIHRlcm1pbmFsLCByaWdodCBwYW5lbCBzaG93cyBhbiBlbXB0eSBLdWJlcm5ldGVzIGNsdXN0ZXIgY29udHJvbCBwbGFuZSB3aXRoIGEgc3RhbGxlZCBBcmdvIFdvcmtmbG93IGFuZCBhIGZsYXNoaW5nICJ2YWxpZGF0aW9uIiBsYWJlbC4gRGFyay1ibHVlIG9uIGxpZ2h0IGJhY2tncm91bmQsIGNsZWFuIHRlY2huaWNhbCBzdHlsZSwgMTY6OS4 -->


## Four Ways to Catch a Review Rejection (and Why Three Fail)

The first question is deceptively simple: *what event do you watch?* GitLab doesn't emit a native `changes_requested` webhook action — that UI state isn't reflected in the MR event stream the way you'd expect. Here's what I evaluated.

**Option 1 — Comment (note) webhook, filter on blocking phrases.**
Watch for `note` events where the body contains "not able to merge" or "changes requested". Sounds intuitive. In practice it's a maintenance nightmare: reviewers phrase things differently, the native GitLab "Request Changes" UI doesn't even emit a `note` event, and two comments from the same reviewer would spawn two parallel self-heal pods without an explicit dedup layer you'd still have to build.

**Option 2 — CronWorkflow polling.**
A cron job every N minutes queries the GitLab API for open MRs with the `factory-stage:validation` label and dispatches self-heal workflows for any not already running. Simple to reason about. Problems: up to N-minutes of latency before self-heal starts, API cost scales with backlog size, and dedup requires a separate `argo list` query — out-of-band state that now needs to be kept consistent.

**Option 3 — GitLab CI `workflow:rules`.**
Gate a CI job on `merge_request_event` and check reviewer approval state. The issue: GitLab CI jobs only fire on *push* events, not on review state changes alone. And factory skills run in Argo pods, not CI runners — dispatching into Argo from CI adds an extra hop and a credential surface for no benefit.

**Option 4 (chosen) — `factory-stage:validation` label webhook.**
`factory-review` already stamps this label on the MR at the end of its initial review pass when Important findings exist. It's a stable, unambiguous signal owned by the factory itself — not a human comment, not a timer, not an API query. The Argo EventSource watches the GitLab `merge_request` webhook, the Sensor filters on the label, the WorkflowTemplate fires.

The key insight: *when your system already manages a lifecycle label, that label is a better trigger than any free-text signal*. Free-text parsing and polling are traps. Design your state machine first; derive the events from it.

<!-- image_prompt:archive index=2 b64=RGVjaXNpb24gdHJlZSBjb21wYXJpbmcgZm91ciB0cmlnZ2VyIG9wdGlvbnM6ICJDb21tZW50IHdlYmhvb2sgKGZyYWdpbGUgdGV4dCBtYXRjaCkiLCAiQ3JvbldvcmtmbG93IChOLW1pbiBsYXRlbmN5KSIsICJHaXRMYWIgQ0kgKHdyb25nIHJ1bm5lciBtb2RlbCkiLCAiTGFiZWwgd2ViaG9vayAoY2hvc2VuLCBzdGFibGUgc2lnbmFsKSIg4oCUIFggbWFya3Mgb24gdGhlIGZpcnN0IHRocmVlLCBncmVlbiBjaGVja21hcmsgb24gdGhlIGZvdXJ0aC4gQ2xlYW4gdGVjaG5pY2FsIGRpYWdyYW0sIG1vbm9jaHJvbWUgd2l0aCBncmVlbiBhY2NlbnQgb24gdGhlIGNob3NlbiBwYXRoLg -->
![Decision tree comparing four trigger options: "Comment webhook (fragile text match)", "CronWorkflow (N-min latency)",...](https://i.ibb.co/2YjyvKkR/img-2.jpg)

## The Argo Events Wiring

The pattern follows the established ADR-316 path exactly: GitLab EventSource → Sensor → WorkflowTemplate dispatch. What's new is the filter.

The Sensor uses a gjson path to match the label inside the MR webhook payload:

```yaml
filters:
  data:
    - path: body.object_attributes.state
      type: string
      value: ["opened"]
    - path: body.object_attributes.action
      type: string
      value: ["update"]
    - path: body.object_attributes.draft
      type: bool
      value: ["false"]
    # gjson array element match: first label object where title matches
    - path: "body.object_attributes.labels.#(title=\"factory-stage:validation\")"
      type: string
      comparator: "!="
      value: [""]
```

One thing to get right: `body.labels` at the payload root is the project-level label map, not the MR's labels. The MR labels live at `body.object_attributes.labels` as an array of objects. The gjson path `#(title="factory-stage:validation")` matches the first element where `title` equals our lifecycle label. If present, the filter passes; if not — a non-factory MR update, or a stage transition we don't care about — the event is discarded with no pod started.

The trigger dispatches a WorkflowTemplate that runs `factory-review --pr <iid> --self-heal`. The MR IID comes straight from `body.object_attributes.iid` in the payload.

## The Dedup Problem

A reviewer might post two comments. Ops might remove and re-stamp the label during a drill. Each label stamp is a new webhook delivery — and by default, each would start a new self-heal pod.

The solution is the same pattern applied to the Slack dispatch path: **deterministic Workflow names**. Instead of `generateName`, the Sensor renders:

```
metadata.name: "adlc-review-<namespace>-mr-<sha1(project_path + iid)[:10]>"
```

Same project + MR IID always hashes to the same name. The Kubernetes API server refuses a second `create` with `AlreadyExists` — atomic, race-free, no extra component, no new RBAC. The Sensor logs the rejection and continues. If the previous self-heal Workflow completed, the name is free and a fresh run starts cleanly.

This pattern generalises beyond this use case: *any time you need "exactly one running workflow per entity", derive the name from the entity key*. The API server becomes your distributed lock.

## Brief Restoration: Context the Pod Needs

There's a subtlety that matters. `factory-review --self-heal` needs `brief.md` — the original spec document — to run its Converge step correctly. On a laptop it's already on disk. A cluster pod boots with nothing but the container image.

The solution: portable run-ref snapshots (ADR-475). `brief.md` travels as a git ref (`refs/factory-runs/<run_id>`). The self-heal WorkflowTemplate includes a restore step before invoking `factory-review`:

1. Read `run_id` from the distributed lease marker on the issue tracker thread.
2. `git fetch origin refs/factory-runs/<run_id>`
3. `adlc-cli workflow restore <run_id>` — `brief.md` lands on the pod's disk.

Then `factory-review --self-heal` runs with full context, same as it would on a laptop.

One open question being worked out: should the Sensor pre-fetch `run_id` from the tracker API and pass it as a parameter (simpler pod, more Sensor complexity), or should the pod resolve it internally from the lease marker (simpler Sensor, more pod responsibilities)? Both are viable; the trade-off is where the tracker credential lives.

<!-- image_prompt:archive index=3 b64=U2VxdWVuY2UgZGlhZ3JhbSBzaG93aW5nOiBHaXRMYWIgTVIgbGFiZWwgd2ViaG9vayDihpIgQXJnbyBFdmVudFNvdXJjZSDihpIgU2Vuc29yIGZpbHRlciDihpIgV29ya2Zsb3dUZW1wbGF0ZSBkaXNwYXRjaCDihpIgcG9kIHJlc3RvcmUgc3RlcCAoZmV0Y2ggYnJpZWYubWQgZnJvbSBnaXQgcmVmKSDihpIgZmFjdG9yeS1yZXZpZXcgLS1zZWxmLWhlYWwuIENsZWFuIHN3aW1sYW5lIGRpYWdyYW0sIDMtNCBhY3RvcnMsIG1vbm9jaHJvbWUu -->
![Sequence diagram showing: GitLab MR label webhook → Argo EventSource → Sensor filter → WorkflowTemplate dispatch → po...](https://i.ibb.co/SwF1cJYJ/img-3.jpg)

## A Note on Credentials

One detail worth calling out: the review lane got its own dedicated GitLab group access token — `write_repository` only, Developer role — separate from the mission lane's Maintainer token that carries `api`, `k8s_proxy`, registry-write, and runner creation rights.

In an agentic pipeline, every lane should carry the minimum credential for its job. A self-heal pod that pushes a fix branch doesn't need API access. When review and mission share a token, one misconfigured WorkflowTemplate away from a review pod doing something it shouldn't. Credential separation in agentic pipelines isn't security theater — it's operational hygiene that prevents the blast radius from expanding when something goes wrong.

## What's Not Solved Yet

Multi-repo issues. When a single issue spawns MRs in two repositories — which happens in our workspace — the current design has three compounding failure modes:

- **Lease collision**: both self-heal pods fight over the same issue-keyed `factory-review:lease`. One wins, the other halts with no automatic retry.
- **Split comment buses**: each pod can only read its own MR thread. The converge step for repo A can declare DONE while repo B's MR still has unresolved findings.
- **No cross-MR aggregation**: the issue-level completion comment covers whichever repo ran last.

This is explicitly deferred. The right order is: get the single-MR path solid, then tackle cross-repo coordination (per-MR lease keys, cross-repo token access, aggregated completion signals) as a follow-on ADR. Naming it here so the design scope is clear.

## Infrastructure Self-Healing Meets SDLC Self-Healing

Platforms like NeoX can drain a faulty GPU replica and restart it. Policy-as-code detects rogue inference workloads and quarantines them before they starve the queue. That's the infrastructure layer doing its job.

But when the AI agent running on that GPU opens a Merge Request and a human reviewer says "not able to merge" — that's not an infrastructure failure. It's a code-review failure, and no amount of GPU self-healing touches it. The SDLC layer is a blind spot.

A stalled MR in `factory-stage:validation` is the SDLC equivalent of a rogue workload: it holds a slot in the pipeline, blocks downstream work, and silently degrades throughput until someone manually intervenes. The difference is that most teams automate the compute layer and leave the code pipeline entirely manual.

The pattern I described in this post — event-driven label-based triggers, deterministic idempotency keys, Kubernetes-native dispatch — is the same pattern that powers infrastructure self-healing. It's portable. The question is whether you apply it only to your servers, or all the way up to your code review loop.

<!-- image_prompt:archive index=1 b64=U3BsaXQtbGF5ZXIgaWxsdXN0cmF0aW9uIOKAlCBib3R0b20gbGF5ZXIgc2hvd3MgYSBLdWJlcm5ldGVzIEdQVSBjbHVzdGVyIHdpdGggZXZlbnQtZHJpdmVuIHNlbGYtaGVhbGluZyAoZHJhaW4gbm9kZSwgcmVzdGFydCBwb2QgYXJyb3dzKSwgdG9wIGxheWVyIHNob3dzIGEgR2l0TGFiIG1lcmdlIHJlcXVlc3Qgd2l0aCBhbiBBcmdvIHdvcmtmbG93IGRpc3BhdGNoaW5nIGEgc2VsZi1oZWFsIHBvZC4gQm90aCBsYXllcnMgc2hhcmUgdGhlIHNhbWUgZXZlbnQtZHJpdmVuIHBhdHRlcm4sIHZpc3VhbGl6ZWQgYXMgbWF0Y2hpbmcgZmxvdyBhcnJvd3MgY29ubmVjdGluZyB0aGVtLiBDbGVhbiB0ZWNobmljYWwgZGlhZ3JhbSwgZGFyayBibHVlIGJhY2tncm91bmQsIGN5YW4gYWNjZW50IGxpbmVzLCAxNjo5Lg -->
![Split-layer illustration — bottom layer shows a Kubernetes GPU cluster with event-driven self-healing (drain node, re...](https://i.ibb.co/zWZmrLVM/img-1.jpg)

## The Takeaway

Make your state transitions explicit and label-stamped. When the agent itself stamps the lifecycle label as part of its normal completion flow, you get a durable, unambiguous webhook trigger with zero extra tooling. Free-text parsing breaks in the hands of real humans. Polling trades simplicity for latency and API cost.

The review loop is now closed on the cluster. When a human reviewer says "not able to merge", the factory responds — automatically, on its own clock.

---

*Originally published at [orensultan.com](https://orensultan.com/posts/closing-the-loop-review-lane-self-heal/).*

*Found this useful? Follow me on [LinkedIn](https://www.linkedin.com/in/orensultan/) or [Medium](https://medium.com/@orensultan) for more on platform engineering, cloud-native infrastructure, and agentic AI/DevOps.*

<!-- SOCIAL SNIPPETS -->

**LinkedIn** (~1350 chars):
When your AI agent opens a Merge Request and a human reviewer says "not able to merge" — what happens next?

On a laptop: `factory-review --self-heal`. Done in minutes.
On a Kubernetes cluster at 2am: nobody's home. The MR sits. The automation that was supposed to remove toil just moved it.

I built the missing piece: an Argo Events sensor that watches a lifecycle label and auto-dispatches the self-healing workflow — no human touch on the cluster.

Three approaches I tried before landing on the right one:
→ Comment webhook + text parsing: fragile. Reviewers don't all write the same words.
→ CronWorkflow polling: adds N-minute latency and API cost at scale.
→ GitLab CI workflow:rules: fires only on push events, wrong runner model entirely.

What worked: using a label already stamped by the agent itself as the trigger. When you own the state machine, derive the trigger from it — not from free-text signals you don't control.

New post walking through the full design — the Argo Events wiring, deterministic Workflow names for dedup, brief restoration from portable git refs, and what's still open (multi-repo coordination is a harder problem):

[link]

#AgenticAI #PlatformEngineering #ArgoWorkflows #Kubernetes #DevOps #SDLC

---

**X / Twitter** (280 chars):
Your AI agent opens an MR. Reviewer says "not able to merge." On a cluster, nobody's home to run the fix.

Built an Argo Events sensor that closes that loop — label trigger, deterministic Workflow names for dedup, brief.md from portable git refs.

Write-up: [link] #AgenticSDLC #Kubernetes

---

**Facebook** (~520 chars):
Interesting engineering problem this week: how do you make an AI agent autonomously respond to code review rejections on a Kubernetes cluster — where no human is present to type the fix command?

The answer involved Argo Events, a lifecycle label used as a webhook trigger, and a neat trick with deterministic Workflow names to prevent duplicate self-heal runs. Wrote it up with the full design and the alternatives I ruled out first:

[link]

---

**Instagram** (~190 chars):
AI agents that write code are cool. AI agents that also fix their own code review rejections without anyone home — that's the gap I closed this week. Full write-up on closing the agentic SDLC loop. Link in bio. #DevOps #AgenticAI #Kubernetes #PlatformEngineering #ArgoWorkflows #CloudNative #GitLab #SDLC

<!-- /SOCIAL SNIPPETS -->
