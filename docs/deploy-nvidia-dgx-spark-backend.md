# Backend Deployment Guide: NVIDIA DGX Spark

> **Platform**: NVIDIA DGX Spark (Grace ARM64 + GB10 GPU)  
> **Component**: FastAPI Orchestrator Backend  
> **Last Updated**: February 2026

This guide covers deploying the MLOps Orchestrator backend (FastAPI) on NVIDIA DGX Spark systems.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Environment Setup](#environment-setup)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Running the Backend](#running-the-backend)
7. [Production Deployment](#production-deployment)
8. [API Reference](#api-reference)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | Grace ARM64 (aarch64) | 20+ cores |
| RAM | 16 GB | 32+ GB |
| Disk | 50 GB free | 100+ GB SSD |

### Software Requirements

```bash
# Verify DGX Spark environment
uname -m                    # Should show: aarch64
cat /etc/os-release         # Ubuntu 24.04+
nvidia-smi                  # Driver 590+
```

| Tool | Version | Check Command |
|------|---------|---------------|
| Python | 3.11+ | `python3 --version` |
| pip | 23+ | `pip3 --version` |
| Docker | 24+ | `docker --version` |
| kubectl | 1.29+ | `kubectl version --client` |
| Helm | 3.14+ | `helm version` |

---

## Quick Start

```bash
# Clone and navigate to repository
cd /path/to/llm-inference-runtime

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r orchestrator/requirement-prod.txt
pip install "fastapi[all]" "uvicorn[standard]"

# Start the backend (from repository root)
uvicorn orchestrator.api.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend available at: http://localhost:8000

---

## Environment Setup

### Step 1: Create Python Virtual Environment

```bash
# Create isolated environment
python3 -m venv .venv

# Activate
source .venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel
```

### Step 2: Install System Dependencies

```bash
# Required for some Python packages on ARM64
sudo apt update
sudo apt install -y python3-dev build-essential libffi-dev libssl-dev
```

### Step 3: Verify NVIDIA Tools (Optional but Recommended)

```bash
# The backend uses these for hardware detection
which nvidia-smi && nvidia-smi -L
which nvidia-ctk && nvidia-ctk --version
which docker && docker info | grep -i nvidia
```

---

## Installation

### Production Dependencies

```bash
# From repository root
pip install -r orchestrator/requirement-prod.txt

# FastAPI and ASGI server (not in prod requirements)
pip install "fastapi[all]>=0.100.0" "uvicorn[standard]>=0.23.0"

# Optional: Keyring for credential storage
pip install keyring secretstorage
```

### Development Dependencies

```bash
# Includes testing, linting, type checking
pip install -r orchestrator/requirement-dev.txt
```

### Verify Installation

```bash
python3 -c "
from orchestrator.api.main import create_app
from orchestrator.platform import PlatformDetector, DGXSparkAdapter

app = create_app()
print(f'✅ FastAPI app created: {app.title}')

# Test DGX Spark detection
from orchestrator.api.platform_routes import router  # Registers adapters
adapter = PlatformDetector.detect()
print(f'✅ Platform detected: {adapter.platform_name if adapter else \"None\"}')
"
```

---

## Configuration

### Environment Variables

Create a `.env` file or export these variables:

```bash
# .env file
# Server Configuration
HOST=0.0.0.0
PORT=8000
LOG_LEVEL=INFO
RELOAD=false  # Set true for development

# Paths
PROFILES_PATH=/path/to/profiles.yaml
CHARTS_PATH=/path/to/charts/llm-vllm

# Security (Production)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
SECRET_KEY=your-secret-key-here

# Kubernetes
KUBECONFIG=${HOME}/.kube/config
```

### Load Environment Variables

```bash
# Option 1: Export directly
export HOST=0.0.0.0
export PORT=8000

# Option 2: Use python-dotenv
pip install python-dotenv
```

### profiles.yaml Configuration

The backend reads deployment profiles from `profiles.yaml`. Ensure the DGX Spark profile exists:

```yaml
# profiles.yaml (already configured)
profiles:
  dgx_spark_gpu:
    description: "NVIDIA DGX Spark with GB10 GPU and Grace ARM64 CPU"
    thresholds:
      arch: "aarch64"
      gpu: true
      gpu_model: "GB10"
    model: "Qwen/Qwen2.5-7B-Instruct"
    image: "nvcr.io/nvidia/vllm:v0.7.0"
    gpu_count: 1
    resources:
      cpu_request: "12"
      cpu_limit: "24"
      mem_request: "48Gi"
      mem_limit: "96Gi"
    vllm_flags: "--gpu-memory-utilization 0.85 --max-model-len 32768 --enforce-eager"
```

---

## Running the Backend

### Development Mode

```bash
cd /path/to/llm-inference-runtime

# Activate virtual environment
source .venv/bin/activate

# Run with hot reload
uvicorn orchestrator.api.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --reload-dir orchestrator
```

### Production Mode

```bash
# Production with multiple workers
uvicorn orchestrator.api.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 4 \
  --log-level info
```

### Using Gunicorn (Recommended for Production)

```bash
# Install gunicorn with uvicorn workers
pip install gunicorn

# Run with Gunicorn
gunicorn orchestrator.api.main:app \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --access-logfile - \
  --error-logfile -
```

### Verify Backend is Running

```bash
# Health check
curl http://localhost:8000/health
# Expected: {"status":"healthy"}

# Platform detection
curl http://localhost:8000/api/v1/platform/detect
# Expected: {"platform_name":"linux_dgx_spark",...}

# List profiles
curl http://localhost:8000/api/v1/deploy/profiles
```

---

## Production Deployment

### Option 1: Systemd Service

Create `/etc/systemd/system/mlops-orchestrator.service`:

```ini
[Unit]
Description=MLOps Orchestrator Backend
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=mlops
Group=mlops
WorkingDirectory=/opt/llm-inference-runtime
Environment="PATH=/opt/llm-inference-runtime/.venv/bin"
ExecStart=/opt/llm-inference-runtime/.venv/bin/gunicorn \
  orchestrator.api.main:app \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --access-logfile /var/log/mlops/access.log \
  --error-logfile /var/log/mlops/error.log
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mlops-orchestrator
sudo systemctl start mlops-orchestrator
sudo systemctl status mlops-orchestrator
```

### Option 2: Docker Container

Create `Dockerfile.backend`:

```dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for caching
COPY orchestrator/requirement-prod.txt ./
RUN pip install --no-cache-dir -r requirement-prod.txt \
    && pip install --no-cache-dir "fastapi[all]" "uvicorn[standard]" gunicorn

# Copy application code
COPY orchestrator/ ./orchestrator/
COPY profiles.yaml ./
COPY charts/ ./charts/

# Expose port
EXPOSE 8000

# Run with gunicorn
CMD ["gunicorn", "orchestrator.api.main:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker"]
```

Build and run:

```bash
# Build for ARM64
docker build -f Dockerfile.backend -t mlops-backend:latest .

# Run container
docker run -d \
  --name mlops-backend \
  -p 8000:8000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ${HOME}/.kube:/root/.kube:ro \
  mlops-backend:latest
```

### Option 3: Kubernetes Deployment

```yaml
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mlops-orchestrator
  namespace: mlops
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mlops-orchestrator
  template:
    metadata:
      labels:
        app: mlops-orchestrator
    spec:
      containers:
      - name: backend
        image: mlops-backend:latest
        ports:
        - containerPort: 8000
        env:
        - name: KUBECONFIG
          value: /root/.kube/config
        volumeMounts:
        - name: kubeconfig
          mountPath: /root/.kube
          readOnly: true
        resources:
          requests:
            cpu: "2"
            memory: "2Gi"
          limits:
            cpu: "4"
            memory: "4Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 10
      volumes:
      - name: kubeconfig
        secret:
          secretName: kubeconfig
---
apiVersion: v1
kind: Service
metadata:
  name: mlops-orchestrator
  namespace: mlops
spec:
  selector:
    app: mlops-orchestrator
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP
```

---

## API Reference

### Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/v1/platform/detect` | Detect current platform |
| GET | `/api/v1/platform/hardware` | Probe hardware capabilities |
| GET | `/api/v1/platform/feasibility` | Get feasibility for profiles |
| GET | `/api/v1/deploy/profiles` | List available profiles |
| GET | `/api/v1/deploy/profiles/{name}` | Get specific profile |
| POST | `/api/v1/deploy/preflight` | Run pre-flight checks |
| POST | `/api/v1/deploy/deploy` | Deploy a model |
| WS | `/api/v1/deploy/ws/deploy` | WebSocket for deploy progress |
| GET | `/api/v1/credentials/status` | Check credential status |
| POST | `/api/v1/credentials/huggingface/setup` | Set HuggingFace token |
| GET | `/api/v1/lifecycle/resources` | List deployed resources |

### OpenAPI Documentation

Access interactive API docs at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI JSON: http://localhost:8000/openapi.json

---

## Troubleshooting

### Common Issues

#### 1. Import Errors

```bash
# Error: ModuleNotFoundError: No module named 'orchestrator'
# Solution: Run from repository root or set PYTHONPATH
export PYTHONPATH=/path/to/llm-inference-runtime:$PYTHONPATH
```

#### 2. Port Already in Use

```bash
# Error: [Errno 98] Address already in use
# Solution: Kill existing process or use different port
lsof -i :8000
kill -9 <PID>

# Or use different port
uvicorn orchestrator.api.main:app --port 8001
```

#### 3. Kubernetes Connection Failed

```bash
# Error: Unable to connect to the server
# Solution: Verify kubeconfig
kubectl cluster-info
export KUBECONFIG=${HOME}/.kube/config
```

#### 4. Platform Not Detected as DGX Spark

```bash
# Verify detection manually
python3 -c "
from orchestrator.platform.linux_dgx_spark import DGXSparkAdapter
adapter = DGXSparkAdapter()
print('Detected:', adapter.detect())
print('Platform:', adapter.platform_name)
"
```

#### 5. HuggingFace Token Issues

```bash
# Check if keyring is available
python3 -c "import keyring; print('Keyring available')"

# If not, install:
pip install keyring secretstorage

# Or use environment variable fallback
export HF_TOKEN=hf_your_token_here
```

### Logs and Debugging

```bash
# Enable debug logging
LOG_LEVEL=DEBUG uvicorn orchestrator.api.main:app --log-level debug

# View systemd logs
sudo journalctl -u mlops-orchestrator -f

# Docker logs
docker logs -f mlops-backend
```

### Health Checks

```bash
# Full system check
curl -s http://localhost:8000/api/v1/platform/detect | python3 -m json.tool
curl -s http://localhost:8000/api/v1/platform/hardware | python3 -m json.tool
curl -s http://localhost:8000/api/v1/credentials/status | python3 -m json.tool
```

---

## Next Steps

1. **Deploy Frontend**: See [deploy-nvidia-dgx-spark-frontend.md](deploy-nvidia-dgx-spark-frontend.md)
2. **Configure Credentials**: Use the wizard or API to set HuggingFace token
3. **Deploy Models**: Use the `/api/v1/deploy/deploy` endpoint or wizard
4. **Monitor Resources**: Check `/api/v1/lifecycle/resources`

---

## References

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Uvicorn Documentation](https://www.uvicorn.org/)
- [Main DGX Spark Setup Guide](deploy-llm-setup-nvidia-dgx-spark-gpu.md)
