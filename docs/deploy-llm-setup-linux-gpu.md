# LLM Inference Setup Guide: Linux with NVIDIA GPU

> For Ubuntu/Debian with NVIDIA RTX/Datacenter GPUs (24GB+ VRAM recommended).

## Prerequisites

### 1. Install NVIDIA Driver
```bash
# Check current driver
nvidia-smi

# If not installed (Ubuntu)
sudo apt update
sudo apt install -y nvidia-driver-535

# Reboot required
sudo reboot
```

### 2. Install Docker
```bash
curl -fsSL https://get.docker.com | sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version  # 24.0+
```

### 3. Install NVIDIA Container Toolkit
```bash
# Add NVIDIA repository
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# Install
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker runtime
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verify GPU in Docker
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### 4. Install Kubernetes Tools
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
kubectl version --client  # v1.29+
helm version --short      # v3.14+
k3d version               # v5.6+
```

### 5. Install Python
```bash
sudo apt install -y python3 python3-pip python3-venv
python3 --version  # 3.10+
```

## Environment Setup

### 6. Clone and Bootstrap
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

### 7. Activate Virtual Environment
```bash
source .venv/bin/activate
```

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

### 9. Install NVIDIA Device Plugin
```bash
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.5/nvidia-device-plugin.yml

# Verify GPU visibility in cluster
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'
```

### 10. Install KServe Stack
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

### 11. Verify Cluster
```bash
kubectl cluster-info
kubectl get crd inferenceservices.serving.kserve.io
kubectl describe nodes | grep -A5 "Allocatable:" | grep nvidia
```

## Deploy LLM

### 12. Choose Profile
Available GPU profiles:
- `mid_range_gpu` - 24GB+ VRAM (RTX 3090/4090, A5000)
- `high_param_unified_gpu` - 100GB+ unified memory
- `dgx_cloud_gpu` - A100/H100 datacenter GPUs

```bash
# Preview deployment
python -m orchestrator.cli \
  --profile mid_range_gpu \
  --release my-llm \
  --namespace llm \
  --dry-run
```

### 13. Deploy
```bash
python -m orchestrator.cli \
  --profile mid_range_gpu \
  --release my-llm \
  --namespace llm
```

### 14. Monitor Deployment
```bash
# Watch pod status
kubectl get pods -n llm -w

# Check GPU allocation
kubectl describe pod -n llm -l serving.kserve.io/inferenceservice=my-llm | grep -A3 "Limits:"

# Check logs
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm -f

# Check InferenceService
kubectl get inferenceservice -n llm
```

## Test Inference

### 15. Port Forward
```bash
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
```

### 16. Send Request
```bash
# For mid_range_gpu profile (Qwen2.5-1.5B)
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-1.5B-Instruct",
    "messages": [{"role": "user", "content": "Explain CUDA in one sentence."}]
  }'
```

## Cleanup

```bash
helm uninstall my-llm -n llm
kubectl delete ns llm
k3d cluster delete llm-cluster
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| GPU not visible in cluster | Ensure `--gpus all` in k3d create; install nvidia-device-plugin |
| CUDA OOM | Use smaller model or reduce `--gpu-memory-utilization` in profile |
| nvidia-smi not found | Install/reinstall NVIDIA driver, reboot |
| Container can't access GPU | Check nvidia-container-toolkit installation |

## Performance Tips

- **GPU Memory Utilization**: Default is 0.90; reduce if OOM
- **Larger Models**: For 70B+ models, use `high_param_unified_gpu` profile on A100/H100
- **Gated Models**: Llama requires `HF_TOKEN` environment variable
