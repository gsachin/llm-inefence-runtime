# LLM Inference Setup Guide: Linux with NVIDIA GPU

> For Ubuntu/Debian systems with NVIDIA RTX or Data Center GPUs (24GB+ VRAM recommended)

---

## Prerequisites

### 1. Install NVIDIA Driver

```bash
# Check if driver is already working
nvidia-smi
```

If you see a GPU table → you're good.  
If not:

```bash
sudo apt update

# Check recommended driver for your GPU
ubuntu-drivers devices

# Install recommended driver (or specify version)
sudo apt install -y nvidia-driver-550  # or use: sudo ubuntu-drivers autoinstall
sudo reboot
```

After reboot, verify:

```bash
nvidia-smi
```

---

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh

# Allow current user to run docker
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version   # Expect 24.0+
```

---

### 3. Install NVIDIA Container Toolkit

> ⚠️ **Important**: Do **not** use `$distribution` auto-detection — it often breaks on newer Ubuntu/Debian releases. Use NVIDIA's generic stable deb repo instead.

#### Add GPG Key

```bash
sudo mkdir -p /usr/share/keyrings

curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
```

#### Add Repository

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
```

#### Install Toolkit

```bash
sudo apt update
sudo apt install -y nvidia-container-toolkit
```

#### Configure Docker Runtime

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

#### Verify GPU Inside Docker

```bash
docker run --rm --gpus all nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi
```

You should see your GPU info from inside the container.

---

### 4. Install Kubernetes Tools

```bash
# jq (required for JSON parsing in verification steps)
sudo apt install -y jq

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# k3d
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# Verify
kubectl version --client
helm version --short
k3d version
```

---

### 5. Install Python

```bash
sudo apt install -y python3 python3-pip python3-venv
python3 --version   # 3.10+
```

---

## Environment Setup

### 6. Clone and Bootstrap

```bash
git clone <repo-url>
cd inference-runtime

# Option A: Full bootstrap
./scripts/bootstrap.sh

# Option B: Manual
python3 -m venv .venv
source .venv/bin/activate
pip install -r orchestrator/requirements.txt
pip install -r orchestrator/requirement-dev.txt
```

---

### 7. Activate Virtual Environment

```bash
source .venv/bin/activate
```

---

## Kubernetes Cluster Setup

### 8. Create GPU-Enabled k3d Cluster

```bash
k3d cluster create llm-cluster \
  --servers 1 \
  --agents 2 \
  --port 8080:80@loadbalancer \
  --port 8443:443@loadbalancer \
  --gpus all
```

---

### 9. Install NVIDIA Device Plugin

```bash
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.0/deployments/static/nvidia-device-plugin.yml

# Verify GPU visibility (may take 30-60 seconds)
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'
```

You should see `"1"` or `"2"` depending on GPU count.

---

### 10. Install KServe Stack

```bash
# Install cert-manager
helm repo add jetstack https://charts.jetstack.io --force-update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --wait --timeout 300s

# Install KServe
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.14.1/kserve.yaml
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.14.1/kserve-cluster-resources.yaml
kubectl wait --for=condition=ready pod -l control-plane=kserve-controller-manager -n kserve --timeout=300s
```

---

### 11. Verify Cluster GPU Access

```bash
kubectl cluster-info
kubectl get crd inferenceservices.serving.kserve.io
kubectl describe nodes | grep -A5 "Allocatable:" | grep nvidia
```

---

## Deploy LLM

### 12. Choose Profile

Available GPU profiles (from `profiles.yaml`):

| Profile | Target Hardware | VRAM |
|---------|-----------------|------|
| `mid_range_gpu` | RTX 3090 / 4090 / A5000 | 24GB+ |
| `high_param_unified_gpu` | Multi-GPU / NVLink systems | 100GB+ |
| `dgx_cloud_gpu` | A100 / H100 datacenter | 40-80GB |
| `cpu_fallback` | No GPU available | N/A |

> **Note**: For Apple Silicon Macs, see [deploy-llm-setup-macos.md](deploy-llm-setup-macos.md) instead.

Preview deployment:

```bash
python -m orchestrator.cli \
  --profile mid_range_gpu \
  --release my-llm \
  --namespace llm \
  --dry-run
```

---

### 13. Deploy

```bash
python -m orchestrator.cli \
  --profile mid_range_gpu \
  --release my-llm \
  --namespace llm
```

---

### 14. Monitor Deployment

```bash
# Watch pod status
kubectl get pods -n llm -w

# Check GPU allocation
kubectl describe pod -n llm -l serving.kserve.io/inferenceservice=my-llm | grep -A3 "Limits:"

# Stream logs
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm -f

# Check InferenceService status
kubectl get inferenceservice -n llm
```

---

## Test Inference

### 15. Port Forward

```bash
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
```

### 16. Send Request

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-1.5B-Instruct",
    "messages": [{"role": "user", "content": "Explain CUDA in one sentence."}]
  }'
```

---

## Cleanup

```bash
helm uninstall my-llm -n llm
kubectl delete ns llm
k3d cluster delete llm-cluster
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| GPU not visible in Docker | Re-run `sudo nvidia-ctk runtime configure --runtime=docker` and restart Docker |
| GPU not visible in k8s | Ensure `--gpus all` in k3d create + device plugin installed |
| CUDA OOM | Use smaller model or reduce `--gpu-memory-utilization` in vllm_flags |
| `nvidia-smi` missing | Driver not installed correctly — reinstall and reboot |
| Container can't access GPU | Test with `docker run --gpus all nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi` |

---

## Performance Tips

- **GPU Memory**: Default utilization is ~90% — reduce if hitting OOM by adding to `vllm_flags`:
  ```
  --gpu-memory-utilization 0.85
  ```
- **Large Models**: 70B+ models require A100/H100 or multi-GPU setups
- **Gated Models**: Some models (e.g., Llama) require HuggingFace token. Create a k8s secret:

```bash
# Create secret for gated model access
kubectl create secret generic hf-token -n llm --from-literal=HF_TOKEN=your_token_here

# Reference in your deployment (handled by Helm chart)
# Or set locally for CLI dry-run testing:
export HF_TOKEN=your_token_here
```

---

## Quick Validation Checklist

```bash
# 1. Driver
nvidia-smi

# 2. Docker + GPU
docker run --rm --gpus all nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi

# 3. k3d cluster
kubectl get nodes

# 4. GPU in cluster
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'

# 5. KServe ready
kubectl get pods -n kserve
```