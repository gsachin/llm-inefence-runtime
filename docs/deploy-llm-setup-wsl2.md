# LLM Inference Setup Guide: WSL2 (Windows)

> For Windows 10/11 with WSL2. Supports both CPU-only and GPU (with NVIDIA driver on Windows host).

## Prerequisites (Windows Host)

### 1. Enable WSL2
```powershell
# Run in PowerShell as Administrator
wsl --install
wsl --set-default-version 2

# Install Ubuntu (or your preferred distro)
wsl --install -d Ubuntu-22.04
```

### 2. Install Docker Desktop
1. Download from https://docs.docker.com/desktop/install/windows-install/
2. During install, enable "Use WSL 2 instead of Hyper-V"
3. After install: Settings → Resources → WSL Integration → Enable for your distro

### 3. (Optional) Install NVIDIA Driver for GPU Support
1. Download from https://www.nvidia.com/download/index.aspx
2. Install on Windows (NOT inside WSL)
3. Verify in WSL:
```bash
nvidia-smi  # Should show GPU info
```

## WSL2 Setup

### 4. Open WSL Terminal
```powershell
wsl -d Ubuntu-22.04
```

### 5. Install Python
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv
python3 --version  # 3.10+
```

### 6. Install Kubernetes Tools
```bash
# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# k3d
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# Verify
docker --version      # Should work via Docker Desktop
kubectl version --client
helm version --short
k3d version
```

### 7. (GPU Only) Install NVIDIA Container Toolkit
```bash
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Verify GPU in Docker
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

## Environment Setup

### 8. Clone and Bootstrap
```bash
git clone <repo-url> && cd inference-runtime

# Option A: Full bootstrap
./scripts/bootstrap.sh

# Option B: Manual
python3 -m venv .venv
source .venv/bin/activate
pip install -r orchestrator/requirements.txt
pip install -r orchestrator/requirement-dev.txt
```

### 9. Activate Virtual Environment
```bash
source .venv/bin/activate
```

## Kubernetes Cluster Setup

### 10. Create k3d Cluster

**With GPU:**
```bash
k3d cluster create llm-cluster \
  --servers 1 \
  --agents 2 \
  --port 8080:80@loadbalancer \
  --port 8443:443@loadbalancer \
  --gpus all
```

**CPU Only:**
```bash
k3d cluster create llm-cluster \
  --servers 1 \
  --agents 2 \
  --port 8080:80@loadbalancer \
  --port 8443:443@loadbalancer
```

### 11. (GPU Only) Install NVIDIA Device Plugin
```bash
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.5/nvidia-device-plugin.yml

# Verify
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'
```

### 12. Install KServe Stack
```bash
# Using Makefile
make kserve

# Or manually
helm repo add jetstack https://charts.jetstack.io --force-update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --wait --timeout 300s

kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.13.0/kserve.yaml
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.13.0/kserve-cluster-resources.yaml
kubectl wait --for=condition=ready pod -l control-plane=kserve-controller-manager -n kserve --timeout=300s
```

### 13. Verify Cluster
```bash
kubectl cluster-info
kubectl get crd inferenceservices.serving.kserve.io
```

## Deploy LLM

### 14. Choose Profile

**CPU Only:**
- `local_dev` - Minimal (6-10Gi RAM)
- `cpu_fallback` - Standard CPU

**With GPU:**
- `mid_range_gpu` - 24GB+ VRAM
- `dgx_cloud_gpu` - A100/H100

```bash
# Preview
python -m orchestrator.cli \
  --profile local_dev \
  --release my-llm \
  --namespace llm \
  --dry-run
```

### 15. Deploy
```bash
# CPU
python -m orchestrator.cli \
  --profile local_dev \
  --release my-llm \
  --namespace llm

# GPU
python -m orchestrator.cli \
  --profile mid_range_gpu \
  --release my-llm \
  --namespace llm
```

### 16. Monitor Deployment
```bash
kubectl get pods -n llm -w
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm -f
kubectl get inferenceservice -n llm
```

## Test Inference

### 17. Port Forward
```bash
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
```

### 18. Send Request
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-0.5B-Instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

You can also access from Windows browser/tools at `http://localhost:8000`.

## Cleanup

```bash
helm uninstall my-llm -n llm
kubectl delete ns llm
k3d cluster delete llm-cluster
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Docker not found | Ensure Docker Desktop is running; check WSL integration in settings |
| nvidia-smi not found | Install NVIDIA driver on Windows host (not WSL) |
| GPU not visible in Docker | Install nvidia-container-toolkit in WSL |
| Slow performance | Increase WSL memory in `.wslconfig` (see below) |
| Port forward not accessible from Windows | Use `localhost`, not `127.0.0.1` |

### Increase WSL2 Memory
Create/edit `%USERPROFILE%\.wslconfig`:
```ini
[wsl2]
memory=16GB
processors=8
```
Then restart WSL: `wsl --shutdown`

## Notes

- **GPU passthrough**: Requires Windows 11 or Windows 10 21H2+ with NVIDIA driver 470.76+
- **Performance**: WSL2 has slight overhead vs native Linux; allocate generous memory
- **File access**: Keep repo in WSL filesystem (`/home/...`) not Windows mount (`/mnt/c/...`) for speed
