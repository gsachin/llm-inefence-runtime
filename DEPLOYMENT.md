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

### Start Port-Forward
```bash
kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
sleep 2
```

### Test 1: Simple Chat Completion (One-Liner)
```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-0.5B-Instruct","messages":[{"role":"user","content":"What is 2+2?"}],"max_tokens":20}' | python -m json.tool
```

### Test 2: Multi-turn Conversation
```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-0.5B-Instruct",
    "messages": [
      {"role": "user", "content": "What is Kubernetes?"},
      {"role": "assistant", "content": "Kubernetes is an open-source container orchestration platform."},
      {"role": "user", "content": "How does it work?"}
    ],
    "max_tokens": 50,
    "temperature": 0.7
  }' | python -m json.tool
```

### Test 3: Text Completion (Not Chat)
```bash
curl -s http://localhost:8000/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-0.5B-Instruct",
    "prompt": "The capital of France is",
    "max_tokens": 10
  }' | python -m json.tool
```

### Test 4: List Available Models
```bash
curl -s http://localhost:8000/v1/models | python -m json.tool
```

### Test 5: Health Check
```bash
curl -s http://localhost:8000/health
```

### Expected Response (Test 1)
```json
{
  "id": "chatcmpl-...",
  "object": "text_completion",
  "created": 1704096000,
  "model": "Qwen/Qwen2.5-0.5B-Instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "4"
      },
      "finish_reason": "length"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 2,
    "total_tokens": 22
  }
}
```

### Troubleshooting Curl

**Issue: JSON parsing errors or shell escaping issues**
- Save JSON to a file and use `-d @file.json`:
```bash
cat > /tmp/request.json << 'EOF'
{
  "model": "Qwen/Qwen2.5-0.5B-Instruct",
  "messages": [{"role": "user", "content": "Hello!"}],
  "max_tokens": 20
}
EOF

curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @/tmp/request.json | python -m json.tool
```

**Issue: Connection refused**
- Ensure port-forward is running: `ps aux | grep port-forward`
- Restart port-forward: `kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &`

**Issue: 404 Not Found**
- Check if pod is Ready: `kubectl get pods -n llm`
- Wait for model download (can take 5-10 min on first run)

---

## 7. Access via Postman

### OpenAPI Specification
A full OpenAPI 3.0 specification is available at [docs/openapi.yaml](docs/openapi.yaml).

**Use it for:**
- Auto-generating API clients (in Python, Go, JavaScript, etc.)
- API documentation and discovery
- Integration with API management tools (Postman, Swagger UI, etc.)

**Import into Postman:**
1. In Postman, click **File → Import**
2. Paste or upload `docs/openapi.yaml`
3. Select the generated collection and requests are ready to use

---

### Setup (First Time)
1. **Download Postman**: https://www.postman.com/downloads/
2. **Ensure Port-Forward is Running**:
   ```bash
   kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &
   ```

### Create a New Request in Postman

#### Step 1: Set Request Method & URL
- **Method**: `POST`
- **URL**: `http://localhost:8000/v1/chat/completions`

#### Step 2: Set Headers
Go to **Headers** tab and add:
| Key | Value |
|-----|-------|
| `Content-Type` | `application/json` |

#### Step 3: Add Request Body
Go to **Body** tab, select **raw**, paste this JSON:

```json
{
  "model": "Qwen/Qwen2.5-0.5B-Instruct",
  "messages": [
    {
      "role": "user",
      "content": "What is Kubernetes?"
    }
  ],
  "max_tokens": 50,
  "temperature": 0.7
}
```

#### Step 4: Click **Send**
You should see the JSON response with the model's answer.

---

### Postman Request Examples

#### Request 1: Simple Chat Completion
```
POST http://localhost:8000/v1/chat/completions

Headers:
Content-Type: application/json

Body (raw):
{
  "model": "Qwen/Qwen2.5-0.5B-Instruct",
  "messages": [
    {"role": "user", "content": "What is 2+2?"}
  ],
  "max_tokens": 20
}
```

#### Request 2: Multi-turn Conversation
```
POST http://localhost:8000/v1/chat/completions

Headers:
Content-Type: application/json

Body (raw):
{
  "model": "Qwen/Qwen2.5-0.5B-Instruct",
  "messages": [
    {"role": "user", "content": "Explain Kubernetes in one sentence."},
    {"role": "assistant", "content": "Kubernetes is an open-source container orchestration platform."},
    {"role": "user", "content": "What are its benefits?"}
  ],
  "max_tokens": 100,
  "temperature": 0.7
}
```

#### Request 3: Text Completion
```
POST http://localhost:8000/v1/completions

Headers:
Content-Type: application/json

Body (raw):
{
  "model": "Qwen/Qwen2.5-0.5B-Instruct",
  "prompt": "The capital of France is",
  "max_tokens": 10,
  "temperature": 0.5
}
```

#### Request 4: List Models
```
GET http://localhost:8000/v1/models

Headers:
Content-Type: application/json
```

#### Request 5: Health Check
```
GET http://localhost:8000/health

Headers:
Content-Type: application/json
```

---

### Postman Environment Variables (Optional)

For easier management, create an environment in Postman:

1. Click **Environments** → **Create Environment**
2. Name it `inference-runtime`
3. Add variables:

| Variable | Value |
|----------|-------|
| `base_url` | `http://localhost:8000` |
| `model` | `Qwen/Qwen2.5-0.5B-Instruct` |
| `max_tokens` | `50` |

4. Save and select this environment
5. Then use `{{base_url}}/v1/chat/completions` in your requests

---

### Postman Troubleshooting

| Issue | Solution |
|-------|----------|
| **Connection Refused** | Ensure port-forward is running: `kubectl port-forward -n llm svc/my-llm-predictor 8000:80 &` |
| **404 Not Found** | Check if pod is Ready: `kubectl get pods -n llm` |
| **Timeout** | Model is loading (first request takes 30s-2min). Wait and retry. |
| **Invalid JSON** | Ensure body is in **raw** format and valid JSON. Use Postman's **format** button. |
| **401 Unauthorized** | Your model requires auth (HF token). Use an ungated model. |

---

## 8. (Optional) Clean Up
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
Accessible via curl, Python, Postman, or any HTTP client.
