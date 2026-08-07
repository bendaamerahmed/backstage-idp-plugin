---
name: backstage-kubernetes
description: Wire the Backstage Kubernetes plugin — cluster locators, auth providers, entity annotations, and surfacing your own CRDs as custom resources on the entity page.
when_to_use: 'Kubernetes tab empty or missing, "no resources found" for a component, add a cluster to Backstage, show our CRD in Backstage, customResources config, backstage.io/kubernetes-id, kubernetes-label-selector, cluster locator, serviceLocatorMethod, 401 or 403 from a cluster, Backstage cannot see our operator resources, show pods for this service.'
---

# Backstage Kubernetes

Make a service's real cluster workloads — including your own custom resources —
appear on its entity page. Four things must line up: the cluster is reachable,
Backstage is authorised on it, the entity is annotated, and the object type is
requested. A miss on any one shows as an empty tab.

## Preconditions

- Backend generation known. New backend system:
  `backend.add(import('@backstage/plugin-kubernetes-backend'))` in
  `packages/backend/src/index.ts`. Legacy: a `createRouter` under
  `packages/backend/src/plugins/`, which must be migrated before adding modules
  (`backstage-plugin-migrate`). Frontend: NFS consumes the plugin's `/alpha`
  export; legacy imports `EntityKubernetesContent` into the entity page.
- Cluster reachability from the **backend**, not from your laptop. A cluster
  behind a VPN the backend pod cannot reach fails identically to a wrong URL.
- Exact config shapes read from the installed
  `@backstage/plugin-kubernetes-backend` `config.schema.json`, and exact
  annotation constants from `@backstage/plugin-kubernetes-common`. Both move.
- Read access to the cluster's RBAC, because surfacing a CRD needs an explicit
  grant and that grant is usually the missing piece.
- Any change to a real cluster's RBAC or service accounts is external mutation:
  stop and return a BLOCKED report with the exact Role and ClusterRole rules
  needed, rather than applying them.

## Procedure

1. **Establish which of the four layers is missing** before editing config.
   Query the backend directly: `POST /api/kubernetes/services/<entity-name>`
   with a user token. A `200` with an empty array is an annotation or selector
   problem; a `500` naming a cluster is reachability or auth; a `404` means the
   plugin is not wired at all.
2. **Choose a cluster locator method.** `config` lists clusters inline and is
   right for a handful. `catalog` reads them from `Resource` entities of type
   `kubernetes-cluster`, which scales and keeps cluster inventory in the catalog.
   `gke` discovers GKE clusters in a project. `localKubectlProxy` is development
   only — it assumes `kubectl proxy` on the developer's machine and must never
   reach a deployed config.
3. **Declare clusters under `kubernetes.clusterLocatorMethods`.** Per cluster the
   fields are `url`, `name`, and one of the auth arrangements: a
   `serviceAccountToken`, or an `authProvider` with `authMetadata`. Optional:
   `title`, `skipTLSVerify`, `skipMetricsLookup`, `caData`, `caFile`,
   `oidcTokenProvider`, and a per-cluster `customResources`. Every credential is
   `${ENV_VAR}` or a `$env`/`$file` reference — never a literal.
4. **Pick `serviceLocatorMethod` deliberately.** `multiTenant` queries every
   cluster for every entity and is the usual default. `singleTenant` and
   `catalogRelation` narrow that. On a large fleet `multiTenant` is a latency and
   rate-limit problem before it is a correctness one.
5. **Annotate the entities.** `backstage.io/kubernetes-id` matches objects
   carrying the `backstage.io/kubernetes-id` label with the same value —
   the label goes on your workloads, in your manifests or Helm chart, and is the
   half people forget. `backstage.io/kubernetes-label-selector` replaces that
   with an arbitrary selector and wins when both are present. Namespace can be
   narrowed with the namespace annotation. Validate with `backstage-catalog`.
6. **Request the object types you want.** `kubernetes.objectTypes` accepts
   `pods`, `services`, `configmaps`, `deployments`, `limitranges`,
   `resourcequotas`, `replicasets`, `horizontalpodautoscalers`, `jobs`,
   `cronjobs`, `ingresses`, `statefulsets`, `daemonsets` and `customresources`.
   Setting it at all replaces the default set — a list that omits `pods` hides
   pods, which reads as a broken plugin.
7. **Declare each CRD you want surfaced** in `kubernetes.customResources` as
   `{ group, apiVersion, plural }`. All three are required, `apiVersion` is the
   version alone (not `group/version`), and `plural` is the CRD's
   `spec.names.plural` — not the Kind. Declare them per cluster instead when only
   some clusters have the operator installed. See `kubernetes-crd-author` when
   the CRD is one you own.
8. **Grant RBAC for the custom resources.** The default guidance grants the core
   workload types only; a CRD needs its own `apiGroups`/`resources` rule with
   `get`, `list` and `watch`. This is the most common reason a correctly declared
   CRD stays invisible. Prepare the ClusterRole and stop for authorization before
   anything is applied to a real cluster.
9. **Restrict what reaches the frontend.** The plugin returns whole objects, so a
   Secret-adjacent CRD or one with credentials in `spec` exposes them to every
   user who can see the entity. Decide per CRD whether it should be surfaced at
   all, and treat that as a data-exposure review, not a config change.
10. **Wire the frontend for the repo's generation** and confirm the tab renders
    for an entity you know has workloads, not for an arbitrary one.

## Verification

- `yarn backstage-cli config:check --strict` passes with the new keys.
- `POST /api/kubernetes/services/<entity>` returns the expected clusters, and for
  each the resource types you requested. This is the contract; the UI is a view
  of it.
- An entity with a deliberately wrong `kubernetes-id` returns an empty array —
  proving the selector is doing something rather than everything matching.
- Each declared CRD appears in the response for an entity that has one. If the
  response omits it while `kubectl get <plural>` succeeds with the backend's own
  credentials, the gap is RBAC.
- `yarn backstage-cli config:print --frontend` shows no cluster credential.
- The Kubernetes tab renders for a known-good entity in both light and dark
  themes; the error and empty states are separate components and only one gets
  looked at.

## Failure modes

- **Kubernetes tab is empty, no error.** In order: the entity is not annotated;
  the workloads do not carry the matching label; the namespace is excluded; the
  object type was dropped by an `objectTypes` list. Query the API directly to
  tell these apart — the UI renders all four identically.
- **Custom resource never appears though the CRD is declared.** RBAC. The backend
  identity can list Deployments and cannot list your CRD, and the plugin reports
  no error for a type it was refused.
- **`apiVersion` given as `group/version`.** The field takes the version alone
  and `group` is separate. The result is a silent no-match, not a validation
  error.
- **`plural` set to the Kind.** It is `spec.names.plural` from the CRD,
  lowercase, usually the plural noun. `kubectl get crd <name> -o jsonpath='{.spec.names.plural}'`
  settles it.
- **401 or 403 from one cluster only.** A per-cluster token expired, or its
  service account lost a binding. The plugin surfaces this per cluster; read the
  backend logs rather than the tab.
- **Works locally, fails deployed.** `localKubectlProxy` reached a laptop, or the
  in-cluster service account differs from the one your kubeconfig used.
- **Every entity shows every workload.** A `kubernetes-label-selector` broad
  enough to match everything, or a label applied cluster-wide by a mutating
  webhook.
- **Catalog locator returns nothing.** The cluster `Resource` entities are absent
  or the wrong type; the locator matches on entity type, so a typo yields zero
  clusters and an empty tab rather than an error.
- **Backend slow or rate-limited after adding clusters.** `multiTenant` queries
  every cluster for every entity page. Narrow the service locator before adding
  more clusters.

## Do not

- Do not apply RBAC, create service accounts, or rotate cluster credentials.
  Prepare the manifests, report them, and stop for authorization.
- Do not put a service account token, kubeconfig or CA blob literally in
  `app-config.yaml`.
- Do not enable `skipTLSVerify` outside local development, and never leave it in
  a config that a deployed environment loads.
- Do not ship `localKubectlProxy` in any config a deployed backend reads.
- Do not surface a CRD whose objects carry credentials or personal data without
  an explicit decision recorded in your report.
- Do not set `objectTypes` to add one type without re-listing the types you still
  want; it replaces rather than extends.
- Do not guess a CRD's `group`, `apiVersion` or `plural`. Read them from the
  installed CRD, or return BLOCKED naming the cluster you need access to.
