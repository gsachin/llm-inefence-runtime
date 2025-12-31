# inference-runtime

Runtime implementation scaffold for the platform-agnostic intent described in `../agnostic/INTENT.md` and `../agnostic/intent1.1.md`.

## What this contains
- `profiles.yaml`: contract-driven profile definitions (hardware → deployment shape)
- `charts/llm-vllm`: Helm chart producing KServe `InferenceService` (vLLM container) and optional Envoy Gateway `HTTPRoute`
- `orchestrator/`: a “single trigger” CLI that selects a profile, generates Helm values, and applies releases

## Assumptions
- Kubernetes cluster has KServe installed and supports `serving.kserve.io/v1beta1` `InferenceService`.
- If routing is enabled, Envoy Gateway + Gateway API (`HTTPRoute`) is available.
- `helm` is installed on the machine running the orchestrator.

## Next
- Populate `profiles.yaml` for your supported tiers.
- Use the orchestrator CLI to deploy one model per service.

## Run (dry-run then deploy)

- Install orchestrator dev deps: `pip install -r orchestrator/requirement-dev.txt`
- Render manifests via Helm (no cluster changes):
	- `python -m orchestrator.cli --profile cpu_fallback --release my-llm --namespace llm --dry-run`
- Deploy to cluster:
	- `python -m orchestrator.cli --profile cpu_fallback --release my-llm --namespace llm`

## KServe prerequisite (CRDs)

This chart renders a KServe `InferenceService`. Your cluster must have the CRD installed:

- Verify:
	- `kubectl get crd inferenceservices.serving.kserve.io`

If you’re using a local kind cluster and want a version-pinned install (Standard mode, no Knative/Istio), one working sequence is:

- Install cert-manager:
	- `helm install cert-manager oci://quay.io/jetstack/charts/cert-manager --version v1.19.2 --namespace cert-manager --create-namespace --set crds.enabled=true`
- Install Gateway API CRDs:
	- `kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/standard-install.yaml`
- Install KServe v0.16.0 CRDs and controller (Standard mode):
	- `helm upgrade --install kserve-crd https://github.com/kserve/kserve/releases/download/v0.16.0/helm-chart-kserve-crd-v0.16.0.tgz --namespace kserve --create-namespace`
	- `helm upgrade --install kserve https://github.com/kserve/kserve/releases/download/v0.16.0/helm-chart-kserve-v0.16.0.tgz --namespace kserve --create-namespace --set kserve.controller.deploymentMode=Standard --set kserve.controller.gateway.ingressGateway.enableGatewayApi=true --set kserve.controller.gateway.ingressGateway.createGateway=true --set kserve.controller.gateway.ingressGateway.kserveGateway=kserve/kserve-ingress-gateway`
