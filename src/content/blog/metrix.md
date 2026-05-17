---
title: "Templating the Matrix"
meta_title: "Templating the Matrix: Argo CD ApplicationSets & Helm at Scale"
description: "GitOps at scale with Argo CD ApplicationSets, Helm umbrella charts, and library charts—so platform teams can onboard products and environments without every dev becoming a Helm expert."
date: 2023-01-08T00:00:00+00:00
image: "https://miro.medium.com/v2/resize:fit:1400/format:webp/1*PA0Q_2ZKWllIFqVCZ_46VQ.png"
categories:
  - "Platform Engineering"
  - "GitOps"
tags:
  - "gitops"
  - "argo-cd"
  - "helm"
  - "kubernetes"
source: "gitops"
draft: false
author: "Oren Sultan"
---
## Warming up

To Developers, DevOps seems like “black magic” that no one wants to be a part of.
I generally agree. Who wants to take part in this automatic headache?
Then a big question arises - as to how much I want to enrich the knowledge of the developers in ops tools — should I give the “keys to the spaceship” ?
On one hand, it optimizes and directs the DevOps work to architecture and future tasks, but at the same time leaves a large margin for human error and bugs on the dev team. Guess who in the end will still be called to the flag when error occur.

![Developer team planning platform requirements](https://miro.medium.com/v2/resize:fit:1276/format:webp/1*gSkwvyHZJ__rsFAsuKVw8g.jpeg)

These are some of the day-to-day requirements of a development team:

*   Deploy a new service easily.
*   Add an environment variable to all services in product x in environment y.
*   Change the db name in all services in the environment.
*   Drift a product from a DEV environment to a QA environment and keep the same QA resource allocation.
*   Change the default resource allocation of all services in the organization.

When you have a stack of 5–10 services these can be simple tasks that a developer can handle with a bit of brainstorming. But what happens in a large development team, high-scale of services (100+) divided into products, and in a large amount of environments?
We will have to plan a little more in depth for each requirement of the development team in order to both maintain the micro capabilities of each service separately and also to carry out broad changes in the environment.
That’s why I chose the helm library + helm umbrella stack deployed using ArgoCD Application set.

![GitOps continuous delivery workflow](https://miro.medium.com/v2/resize:fit:892/format:webp/1*ufjWxi0ehFWuobwjsYfmVA.png)

## GitOps and Argo CD

GitOps is a software engineering practice that uses a Git repository as its single source of truth. Teams commit declarative configurations into Git, and these configurations are used to create environments needed for the continuous delivery process.
One of the common tools applying GitOps method is ArgoCD , a Kubernetes-native continuous deployment (CD) tool implemented as kubernetes controller , responsible for continuously running and monitoring applications by comparing the live state to the desired state stored in the target git repository.
Enables developers to manage application configuration by code in a git repository and deploy it automatically or manually to kubernetes.
Provides automatic sync of application state to the current version of declarative configuration.
Managed by web interface and command-line interface.

## Sneak peek

![Multi-environment GitOps repository layout](https://miro.medium.com/v2/resize:fit:734/format:webp/1*xDgbaWE5TiVtvCJQ6fZhew.jpeg)

In the original project, I implemented the solution on several environments. Each branch in the repo represents the state of each ArgoCD in the dedicated cluster. The state is a declarative configuration of both infrastructure and products implemented by Helm charts and ArgoCD applications. For the purpose of this article, I will present the repository structure of one of the environments:

```
├── Chart.lock
├── Chart.yaml
├── README.md
├── apps
│   └── cms
│       └── application-env.properties
├── charts
│   ├── Tikal-main-chart-0.0.5.tgz
│   └── auth-service-1.0.0.tgz
├── envs
│   ├── auto3
│   │   └── services-values.yaml
│   ├── qa-euw1
│   │   └── services-values.yaml
│   └── qa-usw2
│       └── services-values.yaml
├── services
│   ├── auth-service
│   │   ├── Chart.yaml
│   │   ├── templates
│   │   │   ├── deployment.yaml
│   │   │   ├── hpa.yaml
│   │   │   ├── ingress.yaml
│   │   │   ├── service.yaml
│   │   │   └── serviceAccount.yaml
│   │   └── values.yaml
│   └── report-service
│       ├── Chart.yaml
│       ├── templates
│       │   ├── deployment.yaml
│       │   ├── hpa.yaml
│       │   ├── ingress.yaml
│       │   ├── service.yaml
│       │   └── serviceAccount.yaml
│       └── values.yaml
└── templates
    └── cm.yaml
```

As said before, An ArgoCD application resource is a Kubernetes resource that defines an application managed by ArgoCD. This resource specifies the details of the application, including its source repository, the path to the application’s manifest files, and any additional configuration settings.

The project tree is composed of two main directories: **ArgoCD** directory contains files related to ArgoCD, such as application definitions and Kustomization file used to define a [Kustomization](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) in kubernetes.

**Helm** contains the chart of the infrastructure and the ApplictionSet chart We will discuss it in detail soon.

Together, these two directories form the structure of the project tree.
Tikal.yaml file in the main application file , it runs the “App-of-app” application .

```
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: app-of-apps
  namespace: argocd
  labels:
    group: auto3
spec:
  project: tikal
  source:
    repoURL: git@github.com:tikal/tikal_helm_deploy
    path: argocd/app-of-apps
    targetRevision: auto3
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
    automated:
      prune: true
      selfHeal: true
```

Another folder I want to discuss shortly is the [Terraform](https://github.com/OrenOren1/argocd-applicationset-helm/tree/main/terraform) folder.
My project was installed by terraform basically but it can deployed easily with simple helm installation of [ArgoCD](https://github.com/argoproj/argo-helm/tree/main/charts/argo-cd).
In the next attachment we can see the relevant helm values necessary to apply our ArgoCD system :

```
controller:
  # If changing the number of replicas you must pass the number as ARGOCD_CONTROLLER_REPLICAS as an environment variable
  replicas: 2
  enableStatefulSet: true
  env:
    - name: "ARGOCD_CONTROLLER_REPLICAS"
      value: "2"
resources:
  limits:
    cpu: 4M
    memory: 4Gi
  requests:
    cpu: 3M
    memory: 3Gi
# Redis
redis:
  enabled: false
redis-ha:
  enabled: true
  # Check the redis-ha chart for more properties
  resources:
    requests:
      memory: 200Mi
      cpu: 100m
    limits:
      memory: 700Mi
  exporter:
    enabled: false
server:
  serviceAccount:
    # -- Create server service account
    create: true
    # -- Server service account name
    name: argocd-server
    # -- Annotations applied to created service account
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::607827849963:role/argocd-get-oci-access-sultan
    # -- Labels applied to created service account
    labels: {}
    # -- Automount API credentials for the Service Account
    automountServiceAccountToken: true
  replicas: 2
  configEnabled: true
  config:
     repositories: |-
       - name: ${repo_name}
         type: git
         url: ${repo_url}
         sshPrivateKeySecret:
           key: sshPrivateKey
           name: github-repo-secret
       - name: sonatype
         type: helm
         url: https://sonatype.github.io/helm3-charts/
       - name: eks
         type: helm
         url: https://aws.github.io/eks-charts
       - name: autoscaler
         type: helm
         url: https://kubernetes.github.io/autoscaler
       - name: external-secrets
         type: helm
         url: https://external-secrets.github.io/kubernetes-external-secrets/
       - name: bitnami
         type: helm
         url: https://charts.bitnami.com/bitnami
  ## Projects
  ## reference: https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/
  additionalProjects:
  - name: tikal
    namespace: argocd
    description: tikal Project
    sourceRepos:
    - "*"
    destinations:
    - namespace: "*"
      server: https://kubernetes.default.svc
    clusterResourceWhitelist:
    - group: '*'
      kind: '*'
    namespaceResourceWhitelist:
    - group: '*'
      kind: '*'
  additionalApplications:
    - name: app-of-apps
      namespace: argocd
      labels:
        group: ${env_name}
      project: tikal
      source:
        repoURL: git@github.com:tikal/tikal_helm_deploy
        path: argocd/app-of-apps
        targetRevision: ${env_name}
      destination:
        server: https://kubernetes.default.svc
        namespace: argocd
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
        automated:
          prune: true
          selfHeal: true
repoServer:
    ## Repo server service account
    ## If create is set to true, make sure to uncomment the name and update the rbac section below
    serviceAccount:
      # -- Create repo server service account
      create: true
      # -- Repo server service account name
      name: "argocd-repo-server"
      # -- Annotations applied to created service account
      annotations:
        eks.amazonaws.com/role-arn: arn:aws:iam::607827849963:role/argocd-get-oci-access-sultan
      labels: { }
      # -- Automount API credentials for the Service Account
      automountServiceAccountToken: true
    # -- Additional containers to be added to the repo server pod
    extraContainers: [ ]
    # -- Repo server rbac rules
    rbac:
     - apiGroups:
       - argoproj.io
       resources:
       - applications
       verbs:
       - get
       - list
       - watch
```

I have selected this configuration for our system because it separates the code responsible for deployment from the charts of our applications. This separation provides a clear separation between the build process and the deployment process.

Each environment has its own branch in our version control system, which contains all of the configurations and settings specific to that environment. This allows us to manage and track the differences between our development, staging, and production environments.
In addition we maintain a separate repository for each chart of our products. This helps us keep track of the chronology of each product which helps us maintain a clear separation of concerns and makes it easier to manage and update our codebase.

## ApplicationSet Helm chart

In our stack, each product is built from several services that are represented in an umbrella chart . To deploy these products with Argo, we use an application manifest for each service. Our application manifests for each service share the same variables and values, in this case we would like to use the Applicationset resource.

This technique can be used to deploy multiple products by converting the Applicationset manifest into an Applicationset helm chart and use it serially by injecting all the products names from our **env-values.yaml**

```
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: tikal-products
  namespace: argocd
spec:
  generators:
    - matrix:
        generators:
          - list:
              elements:
                {{- range $name,$value := .Values.apps }}
                {{- if $value.enabled }}
                - name: {{ default  $name $value.name |replace "_" "-"}}
                  version: {{ $value.version }}
                  repo_url: {{ $value.repo_url }}
                  team: {{ $value.team }}
                {{- end }}
                {{- end }}
          - list:
              elements:
              - propertiesEnvName: {{ .Values.cluster_name }}
                domain: {{ .Values.domain_suffix }}
                region: {{ .Values.cluster_region }}
                cluster_name: {{ .Values.cluster_name }}
                aws_account_id: '{{int .Values.aws_account_id }}'
                db_url: {{ .Values.db_url }}
                db_name: {{ .Values.db_name }}
                db_admin: {{ .Values.db_admin }}
                kafka_broker: {{ .Values.kafka_broker }}
                external_domain: {{ .Values.external_domain }}
                internal_domain: {{ .Values.internal_domain }}
                redis_uri: {{ .Values.redis_uri }}
                vpc_id: '{{ .Values.cluster_vpc_id }}'
  template:
    metadata:
      name: 'tikal-{{"{{"}}name{{"}}"}}'
    spec:
      project: tikal
      source:
        path: ./
        repoURL:  '{{"{{"}}repo_url{{"}}"}}'
        targetRevision: '{{"{{"}}version{{"}}"}}'
        helm:
          valueFiles:
            - 'envs/{{ .Values.cluster_name}}/services-values.yaml'
          values: |
            global:
              propertiesEnvName: {{"{{"}}propertiesEnvName{{"}}"}}
              domain: {{"{{"}}domain{{"}}"}}
              region: {{"{{"}}region{{"}}"}}
              aws_account_id: {{"{{"}}aws_account_id{{"}}"}}
              cluster_name: {{"{{"}}cluster_name{{"}}"}}
              external_domain: {{"{{"}}external_domain{{"}}"}}
              internal_domain: {{"{{"}}internal_domain{{"}}"}}
              db_url: {{"{{"}}db_url{{"}}"}}
              db_name: {{"{{"}}db_name{{"}}"}}
              kafka_broker: {{"{{"}}kafka_broker{{"}}"}}
              redis_uri: {{"{{"}}redis_uri{{"}}"}}
              vpc_id: {{"{{"}}vpc_id{{"}}"}}
              SpotinstRestrictScaleDown:
                enabled: false
              labels:
                team: {{"{{"}}team{{"}}"}}
                product: {{"{{"}}name{{"}}"}}
              env:
                INFLUXDB_HOST: {{"{{"}}propertiesEnvName{{"}}"}}-influxdb.tikal.com
                LOG4J_FORMAT_MSG_NO_LOOKUPS: 'true'
                ROOKOUT_ROOK_TAGS: {{"{{"}}propertiesEnvName{{"}}"}}
                SPRING_PROFILES_ACTIVE: {{"{{"}}propertiesEnvName{{"}}"}}
                CPTLS_ENV: {{"{{"}}propertiesEnvName{{"}}"}}
                DATABASE_ADMIN: {{"{{"}}db_admin{{"}}"}}
      destination:
        server: https://kubernetes.default.svc
        namespace: ns
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
        automated:
          prune: true
          selfHeal: true
```
As we can see  Applicationset resource get all its product names and environment values ​​from the values file ​​and generate an application resource  in a matrix manner.
_env-valuse.yaml_
```
eks_user_access:
  - orenext
  - user1
  - user2
aws_account_id: account122345
cluster_address: https://kubernetes.default.svc
cluster_name: auto3
cluster_region: eu-west-1
external_domain: example.com
internal_domain: example.is
domain_suffix: example.com
db_url: db-auto3.example.is
db_name: postgres
db_admin: tikalmarke1
kafka_broker: tp7.c9
redis_uri: redis://tikalredis-master.argocd
vpc_id: 'vpc-07b7ad41f697'
certificate: e86fffb2-255725f6fe6f
cluster_vpc_id: vpc-07b7adc04f697
nodegroup_iam_role: auto3-eks20220419093757900800000009
alb_ingress_role_arn: arn:aws:iam::account122345:role/alb-ingress-auto3
external_dns_role_arn: arn:aws:iam::account122345:role/external-dns_role_auto3
external_secrets_role_arn: arn:aws:iam::account122345:role/external-secrets_role_auto3
cluster_url: https://argocd-auto3.example.is
namespace_pod_quota_count: 200
aws_cluster_autoscaler:
  enabled: false # Only enable when spot.io ocean is off
logzio:
  enabled: false
kube2iam:
  enabled: true
datadog:
  enabled: false
  api_key: 952b3deffce6afa2d389cfcacc4
  apm:
    enabled: false
argocd:
  targetRevision: auto3
  project: tikal
  repoURL: git@github.com:tikal/tikal_helm_deploy.git
  ingress:
    cert_arn: arn:aws:acm:eu-west-1:607827849963:certificate/12f49709-d977-41c4-b
    domain: example.is
  sso:
    enabled: false
    clientid: e8cb602fb5b5904dd
    clientsecret: n6wAj9BZ
    tenant: 6cc0f90cac58fd
apps:
  product1:
    repo_url: git@github.com:tikal/product1-helm.git
    enabled: true
    version: edge
    team: dev-team1
  product2:
    repo_url: git@github.com:tikal/product2-helm.git
    enabled: true
    version: edge
    team: dev-team2
  product3:
    repo_url: git@github.com:tikal/product3-helm.git
    enabled: true
    version: edge
    team: dev-team3
```

**env-values.yaml** file determines which products will be utilized in the environment, specifies all related values for the environment, and is also used by the application to generate the necessary manifests for each service with the appropriate values.
Helm template tool can assist verifying the output of application set.

```
helm template ./ -f ../env-values.yaml >test.yaml
```

output:

```
# Source: products-set/templates/applicationset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: tikal-products
  namespace: argocd
spec:
  generators:
    - matrix:
        generators:
          - list:
              elements:
                - name: product1
                  version: edge
                  repo_url: git@github.com:tikal/product1-helm.git
                  team: dev-team1
                - name: product2
                  version: edge
                  repo_url: git@github.com:tikal/product2-helm.git
                  team: dev-team2
                - name: product3
                  version: edge
                  repo_url: git@github.com:tikal/product3-helm.git
                  team: dev-team3
          - list:
              elements:
              - propertiesEnvName: auto3
                domain: example.com
                region: eu-west-1
                cluster_name: auto3
                aws_account_id: '0'
                db_url: db-auto3.example.is
                db_name: postgres
                db_admin: tikalmarke1
                kafka_broker: tp7.c9
                external_domain: example.com
                internal_domain: example.is
                redis_uri: redis://tikalredis-master.argocd
                vpc_id: 'vpc-07b7adc04f697'
  template:
    metadata:
      name: 'tikal-{{name}}'
    spec:
      project: tikal
      source:
        path: ./
        repoURL:  '{{repo_url}}'
        targetRevision: '{{version}}'
        helm:
          values: |
            global:
              propertiesEnvName: {{propertiesEnvName}}
              domain: {{domain}}
              region: {{region}}
              aws_account_id: {{aws_account_id}}
              cluster_name: {{cluster_name}}
              external_domain: {{external_domain}}
              internal_domain: {{internal_domain}}
              db_url: {{db_url}}
              db_name: {{db_name}}
              kafka_broker: {{kafka_broker}}
              redis_uri: {{redis_uri}}
              vpc_id: {{vpc_id}}
              SpotinstRestrictScaleDown:
                enabled: false
              labels:
                team: {{team}}
                product: {{name}}
              env:
                INFLUXDB_HOST: {{propertiesEnvName}}-influxdb.tikal.com
                LOG4J_FORMAT_MSG_NO_LOOKUPS: 'true'
                ROOKOUT_ROOK_TAGS: {{propertiesEnvName}}
                SPRING_PROFILES_ACTIVE: {{propertiesEnvName}}
                CPTLS_ENV: {{propertiesEnvName}}
                DATABASE_ADMIN: {{db_admin}}
      destination:
        server: https://kubernetes.default.svc
        namespace: ns
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
        automated:
          prune: true
          selfHeal: true
```

**Test.yaml** specifies the details of three different products (product1, product2, and product3) and the values that should be used to deploy them.

The template section specifies the details of how the products should be deployed, including the source repository and target revision for each product and the values that should be passed to the Helm chart for each product.

## Getting there

![Argo CD and ApplicationSet deployment overview](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*cC36UxXUOKyBN1WtdwdPrA.png)

Thus far, we’ve become familiar with Argo and Applicationset resource, which greatly simplify the process of managing deployments in our cluster. Our ultimate goal, however, is to find a streamlined and automated method for deploying our products. This is where Helm charts come into play. By using Helm charts to define the desired state of our products in the cluster, we can leverage Argo CD to listen for changes in the Git repository containing these charts and automatically deploy those changes to our specified target environment.

### Chart Umbrella and Chart-Library

As an efficiency hunter, one of my main objectives in this project was to find a way for every team member to easily add or remove new services to our product, or even add entirely new products, without needing a lot of expertise in Helm or Kubernetes. Thankfully, the use of Helm Library charts has been a game-changer in this regard, making it much simpler for me and my teammates to make changes and additions to our products without getting bogged down in the details of Helm or Kubernetes.

In Helm, a Library chart is a collection of templates and helper functions that can be shared and reused among multiple charts. It is a way to organize and manage common templates and functions in a central location, making it easier to maintain and update your charts.

One of the main advantages of using Library charts is that they allow you to avoid duplication of code. Instead of copying and pasting the same templates and functions into multiple charts, you can define them once in a Library chart and then include them as needed in other charts. This makes it easier to maintain your charts and reduces the risk of errors, as you only need to update the templates and functions in one place.

Library charts came to our advantage in this project. They make it easier to roll out changes across multiple charts. If you need to update a template or function that is used by multiple charts, you can simply make the change in the Library chart and all the charts that depend on it will automatically use the updated version. This can save a lot of time and effort, especially if you have a large number of charts that share common templates and functions.

Our deployment process holds multiple products, each of which is made up of a group of micro-services called sun-charts. These sun-charts are located in the _/services_ folder, and each product has its own umbrella chart that is composed of dependencies on these sun-charts.
The umbrella chart also includes a common config-map that is mounted to the file system of all of the sun-charts.

![Helm umbrella chart with library chart dependencies](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*2T9AJVDvzNIW0Oe_jZrkxg.png)

This approach allows you to organize your micro-services into logical groups and manage them as a single unit, while still allowing for flexibility and modularity. By using an umbrella chart to define the dependencies for each product, you can easily add or remove micro-services as needed and ensure that all of the necessary resources are properly configured. Additionally, the common config-map can be used to share configuration data across all of the micro-services within a product, making it easier to maintain and update your applications.

One of this umbrella chart repository would be presented like :

```
├── Chart.lock
├── Chart.yaml
├── README.md
├── apps
│   └── cms
│       └── application-env.properties
├── charts
│   ├── Tikal-main-chart-0.0.5.tgz
│   └── auth-service-1.0.0.tgz
├── envs
│   ├── auto3
│   │   └── services-values.yaml
│   ├── qa-euw1
│   │   └── services-values.yaml
│   └── qa-usw2
│       └── services-values.yaml
├── services
│   ├── auth-service
│   │   ├── Chart.yaml
│   │   ├── templates
│   │   │   ├── deployment.yaml
│   │   │   ├── hpa.yaml
│   │   │   ├── ingress.yaml
│   │   │   ├── service.yaml
│   │   │   └── serviceAccount.yaml
│   │   └── values.yaml
│   └── report-service
│       ├── Chart.yaml
│       ├── templates
│       │   ├── deployment.yaml
│       │   ├── hpa.yaml
│       │   ├── ingress.yaml
│       │   ├── service.yaml
│       │   └── serviceAccount.yaml
│       └── values.yaml
└── templates
    └── cm.yaml
```

### Chart.yaml:

![Chart.yaml](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*tL9ZrBy8fgCk9vI9rvODXQ.png)

This is the Chart.yaml file for a Helm chart. It contains metadata about the chart, including its name, description, type, version and app version.

The chart has three dependencies. The first dependency, _tikal-main-chart_, is our Chart library which holds all our common functions and configurations, it is hosted in an AWS Container Registry (OCI) repository. The second and third dependencies, _auth-service_ and _report-service_, are hosted in the local file system and are located in the **services** directory. It contains the source code for individual micro-services, organized into separate directories for each service. Each service has its own chart, with a **Chart.yaml** file that defines the chart’s metadata and a **templates** directory that contains the resource definitions for the service.

**_Envs_** directory contains environment-specific values files that can be used to customize the configuration of the charts for different environments.

By this setup, each product is managed in its own separate repository and has its own version control history.
This separation allows the product code to be independent from the deployment code, enabling the ability to run any version of the product in any environment at any time, enabling the ability to run any version of the product in any environment at any time — which makes it easy to manage the drift of product versions between various environments.

Additionally, multiple developers can work on the same product simultaneously, allowing for local testing and debugging before deploying to an environment.

## Author extra thoughts

![Platform engineering lessons learned](https://miro.medium.com/v2/resize:fit:906/format:webp/1*4AdhnUrJPr6SXFWzz-8Slw.png)

Such a complex task requires many stages of trial and error. The road to a solution is full of obstacles, edge cases, and the whims of users who may not have the same level of knowledge as the author.
I am sure that this is not the only way and maybe not even the best way to carry out such a complex task, but in my opinion the key to success is to develop the architecture together with the people who are supposed to use and maintain the system, teach them your way of thinking and understand if it converges with theirs. Put all the study cases in writing and find a solution that is somewhere in the middle between efficient, sophisticated and maintenance-friendly range.

It was my pleasure to share the knowledge with you and I would love to hear your opinion.