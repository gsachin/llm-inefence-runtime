# Copilot instructions (inference-runtime)

## Big picture
- This repo is a **runtime scaffold** for the platform-agnostic intent described in `../agnostic/INTENT.md`.
- Today the only “source of truth” is the **profile contract** in `profiles.yaml`.
- `charts/llm-vllm/` and `orchestrator/` are present but currently empty; use the README-described intent when implementing them.

## Key artifacts & contracts
- `profiles.yaml`
  - Top-level: `profiles: <profile_name>: ...`
  - Per-profile fields (keep schema consistent):
    - `description`: human readable
    - `thresholds`: hardware selector fields (seen: `gpu` bool, `arch`, `compute_cap`, `effective_mem_gb`)
    - `model`: model id (e.g. `meta-llama/Llama-3.2-3B-Instruct`)
    - `image`: vLLM image reference (comments note to pin tag/digest for prod)
    - `gpu_count`: integer (0 for CPU)
    - `resources`: Kubernetes quantity strings: `cpu_request`, `cpu_limit`, `mem_request`, `mem_limit`
    - `vllm_flags`: single string of CLI flags (e.g. `--device cpu`)

## Intended components (when adding code)
- Helm chart (`charts/llm-vllm/`)
  - Should render a KServe `InferenceService` (`serving.kserve.io/v1beta1`) running a vLLM container.
  - Optionally render Envoy Gateway / Gateway API `HTTPRoute` when routing is enabled.
  - Values schema should map cleanly from `profiles.yaml` fields (model/image/resources/gpu_count/vllm_flags).

- Orchestrator CLI (`orchestrator/`)
  - “Single trigger” tool: select a profile → generate Helm values → apply a Helm release.
  - Keep it profile-driven: avoid hardcoding manifests; treat `profiles.yaml` as input contract.
  - README intent is “one model per service”; avoid multi-model deployments unless explicitly requested.

## Environment assumptions (from README)
- Target cluster has KServe installed and supports `InferenceService`.
- If routing is enabled, Envoy Gateway + Gateway API (`HTTPRoute`) is available.
- `helm` is installed on the machine running the orchestrator.

## Repo-specific conventions to follow
- Use Kubernetes quantity strings exactly as in `profiles.yaml` (e.g. `"16Gi"`, `"8"`), not numeric types.
- Keep vLLM args in `vllm_flags` as a single string; don’t split into YAML lists unless you update all consumers.
- Preserve the existing profile names and examples (`high_param_unified_gpu`, `mid_range_gpu`, `cpu_fallback`) when adding new tiers.
