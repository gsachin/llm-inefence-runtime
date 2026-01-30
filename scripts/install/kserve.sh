#!/usr/bin/env bash
# =============================================================================
# KServe Installation Script (Idempotent)
# =============================================================================
# Installs KServe and its dependencies (cert-manager, Gateway API).
#
# Usage:
#   ./scripts/install/kserve.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../versions.env"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# Verify cluster is available
if ! kubectl cluster-info &> /dev/null; then
    log_error "No Kubernetes cluster available. Please create one first."
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 1: Install cert-manager
# -----------------------------------------------------------------------------
log_info "Checking cert-manager..."

if kubectl get namespace cert-manager &> /dev/null; then
    log_success "cert-manager already installed"
else
    log_info "Installing cert-manager v$CERT_MANAGER_VERSION..."
    
    helm repo add jetstack https://charts.jetstack.io 2>/dev/null || true
    helm repo update
    
    helm upgrade --install cert-manager jetstack/cert-manager \
        --namespace cert-manager \
        --create-namespace \
        --version "v$CERT_MANAGER_VERSION" \
        --set installCRDs=true \
        --wait
    
    log_success "cert-manager installed"
fi

# Wait for cert-manager to be ready
log_info "Waiting for cert-manager pods..."
kubectl wait --for=condition=ready pod -l app=cert-manager -n cert-manager --timeout=120s

# -----------------------------------------------------------------------------
# Step 2: Install Gateway API CRDs
# -----------------------------------------------------------------------------
log_info "Checking Gateway API CRDs..."

if kubectl get crd gateways.gateway.networking.k8s.io &> /dev/null; then
    log_success "Gateway API CRDs already installed"
else
    log_info "Installing Gateway API v$GATEWAY_API_VERSION..."
    
    kubectl apply -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/v${GATEWAY_API_VERSION}/standard-install.yaml"
    
    log_success "Gateway API CRDs installed"
fi

# -----------------------------------------------------------------------------
# Step 3: Install KServe
# -----------------------------------------------------------------------------
log_info "Checking KServe..."

if kubectl get crd inferenceservices.serving.kserve.io &> /dev/null; then
    log_success "KServe already installed"
else
    log_info "Installing KServe v$KSERVE_VERSION..."
    
    kubectl apply -f "https://github.com/kserve/kserve/releases/download/v${KSERVE_VERSION}/kserve.yaml"
    
    # Wait for KServe controller
    log_info "Waiting for KServe controller..."
    sleep 10  # Give time for resources to be created
    kubectl wait --for=condition=ready pod -l control-plane=kserve-controller-manager -n kserve --timeout=120s 2>/dev/null || true
    
    # Install default runtimes
    kubectl apply -f "https://github.com/kserve/kserve/releases/download/v${KSERVE_VERSION}/kserve-runtimes.yaml"
    
    log_success "KServe installed"
fi

# -----------------------------------------------------------------------------
# Step 4: Configure for local development
# -----------------------------------------------------------------------------
log_info "Configuring KServe for local development..."

# Patch to use RawDeployment mode (simpler for local)
kubectl patch configmap/inferenceservice-config \
    -n kserve \
    --type merge \
    -p '{"data":{"deploy":"{\"defaultDeploymentMode\": \"RawDeployment\"}"}}' 2>/dev/null || true

log_success "KServe configuration complete"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
log_success "KServe stack installation complete!"
echo ""
echo "Installed components:"
echo "  - cert-manager v$CERT_MANAGER_VERSION"
echo "  - Gateway API v$GATEWAY_API_VERSION"
echo "  - KServe v$KSERVE_VERSION"
echo ""
echo "Verify with: kubectl get crd inferenceservices.serving.kserve.io"
