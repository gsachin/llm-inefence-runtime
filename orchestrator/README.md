# Orchestrator (single trigger)

This is a thin wrapper around Helm that:
1) reads a profile from `../profiles.yaml`
2) generates a Helm values file
3) runs `helm upgrade --install` for the `charts/llm-vllm` chart

## Quickstart

- Requires `helm` on PATH.

- Install dev deps: `pip install -r orchestrator/requirement-dev.txt`
- Dry run (renders chart):

  `python -m orchestrator.cli --profile cpu_fallback --release my-llm --namespace llm --dry-run`

- Real deploy:

  `python -m orchestrator.cli --profile cpu_fallback --release my-llm --namespace llm`

Generated values are written to `orchestrator/generated/<release>.yaml`.

## Production install

- Install prod deps: `pip install -r orchestrator/requirement-prod.txt`
