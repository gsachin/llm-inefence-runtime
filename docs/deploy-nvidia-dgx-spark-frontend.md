# Frontend Deployment Guide: NVIDIA DGX Spark

> **Platform**: NVIDIA DGX Spark (Grace ARM64 + GB10 GPU)  
> **Component**: React + Vite + Electron Wizard UI  
> **Last Updated**: February 2026

This guide covers deploying the MLOps Wizard frontend on NVIDIA DGX Spark systems.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Environment Setup](#environment-setup)
4. [Installation](#installation)
5. [Development Mode](#development-mode)
6. [Production Build](#production-build)
7. [Electron Desktop App](#electron-desktop-app)
8. [Docker Deployment](#docker-deployment)
9. [Reverse Proxy Setup](#reverse-proxy-setup)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2+ cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 5 GB free | 10+ GB |

### Software Requirements

```bash
# Verify system
uname -m                    # aarch64
cat /etc/os-release         # Ubuntu 24.04+
```

| Tool | Version | Installation |
|------|---------|--------------|
| Node.js | 20.x LTS | See below |
| npm | 10+ | Comes with Node.js |
| Git | 2.x | `sudo apt install git` |

### Backend Requirement

The frontend requires the backend API to be running. See [deploy-nvidia-dgx-spark-backend.md](deploy-nvidia-dgx-spark-backend.md).

```bash
# Verify backend is running
curl http://localhost:8000/health
# Expected: {"status":"healthy"}
```

---

## Quick Start

```bash
# Install Node.js (ARM64)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Navigate to frontend directory
cd /path/to/llm-inference-runtime/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend available at: http://localhost:5173

---

## Environment Setup

### Step 1: Install Node.js for ARM64

#### Option A: NodeSource Repository (Recommended)

```bash
# Add NodeSource repository for Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs

# Verify installation
node --version   # v20.x.x
npm --version    # 10.x.x
```

#### Option B: NVM (Node Version Manager)

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version
npm --version
```

#### Option C: Manual Download (ARM64 Binary)

```bash
# Download ARM64 binary
wget https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-arm64.tar.xz

# Extract
sudo tar -xf node-v20.18.0-linux-arm64.tar.xz -C /usr/local --strip-components=1

# Verify
node --version
```

### Step 2: Verify npm Configuration

```bash
# Check npm config
npm config list

# Set registry (if needed)
npm config set registry https://registry.npmjs.org/

# Enable legacy peer deps (may help with some packages)
npm config set legacy-peer-deps true
```

---

## Installation

### Step 1: Navigate to Frontend Directory

```bash
cd /path/to/llm-inference-runtime/frontend
```

### Step 2: Install Dependencies

```bash
# Clean install (recommended)
rm -rf node_modules package-lock.json
npm install

# Or if you have a lock file
npm ci
```

### Step 3: Verify Installation

```bash
# Check installed packages
npm list --depth=0

# Expected output includes:
# ├── @tanstack/react-query@5.x.x
# ├── axios@1.x.x
# ├── react@18.x.x
# ├── react-dom@18.x.x
# ├── vite@5.x.x
# └── ...
```

### Step 4: TypeScript Check

```bash
# Run TypeScript compiler check
npx tsc --noEmit

# Should complete with no errors
```

---

## Development Mode

### Start Development Server

```bash
cd frontend

# Start Vite dev server
npm run dev
```

**Output:**
```
  VITE v5.0.12  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
  ➜  press h + enter to show help
```

### Access the Wizard

Open browser to: http://localhost:5173

The wizard will:
1. **Detect Platform**: Shows "NVIDIA DGX Spark" with 🚀 icon
2. **Probe Hardware**: Displays GB10 GPU, ~120GB unified memory
3. **Guide Setup**: Walks through credentials, dependencies, profiles

### API Proxy Configuration

The dev server proxies API calls to the backend. Verify `vite.config.ts`:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
```

### Hot Module Replacement (HMR)

Changes to `.tsx` files automatically refresh the browser.

---

## Production Build

### Step 1: Build for Production

```bash
cd frontend

# TypeScript compile + Vite build
npm run build
```

**Output:**
```
vite v5.0.12 building for production...
✓ 123 modules transformed.
dist/index.html                  0.46 kB │ gzip:  0.30 kB
dist/assets/index-abc123.css    15.32 kB │ gzip:  4.12 kB
dist/assets/index-xyz789.js    245.67 kB │ gzip: 78.45 kB
✓ built in 5.23s
```

### Step 2: Preview Production Build

```bash
# Preview locally
npm run preview
```

Opens at: http://localhost:4173

### Step 3: Serve Static Files

The `dist/` directory contains static files ready for any web server.

```bash
# Directory structure after build
dist/
├── index.html
├── assets/
│   ├── index-*.css
│   └── index-*.js
└── ...
```

---

## Electron Desktop App

### Development with Electron

```bash
cd frontend

# Start Electron development mode
npm run dev:electron
```

This opens a native desktop window with the wizard.

### Build Electron App for Linux ARM64

```bash
# First, build the electron app
npm run build:electron

# Then build distribution (AppImage only on ARM64)
npm run dist:linux
```

**Output location:** `frontend/release/`

```bash
# List built packages
ls -la release/

# Expected files on ARM64:
# - MLOps Wizard-0.1.0-arm64.AppImage  (AppImage)
# Note: .deb packages may fail on ARM64 due to fpm compatibility
```

> **⚠️ ARM64 Note:** The `.deb` package build may fail on ARM64 because
> `electron-builder`'s bundled `fpm` tool only has x86 binaries.
> Use AppImage instead, which works correctly.

### Install Desktop App

```bash
# Install .deb package
sudo dpkg -i release/mlops-wizard_0.1.0_arm64.deb

# Or run AppImage directly
chmod +x release/mlops-wizard-0.1.0-arm64.AppImage
./release/mlops-wizard-0.1.0-arm64.AppImage
```

### Electron Configuration

The Electron config is in `package.json`:

```json
{
  "build": {
    "appId": "com.mlops-wizard.app",
    "productName": "MLOps Wizard",
    "linux": {
      "target": ["deb", "AppImage"],
      "category": "Development"
    }
  }
}
```

---

## Docker Deployment

### Dockerfile for Frontend

Create `Dockerfile.frontend`:

```dockerfile
# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY frontend/ ./

# Build
RUN npm run build

# Production stage - nginx
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.frontend.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Nginx Configuration

Create `nginx.frontend.conf`:

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SPA routing - all paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy to backend
    location /api/ {
        proxy_pass http://mlops-backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /ws/ {
        proxy_pass http://mlops-backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

### Build and Run

```bash
# Build image
docker build -f Dockerfile.frontend -t mlops-frontend:latest .

# Run container
docker run -d \
  --name mlops-frontend \
  -p 3000:80 \
  --link mlops-backend:mlops-backend \
  mlops-frontend:latest
```

### Docker Compose (Full Stack)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: mlops-backend
    ports:
      - "8000:8000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${HOME}/.kube:/root/.kube:ro
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    container_name: mlops-frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped

networks:
  default:
    name: mlops-network
```

Run with:

```bash
docker-compose up -d
```

Access at: http://localhost:3000

---

## Reverse Proxy Setup

### Nginx as Reverse Proxy

For production, use nginx to serve frontend and proxy to backend:

```nginx
# /etc/nginx/sites-available/mlops-wizard
server {
    listen 80;
    server_name mlops.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mlops.yourdomain.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/mlops.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mlops.yourdomain.com/privkey.pem;

    # Frontend static files
    root /var/www/mlops-wizard/dist;
    index index.html;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket proxy
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/mlops-wizard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Troubleshooting

### Common Issues

#### 1. Node.js Not Found

```bash
# Error: command not found: node
# Solution: Install Node.js (see Environment Setup)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 2. npm Install Fails

```bash
# Error: npm ERR! code ERESOLVE
# Solution: Use legacy peer deps
npm install --legacy-peer-deps

# Or clean and retry
rm -rf node_modules package-lock.json
npm install
```

#### 3. Vite Dev Server Won't Start

```bash
# Error: Port 5173 already in use
# Solution: Kill existing process
lsof -i :5173
kill -9 <PID>

# Or use different port
npm run dev -- --port 5174
```

#### 4. API Proxy Not Working

```bash
# Symptom: API calls return 404 or CORS errors
# Check: Backend is running
curl http://localhost:8000/health

# Check: vite.config.ts has correct proxy settings
cat vite.config.ts | grep -A5 proxy
```

#### 5. Build Fails on ARM64

```bash
# Error: node-gyp build errors
# Solution: Install build tools
sudo apt install -y python3 make g++ build-essential

# Clear npm cache and retry
npm cache clean --force
npm install
```

#### 6. Electron Build Fails

```bash
# Error: electron-builder errors on ARM64
# Solution: Use correct target
npm run dist:linux -- --arm64

# Or skip code signing
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist:linux
```

#### 7. Platform Shows "Unknown" Instead of "DGX Spark"

```bash
# Check: Backend platform detection
curl http://localhost:8000/api/v1/platform/detect

# Expected: {"platform_name":"linux_dgx_spark",...}
# If not, check backend DGX Spark adapter registration
```

### Logs and Debugging

```bash
# Vite verbose output
npm run dev -- --debug

# Check browser console for errors
# Press F12 in browser → Console tab

# Network requests
# Press F12 → Network tab → filter by "api"
```

### Performance Tips

```bash
# Use production build for better performance
npm run build && npm run preview

# Enable gzip in nginx (see nginx config above)

# Use HTTP/2 for faster asset loading
# (Requires SSL certificate)
```

---

## Wizard Flow Overview

The MLOps Wizard guides users through:

| Step | Screen | Backend API |
|------|--------|-------------|
| 1 | **Platform Detection** | `GET /api/v1/platform/detect` |
| 2 | **Credentials Setup** | `POST /api/v1/credentials/huggingface/setup` |
| 3 | **Dependency Check** | `GET /api/v1/deps/check` |
| 4 | **Profile Selection** | `GET /api/v1/deploy/profiles` |
| 5 | **Deployment** | `POST /api/v1/deploy/deploy` + WebSocket |
| 6 | **Dashboard** | `GET /api/v1/lifecycle/resources` |

### DGX Spark-Specific UI Elements

- Platform card shows 🚀 **NVIDIA DGX Spark** 
- Hardware probe displays GB10 GPU with unified memory
- Profile selector recommends `dgx_spark_gpu`
- K8s engine recommendation: minikube (warns about k3d)

---

## Next Steps

1. **Start Backend First**: See [deploy-nvidia-dgx-spark-backend.md](deploy-nvidia-dgx-spark-backend.md)
2. **Configure HuggingFace Token**: Use the Credentials step in wizard
3. **Install Dependencies**: Follow the wizard's dependency step
4. **Deploy a Model**: Select `dgx_spark_gpu` profile and deploy!

---

## References

- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [Electron Documentation](https://www.electronjs.org/)
- [TailwindCSS Documentation](https://tailwindcss.com/)
- [Main DGX Spark Setup Guide](deploy-llm-setup-nvidia-dgx-spark-gpu.md)
