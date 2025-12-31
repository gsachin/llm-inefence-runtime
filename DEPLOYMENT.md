# Single-Trigger Deployment Guide: inference-runtime

This guide explains how to deploy an LLM inference service using the orchestrator CLI in a single, robust step.

---

## Prerequisites
- Kubernetes cluster (local Kind, Colima, or cloud)
- KServe and dependencies installed (see setup.sh or KServe docs)
- Helm and kubectl installed and configured
- Python 3.8+

---

## 1. Clone the Repository
```bash
git clone <your-repo-url>
cd inference-runtime
```

---

## 2. (Optional) Install KServe and Dependencies
If not already installed, run:
```bash
# Example for local Kind/Colima
bash setup.sh
# Or follow KServe install docs for your platform
```

---

## 3. Choose a Profile
Edit `profiles.yaml` or use one of the provided profiles:
- `local_dev` (for Mac/ARM64, Kind, low resources)
- `cpu_fallback` (for generic CPU)
- `mid_range_gpu`, `high_param_unified_gpu`, `dgx_cloud_gpu` (for GPU/cloud)

---

## 4. Deploy with a Single Command
```bash
python orchestrator/cli.py --profile local_dev --release my-llm --namespace llm
```
- The CLI will:
  - Validate your cluster, resources, and platform
  - Generate Helm values
  - Deploy the KServe InferenceService
  - Fail early with actionable errors if requirements are not met

---

## 5. Check Deployment Status
```bash
kubectl get pods,svc,inferenceservice -n llm
```

---

## 6. Port-Forward and Test Inference
```bash
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &

curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-0.5B-Instruct","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## 7. (Optional) Clean Up
```bash
helm uninstall my-llm -n llm
kubectl delete ns llm
```

---

## Troubleshooting
- If you see resource errors, try a smaller profile (e.g., `local_dev`).
- If KServe CRD is missing, run `setup.sh` or install KServe.
- For model errors, use an ungated model (e.g., Qwen).

---

**You now have a single-trigger, robust LLM inference deployment!**
