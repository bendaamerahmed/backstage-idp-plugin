---
name: kubernetes-crd-author
description: Design and implement Kubernetes CRDs and their controllers, with kubebuilder or by hand — API types, validation markers, generated manifests, reconcile loops, and CRD versioning.
when_to_use: 'Write or change a CRD, build an operator, kubebuilder init or create api, controller-gen, controller-runtime, reconcile loop, "add a field to our custom resource", CRD validation rules, printer columns, status subresource, CRD versioning and conversion webhooks, envtest, our operator does not reconcile, kubectl apply rejects our CR.'
---

# Authoring Kubernetes CRDs and controllers

A CRD is a published API. Once someone has stored an object in it you cannot
change your mind cheaply, so the schema and the versioning decision matter more
than the controller does. Design the API first, generate everything else.

## Preconditions

- This is Go and Kubernetes work, usually in a **different repository** from the
  Backstage portal. Confirm which repository you are in before writing anything;
  a controller does not belong in a Backstage monorepo.
- Toolchain versions read from the repository, not assumed: `PROJECT` file for
  the kubebuilder layout version, `Makefile` for the pinned `controller-gen`
  version, `go.mod` for `sigs.k8s.io/controller-runtime`. These three move
  independently and a mismatch between `controller-gen` and the runtime is a
  common source of "generation produces something that will not compile".
- The target cluster's Kubernetes minor, because CRD schema features
  (`x-kubernetes-validations` CEL rules, in particular) gate on it.
- Whether this API is **new** or **already deployed**. Everything about versioning
  and field changes below turns on that answer, and it is not recoverable later.
- Applying a CRD or an operator to a shared cluster is external mutation: prepare
  the manifests, stop, and return the exact `kubectl` or `make` command for
  authorization.

## Procedure

1. **Decide whether a CRD is the right shape at all.** A CRD earns its place when
   something must be declaratively reconciled toward a desired state and observed
   by others. Configuration nobody reconciles is a ConfigMap. A one-off action is
   a Job. An operator that only templates YAML is a chart with extra failure
   modes.
2. **Design the API before scaffolding.** Group (`<team>.<company>.com`), Kind,
   and a `spec`/`status` split where `spec` is exclusively user intent and
   `status` is exclusively controller observation. Anything a user must set to
   make the object valid belongs in `spec`; anything the controller computes
   belongs in `status` and must survive being recomputed from scratch.
3. **Start at `v1alpha1`.** It signals instability and lets you break the schema
   without a conversion webhook. Promoting later is cheap; starting at `v1` and
   discovering the schema is wrong is not.
4. **Scaffold rather than hand-roll.** `kubebuilder init --domain <company.com>
   --repo <module path>` then `kubebuilder create api --group <group> --version
   v1alpha1 --kind <Kind>`. It wires the scheme registration, the manager, RBAC
   markers, the Makefile targets and a test harness that are tedious and easy to
   get subtly wrong by hand.
5. **Write the types with markers, not prose.** On the root type,
   `+kubebuilder:object:root=true` and `+kubebuilder:subresource:status`. On
   fields, `+kubebuilder:validation:*` for bounds, enums, patterns and required,
   `+kubebuilder:default=` for defaults, and `+optional` for genuinely optional
   fields. Markers are the schema; validation written only in the controller is
   validation that runs after the object was already accepted. Read the marker
   set from the pinned `controller-gen` version — markers are added between
   minors.
6. **Add printer columns.** `+kubebuilder:printcolumn:name=...,type=...,JSONPath=...`
   for the two or three fields an operator would want from `kubectl get`. Without
   them the CR prints only name and age, which makes it useless at the terminal
   and is the most common complaint about a first CRD.
7. **Model status as conditions.** A `Ready` condition of the standard
   `metav1.Condition` shape, with `observedGeneration`, is what every other tool
   knows how to read. Ad-hoc status booleans are invisible to `kubectl wait` and
   to anything watching.
8. **Generate, never edit generated files.** `make manifests generate` produces
   the CRD YAML under `config/crd/bases` and the deepcopy functions. A
   hand-edited CRD is silently reverted on the next generation, and the symptom
   arrives later as a schema that does not match the types.
9. **Write the reconcile loop to be idempotent and level-triggered.** Reconcile
   reads current state and moves toward `spec`; it must produce the same result
   called once or twenty times, and must never depend on having seen the previous
   event. Return a requeue rather than sleeping. Set owner references so garbage
   collection cleans up what you created.
10. **Add a finalizer only if there is external state to clean up.** A finalizer
    with a bug makes objects undeletable, which is a worse failure than leaking
    the resource it was protecting. If you add one, make its removal path
    unconditional on the external system being reachable.
11. **Keep RBAC markers next to the code that needs them.** `+kubebuilder:rbac:groups=...`
    above the reconciler, then `make manifests` regenerates the role. Hand-written
    role YAML drifts from what the controller actually calls.
12. **Test the reconcile loop with envtest**, which runs a real API server, so
    schema validation and defaulting are exercised rather than mocked. Cover: the
    object is created and reaches `Ready`; a mutated child is corrected; deletion
    cleans up. `make test` runs it.
13. **Plan the next version before you need it.** Adding an optional field with a
    default is safe. Removing a field, tightening validation, or changing a type
    is breaking and needs a new version plus a conversion webhook, with exactly
    one storage version. Decide the hub-and-spoke conversion shape when you add
    the second version, not the third.
14. **Then surface it in the portal.** A CRD is only useful to a platform team if
    people can see it — see `backstage-kubernetes` for declaring it under
    `kubernetes.customResources` and the RBAC that needs.

## Verification

- `make manifests generate` produces no diff on a second run — a diff means
  something is hand-edited or the generator version is unpinned.
- `make test` passes, including envtest, on the Kubernetes version you target.
- `kubectl apply --dry-run=server -f config/crd/bases/` against a real cluster
  accepts the CRD. Server-side dry run catches schema problems that client-side
  does not.
- A deliberately invalid CR is **rejected by the API server**, not by the
  controller. If the controller is what rejects it, the validation is in the
  wrong place.
- `kubectl get <plural>` shows your printer columns.
- `kubectl explain <kind>.spec` shows field descriptions — proving the Go doc
  comments reached the schema.
- `kubectl wait --for=condition=Ready` succeeds against a healthy object.
- Deleting the parent removes the children, proving owner references are set.

## Failure modes

- **The API server rejects a CR that matches the Go types.** The cluster has an
  older generated CRD. Regenerate with `make manifests` and reinstall it; the Go
  types and the installed schema are two separate artifacts, and only one of them
  is in the cluster.
- **A field is silently dropped on apply.** It is not in the CRD schema —
  a marker missing, generation not re-run, or the field unexported. Kubernetes
  prunes unknown fields without complaint.
- **Generated code will not compile after a toolchain bump.** `controller-gen`
  and `controller-runtime` are pinned separately and a mismatched pair emits code
  for a different API. Align them in `Makefile` and `go.mod` together.
- **The controller reconciles endlessly.** It writes to `spec`, or writes status
  unconditionally on every pass, and its own write re-triggers the watch. Write
  status only when it changed, and never write to `spec`.
- **Objects will not delete.** A finalizer whose removal path depends on an
  external system that is gone. Recovery is a manual finalizer edit, so treat any
  finalizer as a potential outage.
- **Status resets to empty periodically.** The controller reconstructs status
  from scratch and loses fields it did not compute this pass, or the status
  subresource is not enabled so a spec update overwrites status wholesale.
- **CEL validation rules are rejected by the API server.** `x-kubernetes-validations`
  needs a recent enough Kubernetes minor; the rule is valid and the cluster is
  too old.
- **Two versions and no storage version decision.** Exactly one version carries
  `storage: true`. Zero or two makes the CRD unservable, and the error names the
  CRD rather than the mistake.
- **Everything works in envtest and fails in the cluster.** envtest runs the API
  server without a scheduler, kubelet or admission webhooks. Anything depending
  on a Pod actually running needs a real cluster.

## Do not

- Do not apply a CRD, install an operator, or change RBAC on a shared or
  production cluster. Prepare the manifests, report the command, and stop.
- Do not edit anything under `config/crd/bases` or any `zz_generated` file.
- Do not put a controller in the Backstage monorepo; it is a different toolchain,
  a different release cadence and a different blast radius.
- Do not start a new API at `v1`, and do not change a served version's schema in
  a breaking way — add a version.
- Do not write validation only in the reconciler when a marker expresses it; the
  API server should reject bad objects before they are ever stored.
- Do not store credentials in a CR `spec`. Reference a Secret; a CR is readable
  by anyone with `get` on the type, including the Backstage portal if it is
  surfaced.
- Do not guess a marker's syntax or a controller-runtime signature. Read the
  pinned version's documentation or its Go types.
- Do not add a finalizer without a tested path that removes it when the external
  system is unreachable.
