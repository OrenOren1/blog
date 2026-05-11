---
title: "Adapting a Helm Chart Suite for OpenShift: Patterns from a Real Deployment"
meta_title: "Helm Charts for OpenShift: 6 Proven Patterns"
description: "Six battle-tested patterns for adapting Helm chart suites to OpenShift — platform value layers, restricted-v2 helpers, runtime CA injection, and Kyverno Job policies."
date: 2026-05-06T00:00:00+00:00
image: "https://i.ibb.co/prMR0y4t/Gemini-Generated-Image-kh3sz2kh3sz2kh3s.png"
categories:
  - "Platform Engineering"
  - "DevOps"
tags:
  - "openshift"
  - "helm"
  - "kubernetes"
  - "kyverno"
  - "argo-cd"
  - "platform-engineering"
  - "gitops"
  - "external-secrets"
  - "security"
draft: false
featured: true
author: "Oren Sultan"
---

## TL;DR

Moving a Helm chart suite from vanilla Kubernetes to OpenShift is not a lift-and-shift. This post documents six patterns applied to an on-premises agent platform with 10+ services: a platform value layer that isolates OpenShift overrides, restricted-v2 security context helpers in a shared library chart, runtime CA injection via init containers, Kyverno ClusterPolicies as cluster-level enforcement (including for batch Jobs and CronJobs), and a 4-layer Argo CD value composition strategy. The goal: one portable chart, multiple platforms, no Dockerfile forks.

---

## "It Works on kind" — Until OpenShift

I've heard "it works on kind" explain away more production incidents than I care to count. You spend weeks building a Helm chart suite, everything passes local tests, and then you drop it into an OpenShift 4.x cluster and half your pods are stuck in `CreateContainerConfigError`. Security Context Constraints reject your init containers. Your CA trust assumptions break because the cluster uses an internal PKI. Your batch Jobs don't meet the namespace's Pod Security Admission policy.

OpenShift is not just Kubernetes with a different logo. It's Kubernetes with strong opinions — and those opinions are enforced at the API server level, not just at review time.

The good news: if you design your Helm charts with OpenShift in mind from the start, you end up with a cleaner architecture that also runs better on vanilla Kubernetes. This post walks through six patterns I applied to a multi-service Python agent platform — deployed as a Helm umbrella chart on OpenShift ROSA — when hardening it for production.

---

## Pattern 1: The Platform Value Layer

The worst thing you can do when adapting a chart for OpenShift is scatter `{{- if eq .Values.global.platform "openshift" }}` conditionals across 20 templates. You end up with templates nobody dares touch and overlays that are impossible to reason about.

The better approach: introduce a single platform gate in your base values and isolate every OpenShift-specific override in a dedicated value file.

```yaml
# deployment/values.yaml — base, platform-agnostic
global:
  K8S_PLATFORM: kubernetes
```

Apply value files in a strict order — later files override earlier ones:

```
deployment/values.yaml                         # base defaults
deployment/openshift/values.yaml               # sets K8S_PLATFORM, SCC values, StorageClass
deployment/openshift/vendor/values.yaml        # vendor overlay: registry, org-specific tunables
deployment/openshift/vendor/staging/values.yaml  # environment: replica counts, secret refs
```

In Helm templates, branch on the platform gate through a single helper so the condition stays consistent:

```yaml
{{- define "libchart.isOpenShift" -}}
{{- eq .Values.global.K8S_PLATFORM "openshift" -}}
{{- end }}
```

The `openshift/values.yaml` file becomes a first-class artifact — reviewable in isolation, easy to diff between environments. When a new OpenShift-specific requirement appears, you change one file.

---

## Pattern 2: restricted-v2 Security Contexts via Library Chart Helpers

OpenShift's `restricted-v2` Pod Security Admission profile enforces rules that most public Helm charts ignore:

- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `seccompProfile.type: RuntimeDefault`
- `capabilities.drop: [ALL]`
- UIDs must fall within the namespace's `openshift.io/sa.scc.uid-range` annotation

The UID requirement is where most charts silently break. OpenShift allocates a UID range per namespace (something like `1000900000/10000`). If you hard-code `runAsUser: 1000`, it works on plain Kubernetes and fails on OpenShift because 1000 is almost certainly outside the allocated range.

The pattern that works: make UID configurable and default to omitting it on OpenShift — letting the platform assign it — while still setting `runAsNonRoot: true`.

Define two helpers in your library chart (`libchart`):

```yaml
{{- define "libchart.podSecurityContext" -}}
runAsNonRoot: true
{{- if .Values.global.openshiftRunAsUser }}
runAsUser: {{ .Values.global.openshiftRunAsUser }}
runAsGroup: {{ .Values.global.openshiftRunAsGroup }}
fsGroup: {{ .Values.global.openshiftRunAsUser }}
{{- end }}
seccompProfile:
  type: RuntimeDefault
{{- end }}


{{- define "libchart.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
seccompProfile:
  type: RuntimeDefault
{{- end }}
```

Every `Deployment`, `Job`, and `CronJob` template calls these helpers. One change propagates everywhere. Do not repeat this block in individual subchart templates — that is how drift happens, and drift is how you get a 3am incident when a batch Job fails its SCC check on its first scheduled run.

---

## Pattern 3: Runtime CA Injection — Never Bake the Cert Into the Image

Enterprise OpenShift clusters typically run behind an internal PKI. Your services need to trust the customer's root CA to reach internal Git servers, artifact registries, or internal APIs. The tempting fix — `COPY` the cert into the Dockerfile — is also the wrong one. It means one image per customer, a rebuild every time the cert rotates, and a security conversation you do not want to have.

The correct pattern: inject the CA at pod startup via a Helm-controlled init container.

```yaml
# libchart/_deployment.yaml (and _jobPodTemplate.yaml for batch parity)
{{- if eq .Values.global.CUSTOM_ROOT_CERTIFICATES "true" }}
initContainers:
  - name: merge-ca-bundle
    image: {{ .Values.global.initImage }}
    securityContext: {{- include "libchart.containerSecurityContext" . | nindent 6 }}
    command:
      - sh
      - -c
      - |
        cat /etc/ssl/certs/ca-certificates.crt /certs/custom-ssl.crt \
          > /opt/app/certs/ca-bundle.pem
        chmod 644 /opt/app/certs/ca-bundle.pem
    volumeMounts:
      - name: custom-ca-secret
        mountPath: /certs
        readOnly: true
      - name: ca-bundle
        mountPath: /opt/app/certs
volumes:
  - name: custom-ca-secret
    secret:
      secretName: {{ .Values.global.customCa.secretName | default "certs-secret" }}
  - name: ca-bundle
    emptyDir: {}
{{- end }}
```

The main container receives three environment variables pointing at the merged PEM:

```yaml
env:
  - name: SSL_CERT_FILE
    value: /opt/app/certs/ca-bundle.pem
  - name: REQUESTS_CA_BUNDLE
    value: /opt/app/certs/ca-bundle.pem
  - name: CURL_CA_BUNDLE
    value: /opt/app/certs/ca-bundle.pem
```

How the `Secret` gets into the cluster is controlled by a single enum — `global.customCa.secretMode`:

- **`manual`**: The chart creates the `Secret` from a PEM value passed at deploy time, or an operator pre-creates it.
- **`eso`**: The chart renders an `ExternalSecret`; the External Secrets Operator syncs the cert from Vault or AWS Secrets Manager.

Both paths converge on the same Secret shape: name `certs-secret`, key `custom-ssl.crt`. The init container never needs to know which path provisioned it. When `CUSTOM_ROOT_CERTIFICATES` is `"false"`, none of this renders — no init container, no extra volumes, no env overrides. The workload uses the image's system CA bundle and nothing else.

---

## Pattern 4: Umbrella Chart + Library Chart as the Leverage Point

When you have 10+ services that all need identical OpenShift treatment, the umbrella chart + library chart combination is the architecture that makes this maintainable.

The umbrella chart declares all services as Helm dependencies. The library chart defines shared helpers for security contexts, CA injection, image references, and pod templates. When OpenShift adds a new requirement — say, adding `seccompProfile` to all containers — you update one helper and every workload picks it up on the next `helm dependency update`.

Optional platform-specific components use Helm's `condition:` field:

```yaml
# Chart.yaml
dependencies:
  - name: kyverno
    version: "3.2.x"
    repository: "https://kyverno.github.io/kyverno"
    condition: kyverno.enabled
  - name: external-secrets
    version: "0.9.x"
    repository: "https://charts.external-secrets.io"
    condition: external-secrets.enabled
```

`kyverno.enabled: false` in your base values means vanilla Kubernetes deployments never see it. `kyverno.enabled: true` in your OpenShift overlay and it installs as part of the same Argo CD sync. One chart, multiple platforms.

---

## Pattern 5: Kyverno as Cluster-Level Policy Enforcement

Helm templates enforce shape at render time. Kyverno enforces policy at admission time — meaning even a `kubectl apply` that bypasses your GitOps flow gets caught. For OpenShift environments where restricted-v2 compliance is non-negotiable, this distinction matters.

Kyverno's own pods require a privileged PSA namespace because its webhook processes all pod admissions. Set this via subchart values:

```yaml
# values.yaml (openshift layer)
kyverno:
  enabled: true
  replicaCount: 3
  admissionController:
    podSecurityContext:
      runAsNonRoot: true
```

You also need to label Kyverno's namespace to allow its own pods past the PSA gate:

```yaml
# infra: namespace manifest for Kyverno
apiVersion: v1
kind: Namespace
metadata:
  name: kyverno
  labels:
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/warn: privileged
```

### Validating Policy: Enforce Non-Root on Jobs and CronJobs

This policy rejects any Job or CronJob that doesn't explicitly set restricted-v2-compliant security requirements at admission time. It catches chart bugs before they reach running pods — including Jobs submitted outside your GitOps flow.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-job-restricted-v2
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: check-job-containers-non-root
      match:
        any:
          - resources:
              kinds:
                - Job
                - CronJob
      validate:
        message: >
          Jobs and CronJobs must set runAsNonRoot: true on the pod
          and allowPrivilegeEscalation: false + capabilities.drop ALL
          on every container.
        pattern:
          spec:
            template:
              spec:
                securityContext:
                  runAsNonRoot: true
                containers:
                  - securityContext:
                      allowPrivilegeEscalation: false
                      capabilities:
                        drop:
                          - ALL
```

### Mutating Policy: Auto-Inject Security Context Into Jobs

For incremental migrations where you can't fix every chart at once, a mutating policy provides a safety net. The `+(key):` syntax adds the field only if it is absent — it won't overwrite values that are already set.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-job-security-context
spec:
  rules:
    - name: inject-pod-security-context
      match:
        any:
          - resources:
              kinds:
                - Job
            namespaceSelector:
              matchLabels:
                app.kubernetes.io/managed-by: opa-platform
      mutate:
        patchStrategicMerge:
          spec:
            template:
              spec:
                +(securityContext):
                  runAsNonRoot: true
                  seccompProfile:
                    type: RuntimeDefault
                containers:
                  - (name): "*"
                    +(securityContext):
                      allowPrivilegeEscalation: false
                      capabilities:
                        drop:
                          - ALL
```

### Validating Policy: Enforce Internal Image Registry for Jobs

On OpenShift, pulling from the public Docker Hub or an unapproved registry is often blocked at the network level — but that gives you a cryptic `ImagePullBackOff` rather than a clear error. A Kyverno policy surfaces the violation at admission time with a useful message:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-approved-registry-for-jobs
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-job-image-registry
      match:
        any:
          - resources:
              kinds:
                - Job
                - CronJob
      validate:
        message: >
          All Job and CronJob images must be pulled from the
          approved internal registry (registry.company.io).
        pattern:
          spec:
            template:
              spec:
                =(initContainers):
                  - image: "registry.company.io/*"
                containers:
                  - image: "registry.company.io/*"
```

> **Trade-off worth calling out**: Mutating policies are convenient but can mask chart bugs. In production, prefer validating policies with `Enforce` and use mutation only as a migration bridge or for third-party charts you don't control.

---

## Pattern 6: GitOps Value Composition with Argo CD

The four value layers need to be applied in the correct order by Argo CD. In the `Application` spec:

```yaml
source:
  helm:
    valueFiles:
      - deployment/values.yaml
      - deployment/openshift/values.yaml
      - deployment/openshift/vendor/values.yaml
      - deployment/openshift/vendor/staging/values.yaml
```

Order is everything. The environment file is last and wins. If you get this wrong, your OpenShift security context values may be silently ignored.

Two things to watch in practice:

**Sync order matters for bootstrapping.** Image pull secrets must exist before any workload pod is scheduled. If ESO-produced secrets are in the same sync wave as your workloads, you get transient failures that are annoying to diagnose. Use Argo CD sync waves on infrastructure resources:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "-1"  # infra resources sync before workloads
```

**Deprecated overlays are a trap.** If your repo has an old overlay directory that was the original source of truth, mark it deprecated explicitly and stop referencing it in your `Application`. Two teams reading different value files is a reliable path to a production incident.

---

## What I'd Do Differently

Three things I'd bake in from day one on any new chart suite:

**Add the `K8S_PLATFORM` gate before writing any templates.** Retrofitting it across 20 templates when you already have a production deployment is a week of careful work. One afternoon at the start saves that.

**Apply library chart security context helpers to Jobs and CronJobs immediately.** Batch workloads are easy to forget. They also tend to run on irregular schedules, so SCC failures surface at the worst possible time — during a scheduled run overnight.

**Install Kyverno early and run policies in `Audit` mode first.** Audit mode logs violations without blocking. You'll discover chart issues before you flip to `Enforce` and start rejecting deployments. The two-week audit window also gives you a clear picture of what's coming from outside your GitOps flow.

---

## Conclusion

OpenShift's security model is strict by design. That strictness has a cost: you cannot drop a standard Kubernetes Helm chart in and expect it to work. But the patterns that make charts OpenShift-compatible — platform value layers, library chart helpers, runtime injection, Kyverno enforcement — also make them better charts on any platform.

The umbrella + library chart approach means you absorb OpenShift requirements once and propagate them everywhere. Kyverno means you enforce them at admission time, not just at render time. And the value layer system means you can support multiple platforms and environments from a single chart without forking Dockerfiles or duplicating templates.

The investment is upfront. The payoff is a chart suite you can hand to another team, deploy to a new environment, or update without fear.

---

## Further Reading

- [Kyverno ClusterPolicy documentation](https://kyverno.io/docs/kyverno-policies/)
- [OpenShift Pod Security Admission](https://docs.openshift.com/container-platform/4.15/authentication/understanding-and-managing-pod-security-admission.html)
- [Helm library charts](https://helm.sh/docs/topics/library_charts/)
- [External Secrets Operator](https://external-secrets.io/)
- [Argo CD sync waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)

---

*Originally published at [orensultan.com](https://orensultan.com/posts/helm-charts-openshift-patterns/).*

*Found this useful? Follow me on [LinkedIn](https://www.linkedin.com/in/oren-sultan/) or [Medium](https://medium.com/@orensultan) for more on platform engineering, cloud-native infrastructure, and agentic AI/DevOps.*