# LLM Inference Setup Guide: NVIDIA DGX Spark (GB10)

> **Target Hardware**: NVIDIA DGX Spark with GB10 GPU, Grace ARM64 CPU
> **Driver**: 590.48.01+, CUDA 13.1+
> **Architecture**: `aarch64` (ARM64)

---

## ⚠️ DGX Spark — What Makes It Different

DGX Spark is **not a standard NVIDIA GPU box**. Understanding these differences is critical:

| Area | DGX Spark Reality | Impact |
|------|-------------------|--------|
| **CPU Architecture** | ARM64 (Grace) | All containers must support `linux/arm64` |
| **GPU Memory Model** | Unified CPU–GPU memory | NVML memory metrics return "Not Supported" |
| **Driver/CUDA** | Very new (R590+ / CUDA 13.x) | Many tools hardcode older CUDA assumptions |
| **Kubernetes Engine** | **k3d is broken** | Use minikube or native k3s instead |
| **Scaling Strategy** | GPU metrics unreliable | Scale on request/queue metrics, not GPU telemetry |

### Why k3d Doesn't Work on DGX Spark

k3d runs K3s inside Docker (Docker-in-Docker). The NVIDIA device plugin inside the nested container tries to query NVML for GPU memory, but GB10's unified memory architecture returns "Not Supported":

```
error getting device memory: Not Supported
```

**Solution**: Use **minikube** with `--gpus=all` flag, which handles GPU passthrough correctly.

### ⚠️ Single Physical GPU Warning

DGX Spark has **one very large GPU**, not multiple GPUs.

Running multiple inference pods does **not** create more GPU compute — it only partitions the same device.

> **Throughput scaling comes from batching, not replicas.**

This is the #1 operator mistake. Understand this before scaling anything.

### Unified Memory ≠ Infinite Memory

Unified memory allows oversubscription, but **performance collapses** if the system starts paging between CPU and GPU memory under load.

If latency spikes suddenly at high concurrency, reduce:
- `--max-model-len`
- `--max-num-seqs`  
- `--gpu-memory-utilization`

This explains *why* stalls happen — the system is memory-bandwidth bound, not compute bound.

---

## Prerequisites

### 1. Verify NVIDIA Driver

```bash
# Check driver is loaded
nvidia-smi
```

Expected output for DGX Spark:
```
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 590.48.01              Driver Version: 590.48.01      CUDA Version: 13.1     |
+-----------------------------------------+------------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |
|   0  NVIDIA GB10                    On  |   0000000F:01:00.0 Off |                  N/A |
+-----------------------------------------+------------------------+----------------------+
```

> **Note**: The "Memory-Usage" column may show "Not Supported" — this is expected for GB10's unified memory architecture.

If driver is not loaded:
```bash
# DGX Spark uses pre-installed drivers - check DKMS
sudo dkms status

# If modules need signing (Secure Boot)
sudo mokutil --import /var/lib/shim-signed/mok/MOK.der
sudo reboot
# Enroll key in MOK Manager during boot
```

---

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh

# Add current user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version   # Expect 24.0+
```

---

### 3. Install NVIDIA Container Toolkit

> ⚠️ **Important**: Use NVIDIA's stable deb repo, not distribution-specific auto-detection.

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
docker run --rm --gpus all nvidia/cuda:13.1.0-runtime-ubuntu24.04 nvidia-smi
```

You should see your GB10 GPU info from inside the container.

---

### 4. Install Kubernetes Tools (ARM64)

```bash
# jq (required for JSON parsing)
sudo apt install -y jq

# kubectl (ARM64 binary)
ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')
KUBECTL_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt)
curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# minikube (ARM64) - NOT k3d!
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-arm64
chmod +x minikube-linux-arm64
sudo mv minikube-linux-arm64 /usr/local/bin/minikube

# Verify
kubectl version --client
helm version --short
minikube version
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

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r orchestrator/requirements.txt
pip install -r orchestrator/requirement-dev.txt
```

---

## Run Backend API Server

The orchestrator provides a FastAPI backend that powers the wizard UI.

### 7. Start Backend API

```bash
# Ensure virtual environment is active
source .venv/bin/activate

# Start the API server
uvicorn orchestrator.api.main:create_app --factory --host 0.0.0.0 --port 8080 --reload
```

**Verify API is running:**

```bash
curl http://localhost:8080/health
# Expected: {"status":"healthy"}

# Check available endpoints
curl http://localhost:8080/docs
# Opens Swagger UI in browser
```

**API Endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/platform/detect` | Detect current platform (Linux GPU, Mac, WSL2) |
| `GET /api/v1/platform/probe` | Probe hardware (GPU, RAM, arch) |
| `GET /api/v1/platform/feasibility` | Check profile compatibility |
| `POST /api/v1/credentials/hf-token` | Store Hugging Face token |
| `GET /api/v1/deps/status` | Check dependency status |
| `POST /api/v1/deploy/` | Deploy a profile |
| `GET /api/v1/lifecycle/resources` | List deployed resources |
| `DELETE /api/v1/lifecycle/destroy-all` | Emergency kill switch |

> **Keep this terminal running** — the frontend will connect to this API.

---

## Run Frontend Wizard UI

The frontend is a React + Vite application that can run as a web app or Electron desktop app.

### 8. Install Node.js (ARM64)

```bash
# Install Node.js via NodeSource (LTS version)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v20.x+
npm --version    # 10.x+
```

### 9. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 10. Run Frontend (Development Mode)

**Option A: Web Browser (Recommended for DGX Spark)**

```bash
npm run dev
```

Opens at: `http://localhost:5173`

**Option B: Electron Desktop App**

```bash
npm run dev:electron
```

> **Note:** Electron on ARM64 Linux requires additional dependencies:
> ```bash
> sudo apt install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libsecret-1-0
> ```

### 11. Connect Frontend to Backend

The frontend expects the backend at `http://localhost:8080`. This is configured in:

```typescript
// frontend/src/api/client.ts
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
```

If running backend on a different port/host, set environment variable:

```bash
VITE_API_URL=http://your-host:8080 npm run dev
```

### Wizard Flow

Once both frontend and backend are running:

```
1. Platform Detection  → Auto-detects DGX Spark (ARM64 + GB10)
2. Credentials         → Enter Hugging Face token
3. Dependencies        → Verify Docker, kubectl, helm, minikube
4. Profile Selection   → Choose dgx_spark_gpu profile
5. Deploy              → Deploys vLLM via Helm
6. Dashboard           → Monitor running services
```

---

## Build Production Artifacts

### Build Frontend for Production

```bash
cd frontend

# Web build
npm run build
# Output: frontend/dist/

# Electron Linux build
npm run dist:linux
# Output: frontend/dist-electron/
```

### Run Backend in Production Mode

```bash
# With Gunicorn (production ASGI server)
pip install gunicorn

gunicorn orchestrator.api.main:create_app \
  --factory \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8080
```

---

## Kubernetes Cluster Setup (Minikube)

### 7. Create GPU-Enabled Minikube Cluster

> ⚠️ **Critical**: Do NOT use k3d on DGX Spark. Use minikube with Docker driver.

```bash
# Delete any existing cluster
minikube delete 2>/dev/null || true

# Create new cluster with GPU support
minikube start \
  --driver=docker \
  --container-runtime=docker \
  --gpus=all \
  --cpus=max \
  --memory=max

# Verify cluster is running
kubectl cluster-info
kubectl get nodes
```

#### Minikube Driver Options (Performance Tuning)

| Driver | Pros | Cons |
|--------|------|------|
| `docker` (default) | Simple, isolated | Extra container layer |
| `none` (bare-metal) | Best GPU/memory performance | Requires root, more setup |

For **heavy GPU workloads**, consider bare-metal mode:

```bash
# Advanced: Maximum performance (requires root)
sudo minikube start --driver=none --gpus=all
```

This removes one virtualization layer and improves:
- PCIe/GPU throughput
- Memory bandwidth
- Stability under sustained load

> ⚠️ `--driver=none` runs Kubernetes directly on the host. Use only on dedicated inference machines.

#### Verify GPU Passthrough

```bash
# Test GPU visibility inside minikube
kubectl run gpu-test \
  --image=nvidia/cuda:13.1.0-runtime-ubuntu24.04 \
  --restart=Never \
  -- nvidia-smi

# Wait for pod to complete
kubectl wait --for=condition=Ready pod/gpu-test --timeout=60s 2>/dev/null || true
sleep 5

# Check logs
kubectl logs gpu-test

# Cleanup
kubectl delete pod gpu-test
```

You should see GB10 GPU info in the logs.

---

### 8. Install NVIDIA Device Plugin

```bash
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.0/deployments/static/nvidia-device-plugin.yml

# Wait for device plugin to be ready
kubectl wait --for=condition=ready pod -l name=nvidia-device-plugin-ds -n kube-system --timeout=120s

# Verify GPU is allocatable (may take 30-60 seconds)
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'
```

> **Expected Output**: `"1"` 
> 
> **Note**: GPU count will register correctly, but memory metrics may not be available. This is a known GB10 limitation — the GPU still works for CUDA workloads.

---

### 9. Install KServe Stack

```bash
# Install cert-manager
helm repo add jetstack https://charts.jetstack.io --force-update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --wait --timeout 300s

# Verify cert-manager
kubectl get pods -n cert-manager

# Install KServe
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.14.1/kserve.yaml
kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.14.1/kserve-cluster-resources.yaml

# Wait for KServe controller
kubectl wait --for=condition=ready pod \
  -l control-plane=kserve-controller-manager \
  -n kserve --timeout=300s

# Verify KServe CRD
kubectl get crd inferenceservices.serving.kserve.io
```

---

### 10. Verify Cluster GPU Access

```bash
# Cluster info
kubectl cluster-info

# GPU allocatable on nodes
kubectl describe nodes | grep -A5 "Allocatable:" | grep nvidia

# KServe controller running
kubectl get pods -n kserve
```

---

## Model Weight Caching (Critical for Scaling)

Without shared storage, **each pod re-downloads model weights** on startup. This kills:
- Cold start time (minutes instead of seconds)
- Autoscaling effectiveness
- Network bandwidth

### Create Shared Hugging Face Cache PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: hf-cache
  namespace: llm
spec:
  accessModes:
    - ReadWriteMany   # RWX required for multi-pod access
  resources:
    requests:
      storage: 200Gi  # Adjust based on model sizes
  # storageClassName: local-path  # Uncomment for minikube local storage
```

Apply:

```bash
kubectl create namespace llm 2>/dev/null || true
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: hf-cache
  namespace: llm
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 200Gi
EOF
```

> **Impact**: Scaling latency drops from **minutes → seconds** after first pod downloads weights.

> **Key Insight:** The first pod pays the download cost. Every other pod should start in **seconds**, not minutes. If not, your PVC is misconfigured.

### Verify PVC Configuration

```bash
kubectl describe pvc hf-cache -n llm
```

Check:
```
Access Modes: RWX
Status: Bound
```

> ⚠️ **Most scaling failures = storage class silently not supporting RWX.** Minikube's default storage class may not support RWX — you may need to use `local-path` or NFS.

### Mount Cache in vLLM Pod

Add these environment variables and volume mounts to your InferenceService:

```yaml
env:
  - name: HF_HOME
    value: /models/hf
  - name: TRANSFORMERS_CACHE
    value: /models/hf
  - name: HF_HUB_CACHE
    value: /models/hf/hub
volumeMounts:
  - name: hf-cache
    mountPath: /models/hf
volumes:
  - name: hf-cache
    persistentVolumeClaim:
      claimName: hf-cache
```

> ⚠️ **Critical for Autoscaling:** Without RWX shared cache, **HPA/KEDA scaling becomes useless** because new replicas spend minutes downloading weights instead of serving traffic.

---

## Deploy LLM

### 11. Choose Profile

For DGX Spark, use the dedicated `dgx_spark_gpu` profile:

| Profile | Target Hardware | GPU Memory | Model |
|---------|-----------------|------------|-------|
| `dgx_spark_gpu` | **DGX Spark (GB10)** | Unified 128GB | Qwen2.5-7B |
| `dgx_cloud_gpu` | A100 / H100 datacenter | 40-80GB | Qwen2.5-7B |
| `mid_range_gpu` | RTX 3090 / 4090 | 24GB+ | Qwen2.5-1.5B |
| `cpu_fallback` | No GPU | N/A | Qwen2.5-0.5B |

> **Model Recommendations for GB10**:
> - **3-7B models**: Native FP16, no quantization needed
> - **13B models**: Native FP16 or optional INT8
> - **30-34B models**: Requires AWQ/GPTQ INT4 quantization
> - **70B+ models**: Too large for single GB10 — requires multi-node

Preview deployment:

```bash
python -m orchestrator.cli \
  --profile dgx_spark_gpu \
  --release my-llm \
  --namespace llm \
  --dry-run
```

---

### 12. Set Up Hugging Face Token (If Using Gated Models)

```bash
# For gated models like Llama, Mistral, etc.
kubectl create namespace llm 2>/dev/null || true

kubectl create secret generic hf-token -n llm \
  --from-literal=HF_TOKEN=your_huggingface_token_here
```

---

### 13. Deploy

```bash
python -m orchestrator.cli \
  --profile dgx_spark_gpu \
  --release my-llm \
  --namespace llm
```

---

### 14. Monitor Deployment

```bash
# Watch pod status
kubectl get pods -n llm -w

# Check GPU allocation in pod
kubectl describe pod -n llm -l serving.kserve.io/inferenceservice=my-llm | grep -A3 "Limits:"

# Stream vLLM logs
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm -f --tail=100

# Check InferenceService status
kubectl get inferenceservice -n llm
```

---

## Pod Resource Tuning (Critical for Throughput)

vLLM is **CPU hungry** for tokenization and request scheduling. Default KServe CPU requests are often too small, causing:
- Scheduler starvation
- Throughput collapse before GPU saturates

### Recommended Resources for DGX Spark

```yaml
resources:
  requests:
    cpu: "12"
    memory: "48Gi"
    nvidia.com/gpu: 1
  limits:
    cpu: "24"
    memory: "96Gi"
    nvidia.com/gpu: 1
```

### Readiness & Liveness Probes (Reliability)

vLLM can take **2–6 minutes** to load large models. Without proper probes, Kubernetes may kill the pod prematurely.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 120   # Wait for model load
  periodSeconds: 10
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 300   # Long grace period for large models
  periodSeconds: 20
  failureThreshold: 5
```

### Expected Startup Times

Operators panic when pods take minutes — this is normal for LLMs:

| Model Size | Normal Startup Time | With Warm Cache |
|------------|---------------------|------------------|
| 7B | 1–2 min | 30–60 sec |
| 13B | 2–4 min | 1–2 min |
| 30B INT4 | 4–6 min | 2–3 min |
| 70B INT4 | 8–12 min | 4–6 min |

> If startup exceeds **8–10 minutes for a 7B model** → image pull or cache issue, not vLLM.

### Cold Start Chain

Understanding what happens during startup helps debug scale-up delays:

```
Image pull (minutes if not cached)
    ↓
Container start (~10 sec)
    ↓
Model weight load (depends on cache + model size)
    ↓
CUDA graph/kernel compile (~30 sec)
    ↓
First request warmup (~5 sec)
```

If cache + image are warm, only last 2 steps remain → startup in seconds.

### Node Affinity (Multi-Node Safety)

Even on single-node, add node selectors to prevent accidental CPU-only scheduling:

```yaml
nodeSelector:
  nvidia.com/gpu.present: "true"
  kubernetes.io/arch: arm64
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
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "messages": [{"role": "user", "content": "Explain the Grace Blackwell architecture in one sentence."}],
    "max_tokens": 100
  }'
```

---

## Scaling Considerations

### ⚠️ Model Parallelism Awareness (Critical)

GB10 has massive unified memory, but **compute is still a single GPU**. When scaling replicas blindly:
- GPU context thrashing occurs
- CUDA memory fragmentation increases
- Total throughput **decreases**

> **DGX Spark Rule:** Prefer **vertical scaling (bigger single pod)** before horizontal scaling (more pods).
> Multiple vLLM replicas compete for the *same physical GPU* and often reduce total throughput.

| Situation | Better Choice |
|-----------|---------------|
| One busy model | **1 large pod**, high batching |
| Many small models | Multiple pods (model isolation) |
| Latency-sensitive app | Smaller batching, maybe 2 pods |
| Max throughput | 1 pod, aggressive batching |

### Two Types of Scaling

| Type | What You Change | Helps With | Cost |
|------|-----------------|------------|------|
| **Vertical (in-pod)** | `--max-num-seqs`, batching, CPU | Throughput | Slight latency |
| **Horizontal (replicas)** | More pods | Availability / isolation | GPU contention |

> **DGX Spark Priority Order:**
> 1. Increase batching (`--max-num-seqs`, `--max-num-batched-tokens`)
> 2. Increase CPU limits
> 3. Tune tokenizer threads (`--tokenizer-pool-size`)
> 4. *Only then* consider more replicas

### When a Second Replica *Does* Make Sense

**Good reasons for 2 replicas on GB10:**
- Two different models (isolation)
- One long-context + one short-context workload
- Isolation between realtime vs batch jobs
- Rolling upgrades without downtime

**Bad reason:**
- "GPU isn't at 100%" → Usually batching or CPU config is wrong

### GPU Metrics Are Unreliable on GB10

Due to unified memory, standard GPU utilization and memory metrics from NVML don't work correctly. **Do not use**:
- GPU memory-based HPA
- GPU utilization autoscaling
- DCGM exporter metrics for scaling decisions

### ❌ Never Scale On These Signals

| Metric | Why It's Wrong on GB10 |
|--------|------------------------|
| `nvidia_smi_memory_used` | Returns "Not Supported" |
| DCGM framebuffer memory | Unreliable with unified memory |
| GPU memory percentage | Doesn't reflect KV cache growth |
| GPU utilization alone | Doesn't show memory bandwidth saturation |

These metrics do not reflect KV cache growth or unified memory paging behavior.

### ✅ Recommended: Request-Based Scaling

Scale on workload pressure, not GPU telemetry:

| Metric | Source | Description |
|--------|--------|-------------|
| `vllm:num_requests_running` | vLLM Prometheus | Active requests being processed |
| `vllm:num_requests_waiting` | vLLM Prometheus | Queue length |
| Request concurrency | KServe | Concurrent requests per pod |
| Tokens per second | vLLM metrics | Throughput indicator |

### Scaling Options for DGX Spark

| Approach | Complexity | Use Case |
|----------|------------|----------|
| **Single vLLM Pod** | Low | Single model < 30B, moderate traffic |
| **Multiple Pods (different models)** | Medium | Multi-model serving |
| **KServe + KEDA** | Medium | Auto-scale on request queue |
| **Ray + vLLM** | High | Multi-node for 70B+ models |

### Concurrency vs Replica Math

Don't guess replicas — calculate them:

```
Required replicas ≈ (Peak RPS × Avg Generation Time) / Max Concurrent Seqs Per Pod
```

**Example:**
- 20 requests per second
- 2 second average generation time
- 128 max sequences per pod (`--max-num-seqs 128`)

→ `(20 × 2) / 128 = 0.31` → **1 pod is enough**

**Safety Rules:**
- If result < 1 → **1 pod**
- If result 1–1.5 → **still 1 pod** (increase batching instead)
- Only exceed 1 when **sustained** queue pressure exists

This prevents massive over-scaling and wasted GPU contention.

### Prerequisites for KEDA Scaling

> ⚠️ **Important**: KEDA does **not** scrape metrics itself — it queries Prometheus. You must install Prometheus first.

```bash
# Install Prometheus stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false

# Install KEDA
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda -n keda --create-namespace
```

### Configure vLLM Metrics Scraping

vLLM exposes Prometheus metrics on `/metrics`. Create a ServiceMonitor:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: vllm-metrics
  namespace: llm
spec:
  selector:
    matchLabels:
      serving.kserve.io/inferenceservice: my-llm
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

### Example: KEDA ScaledObject for Request-Based Scaling

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: vllm-scaler
  namespace: llm
spec:
  scaleTargetRef:
    name: my-llm-predictor
  minReplicaCount: 1
  maxReplicaCount: 3
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        metricName: vllm_num_requests_waiting
        threshold: "10"
        query: sum(vllm_num_requests_waiting{namespace="llm"})
```

> **⚠️ Replica Safety Rule for Single GB10**
>
> ```yaml
> maxReplicaCount: 2   # Rarely beneficial to exceed on one GPU
> ```
>
> Why:
> - CUDA context switching overhead
> - L2 / memory bandwidth contention  
> - KV cache fragmentation across processes
>
> **More pods ≠ more tokens/sec on one GPU.**

### Better Autoscaling Signal: Queue Pressure Ratio

Queue length alone is noisy. A stronger signal is **waiting vs running ratio**:

```promql
sum(vllm_num_requests_waiting) / (sum(vllm_num_requests_running) + 1)
```

| Ratio | Meaning | Action |
|-------|---------|--------|
| < 0.5 | System healthy | No scale |
| 0.5 – 1.5 | Building pressure | Consider scale |
| > 2 | Saturated | Scale up (if CPU/GPU already tuned) |

This avoids scaling on short spikes.

### Realistic KEDA Thresholds

| Traffic Type | Queue Threshold | Why |
|--------------|-----------------|-----|
| Low latency chat | 2–5 | Minimize wait time |
| Balanced workloads | 10 | Good default |
| Batch / async jobs | 25–50 | Maximize throughput |

### Graceful Scale Down (Prevent Request Drops)

When pods scale down during load, active requests can be killed. Add termination grace:

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120
      containers:
        - name: kserve-container
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "60"]
```

This gives vLLM time to finish in-flight requests before termination.

### Scale-Down Stabilization Window

Without this, KEDA may scale down during temporary lulls and kill warm pods:

```yaml
advanced:
  horizontalPodAutoscalerConfig:
    behavior:
      scaleDown:
        stabilizationWindowSeconds: 300
```

This prevents:
- Model reload loops
- Repeated cold starts
- Cache churn

### Pod Anti-Affinity (Multi-Node Clusters)

If you expand to multi-node DGX Spark cluster, prevent GPU pods stacking on same node:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: kubernetes.io/hostname
          labelSelector:
            matchLabels:
              serving.kserve.io/inferenceservice: my-llm
```

---

## vLLM Optimization Flags for GB10

The `dgx_spark_gpu` profile uses these optimized flags:

```yaml
vllm_flags: "--gpu-memory-utilization 0.85 --max-model-len 32768 --enforce-eager"
```

| Flag | Purpose |
|------|---------|
| `--gpu-memory-utilization 0.85` | Leave headroom for unified memory overhead |
| `--max-model-len 32768` | Reasonable context length for 7B models |
| `--enforce-eager` | Disable CUDA graphs (more stable on new architectures) |

### KV Cache as a Scaling Constraint

On unified memory systems, KV cache growth can become the *hidden limiter* before compute.

```bash
--kv-cache-dtype auto
--gpu-memory-utilization 0.85
```

> **Warning:** Larger `--max-model-len` × higher concurrency = exponential KV cache growth.
> If latency suddenly spikes under load, you may be **memory-bandwidth bound**, not compute bound.

| Context Length | Max Concurrent Seqs | Approx KV Cache (7B FP16) |
|----------------|---------------------|---------------------------|
| 4K | 256 | ~8 GB |
| 16K | 128 | ~16 GB |
| 32K | 64 | ~16 GB |
| 64K | 32 | ~16 GB |

Tune these together to avoid sudden memory pressure.

### Throughput vs Latency Tuning

For scaling, **concurrency tuning matters more than replicas** on single-node DGX Spark. Scale vertically before horizontally.

| Goal | Key Flags | Effect |
|------|-----------|--------|
| Higher concurrency | `--max-num-seqs 256` | More parallel requests |
| Better batching | `--max-num-batched-tokens 32768` | Higher throughput |
| Lower latency | Reduce both above | Faster individual responses |
| Memory safety | `--gpu-memory-utilization 0.80` | Leave headroom for spikes |

### Additional Flags for Specific Use Cases

```bash
# For longer context (64K)
--max-model-len 65536 --gpu-memory-utilization 0.80

# For maximum throughput (high concurrency)
--max-num-seqs 256 --max-num-batched-tokens 32768

# For low latency (interactive use)
--max-num-seqs 32 --max-num-batched-tokens 4096

# For quantized models (AWQ/GPTQ)
--quantization awq
```

### Continuous Batching Tuning for Scale

For high concurrency workloads, these flags matter more than replica count:

```bash
--max-num-seqs 256
--max-num-batched-tokens 32768
--scheduler-delay-factor 0.2
```

**Why this matters on GB10:**
- Unified memory removes classic VRAM ceiling
- Bottleneck becomes **scheduler + CPU tokenization**
- These flags directly increase GPU utilization

> **Throughput scaling on DGX Spark is primarily achieved by increasing vLLM batching, not pod replicas.**

### Model Warmup (Avoid First-Request Latency)

After deployment, send a warmup request to pre-compile CUDA kernels:

```bash
# Warmup request after pod is ready
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen/Qwen2.5-7B-Instruct", "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 1}'
```

This prevents first-request latency spikes in production.

---

## CPU Bottleneck Detection (Critical for Scaling)

Grace CPU is powerful, but **vLLM is extremely CPU heavy** at high QPS for tokenization and scheduling.

> **Rule:** If CPU throttling > 10% → scale vertically, not horizontally

### Detect CPU Bottleneck

```bash
kubectl top pod -n llm
```

Or via Prometheus:

```promql
rate(container_cpu_cfs_throttled_seconds_total{namespace="llm"}[1m])
```

On Grace CPUs, tokenizer + scheduler threads are often the **first wall**, not GPU.

**Symptoms:**
- CPU is pegged at limits
- GPU utilization <70%
- Latency increases but queue doesn't grow

→ **You are CPU bound, not GPU bound.**

### Fix CPU Bottleneck

**Option 1:** Increase CPU limits before adding replicas:

```yaml
resources:
  limits:
    cpu: "32"
    memory: "128Gi"
```

**Option 2:** Tune tokenizer thread pool (HIGH ROI on Grace CPU):

```bash
--tokenizer-pool-size 8
```

| Value | Effect |
|-------|--------|
| Too low (1-2) | GPU sits idle waiting for tokens |
| Too high (16+) | CPU thrash, context switching |
| **Sweet spot (6-10)** | Optimal on Grace ARM64 |

This is one of the highest ROI tweaks on ARM CPUs.

**Option 3:** Use faster tokenizer:

```bash
--tokenizer-mode auto  # Uses Rust tokenizer when available
```

> **Rule:** If GPU utilization <70%, do **not** add replicas — fix CPU or increase batching first.

---

## Image Pull & Cold Start Optimization

At scale, **image pull time becomes a bottleneck** for new replicas.

### Pre-pull vLLM Image on Node

```bash
# Pre-pull to avoid cold start delays
minikube ssh -- docker pull nvcr.io/nvidia/vllm:v0.7.0
```

Prevents new replicas waiting minutes to start during autoscale events.

### For Multi-Node Clusters

Use a DaemonSet to pre-pull on all nodes:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: image-prepull
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: image-prepull
  template:
    metadata:
      labels:
        name: image-prepull
    spec:
      initContainers:
        - name: prepull
          image: nvcr.io/nvidia/vllm:v0.7.0
          command: ["echo", "Image pulled"]
      containers:
        - name: pause
          image: gcr.io/google_containers/pause:3.2
```

---

## Page Cache Tuning (Unified Memory Gotcha)

GB10 unified memory means Linux page cache can compete with CUDA allocations.

### Recommended Kernel Parameters

```bash
# Add to /etc/sysctl.conf or /etc/sysctl.d/99-vllm.conf
vm.swappiness=10
vm.dirty_ratio=10
vm.dirty_background_ratio=5
```

Apply:

```bash
sudo sysctl -p
```

**Why:** Prevents sudden stalls when the kernel starts reclaiming memory aggressively under load. Critical for consistent latency at high QPS.

---

## Golden Signals Dashboard (Not GPU Util)

These are the metrics that actually matter for scaling decisions:

| Metric | Healthy | Bad | Meaning |
|--------|---------|-----|---------|  
| `vllm_num_requests_waiting` | ~0 | Growing | Need more concurrency |
| P95 latency | Stable | Climbing | Saturation |
| CPU usage | <85% | 100% | CPU bound |
| GPU util | 70–90% | <60% | Under-batched |
| GPU util | 95–100% | + latency | GPU saturated |
| Queue ratio (waiting/running) | <0.5 | >2 | Scale trigger |

> **Focus on these signals, not unreliable GPU memory telemetry.**

---

## Troubleshooting

### OOM vs Throttle: Two Failure Modes That Look Similar

| Symptom | Cause | Fix |
|---------|-------|-----|
| Pod restarts repeatedly | OOMKill | Reduce `--max-model-len` or `--max-num-seqs` |
| Latency spikes, no restarts | CPU throttling | Increase CPU limits |
| Sudden latency wall at high QPS | Memory bandwidth | Reduce concurrency |
| First request very slow | No warmup | Send warmup request post-deploy |

Check which one you're hitting:

```bash
# OOMKill?
kubectl describe pod <pod> -n llm | grep -i oom

# CPU throttling?
kubectl describe pod <pod> -n llm | grep -i throttle
```

This saves hours of wrong-direction tuning.

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `nvidia-smi` shows "Not Supported" for memory | Normal for GB10 unified memory | GPU still works — ignore this |
| Device plugin shows "No devices found" | k3d doesn't pass NVML correctly | Use minikube instead of k3d |
| Pod stuck in Pending | GPU not allocatable | Check `kubectl get nodes -o json \| jq '.items[].status.allocatable'` |
| vLLM OOM errors | Model too large or context too long | Reduce `--max-model-len` or use quantization |
| Image pull errors | ARM64 image not available | Use `nvcr.io/nvidia/vllm` (multi-arch) |

### Debug Commands

```bash
# Check device plugin logs
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds --tail=50

# Check if GPU is allocatable
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'

# Test GPU in standalone container
docker run --rm --gpus all nvidia/cuda:13.1.0-runtime-ubuntu24.04 nvidia-smi

# Check minikube GPU passthrough
minikube ssh -- nvidia-smi

# Check vLLM container logs for errors
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm --tail=100
```

### Device Plugin Issue on GB10

If you see errors like:
```
error getting device memory: Not Supported
```

This is a known limitation (see [NVIDIA/k8s-device-plugin#1482](https://github.com/NVIDIA/k8s-device-plugin/issues/1482)). The GPU will still be allocated and work for CUDA workloads. The device plugin just can't query memory metrics.

**Workaround**: Deploy vLLM anyway — it uses CUDA directly and doesn't rely on NVML memory queries at runtime.

---

## Cleanup

```bash
# Remove deployment
helm uninstall my-llm -n llm 2>/dev/null || true
kubectl delete inferenceservice my-llm -n llm 2>/dev/null || true
kubectl delete ns llm

# Remove KServe
kubectl delete -f https://github.com/kserve/kserve/releases/download/v0.14.1/kserve.yaml
kubectl delete -f https://github.com/kserve/kserve/releases/download/v0.14.1/kserve-cluster-resources.yaml

# Remove cert-manager
helm uninstall cert-manager -n cert-manager
kubectl delete ns cert-manager

# Delete minikube cluster
minikube delete
```

---

## Quick Validation Checklist

```bash
# 1. Driver working
nvidia-smi

# 2. Docker + GPU
docker run --rm --gpus all nvidia/cuda:13.1.0-runtime-ubuntu24.04 nvidia-smi

# 3. Minikube cluster running
kubectl get nodes

# 4. GPU allocatable in cluster
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'

# 5. Device plugin running
kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds

# 6. KServe ready
kubectl get pods -n kserve

# 7. vLLM pod running
kubectl get pods -n llm
```

---

## Alternative: Docker-Only Deployment (No Kubernetes)

For rapid testing or if Kubernetes setup is problematic, run vLLM directly in Docker:

```bash
docker run --gpus all \
  -p 8000:8000 \
  -e HF_TOKEN=$(cat ~/.cache/huggingface/token 2>/dev/null || echo "") \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  --ipc=host \
  nvcr.io/nvidia/vllm:v0.7.0 \
  vllm serve Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.85 \
  --max-model-len 32768 \
  --trust-remote-code
```

Test with:
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## DGX Spark Scaling Truths

These hard-won lessons will save you hours of debugging:

| Truth | Implication |
|-------|-------------|
| GPU memory is **not** your first bottleneck | CPU and batching are — check `kubectl top pod` |
| 1 well-tuned vLLM pod often beats 3 small replicas | Vertical scaling > horizontal on single GPU |
| Scaling replicas without shared model cache = fake scaling | New pods wait minutes downloading weights |
| If GPU utilization <70%, do **not** add replicas | Increase batching or fix CPU limits first |
| If latency spikes but GPU is low | You are CPU bound — increase CPU limits |
| Horizontal scaling helps **availability** | Vertical tuning helps **throughput** |

### Decision Tree: When to Scale

```
[High latency / queue growing]
        ↓
[Check GPU utilization: kubectl top pod]
        ↓
    ┌───┴───┐
   <70%    >70%
    ↓        ↓
 CPU bound   GPU saturated
    ↓        ↓
 Increase    Add replica
 CPU limits  (with shared cache!)
 or batching
```

> **Bottom Line:** On DGX Spark, scaling performance comes from smarter batching and CPU tuning — not from adding pods.

---

## Optional Enhancements

| Feature | Why It Matters |
|---------|----------------|
| **DCGM exporter** | GPU temps & power monitoring (metrics still useful even if memory isn't) |
| **Grace CPU NUMA pinning** | Extreme tuning for memory-bound workloads |
| **Model warmup request** | Avoid first-request latency spike (see above) |
| **Ray + vLLM sharding** | Future multi-DGX Spark scaling for 70B+ models |

### DCGM Exporter (Monitoring Only)

Even though GPU memory metrics are unreliable, temperature and power metrics work:

```bash
helm repo add gpu-helm-charts https://nvidia.github.io/dcgm-exporter/helm-charts
helm install dcgm-exporter gpu-helm-charts/dcgm-exporter -n monitoring
```

Useful Grafana dashboards:
- GPU temperature trends
- Power consumption
- SM (streaming multiprocessor) utilization

---

## Operator Quick Commands Cheat Sheet

Keep these handy for 2AM debugging:

```bash
# Is GPU actually busy?
kubectl top pod -n llm

# Is queue building?
kubectl logs -n llm -l serving.kserve.io/inferenceservice=my-llm --tail=50 | grep -i "waiting\|queue"

# Is CPU throttling?
kubectl describe pod -n llm -l serving.kserve.io/inferenceservice=my-llm | grep -i throttle

# Are models cached?
kubectl exec -n llm $(kubectl get pod -n llm -l serving.kserve.io/inferenceservice=my-llm -o jsonpath='{.items[0].metadata.name}') -- ls -la /models/hf 2>/dev/null || echo "Cache not mounted"

# Is PVC bound correctly?
kubectl get pvc -n llm

# What's the current replica count?
kubectl get deployment -n llm

# Check vLLM internal metrics
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
curl -s http://localhost:8000/metrics | grep -E "vllm_num_requests|vllm_gpu"

# Get KServe InferenceService status
kubectl get inferenceservice -n llm -o wide

# Emergency: Force restart pod
kubectl delete pod -n llm -l serving.kserve.io/inferenceservice=my-llm
```

---

## References

- [NVIDIA DGX Spark Documentation](https://docs.nvidia.com/dgx/)
- [vLLM Documentation](https://docs.vllm.ai/)
- [KServe Documentation](https://kserve.github.io/website/)
- [Minikube GPU Support](https://minikube.sigs.k8s.io/docs/tutorials/nvidia/)
- [NVIDIA k8s-device-plugin GB10 Issue #1482](https://github.com/NVIDIA/k8s-device-plugin/issues/1482)
- [NVIDIA Forums: DGX Spark + Minikube](https://forums.developer.nvidia.com/t/local-k8s-cluster-with-minikube-on-nvidia-dgx-spark/356043)
