# LLM Inference Setup Guide: macOS (Apple Silicon)

> For M1/M2/M3/M4 Macs. CPU-only inference (no GPU passthrough in containers).

## Prerequisites

### 1. Install Homebrew
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add to PATH (Apple Silicon)
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 2. Install Required Tools
```bash
brew install python@3.11 kubectl helm k3d
brew install --cask docker

# Start Docker Desktop and wait for it to be ready
open -a Docker
```

### 3. Verify Installations
```bash
docker --version          # Docker 24.0+
kubectl version --client  # v1.29+
helm version --short      # v3.14+
k3d version               # v5.6+
python3 --version         # 3.11+
```

## Environment Setup

### 4. Clone and Bootstrap
```bash
git clone <repo-url> && cd inference-runtime

# Option A: Full bootstrap (recommended)
./scripts/bootstrap.sh

# Option B: Manual setup
python3 -m venv .venv
source .venv/bin/activate
pip install -r orchestrator/requirements.txt
pip install -r orchestrator/requirement-dev.txt
```

### 5. Activate Virtual Environment
```bash
source .venv/bin/activate
```

## Kubernetes Cluster Setup

### 6. Create Local k3d Cluster
```bash
# Using Makefile
make cluster

# Or manually
k3d cluster create llm-cluster \
  --servers 1 \
  --agents 2 \
  --port 8080:80@loadbalancer \
  --port 8443:443@loadbalancer
```

### 7. Install KServe Stack
```bash
# Using Makefile
make kserve

# Or manually
# Install cert-manager
helm repo add jetstack https://charts.jetstack.io --force-update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --wait --timeout 300s

# Install KServe
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.13.0/kserve.yaml
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.13.0/kserve-cluster-resources.yaml
kubectl wait --for=condition=ready pod -l control-plane=kserve-controller-manager -n kserve --timeout=300s
```

### 8. Verify Cluster
```bash
kubectl cluster-info
kubectl get crd inferenceservices.serving.kserve.io
kubectl get pods -A
```

## Deploy LLM

### 9. Choose Profile
For macOS (CPU-only), use one of:
- `local_dev` - Minimal resources (6-10Gi RAM)
- `cpu_fallback` - Standard CPU (6-10Gi RAM)

```bash
# Preview deployment (dry-run)
python -m orchestrator.cli \
  --profile local_dev \
  --release my-llm \
  --namespace llm \
  --dry-run
```

### 10. Deploy
```bash
python -m orchestrator.cli \
  --profile local_dev \
  --release my-llm \
  --namespace llm
```

### 11. Monitor Deployment
```bash
# Watch pod status (model download takes 5-10 min)
kubectl get pods -n llm -w

# Check logs
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm -f

# Check InferenceService status
kubectl get inferenceservice -n llm
```

## Test Inference

### 12. Port Forward
```bash
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
```

### 13. Send Request
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-0.5B-Instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Cleanup

```bash
# Remove deployment
helm uninstall my-llm -n llm

# Delete namespace
kubectl delete ns llm

# Delete cluster
k3d cluster delete llm-cluster
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Pod OOMKilled | Increase Docker Desktop memory (Preferences → Resources → 12GB+) |
| Model download slow | Check internet; model is ~1GB for Qwen2.5-0.5B |
| ARM64 dtype error | Ensure profile uses `--dtype float32` (required for ARM64 CPU) |
| KServe CRD missing | Run `make kserve` or install manually |

## Notes

- **No GPU acceleration**: macOS containers cannot access Apple Silicon GPU
- **Memory**: Allocate at least 10GB to Docker Desktop for stable operation
- **Model**: Uses `Qwen/Qwen2.5-0.5B-Instruct` (ungated, no HF token needed)
