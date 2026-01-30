#!/usr/bin/env bash
# =============================================================================
# k3d Installation Script (Idempotent)
# =============================================================================
# Installs k3d and optionally creates a cluster for local development.
#
# Usage:
#   ./scripts/install/k3d.sh              # Install k3d only
#   ./scripts/install/k3d.sh --cluster    # Install and create cluster
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../versions.env"

CLUSTER_NAME="mlops-wizard"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }

# Check if already installed at correct version
if command -v k3d &> /dev/null; then
    CURRENT_VERSION=$(k3d version | grep k3d | awk '{print $3}' | sed 's/v//')
    if [[ "$CURRENT_VERSION" == "$K3D_VERSION" ]]; then
        log_success "k3d v$K3D_VERSION already installed"
        
        if [[ "${1:-}" != "--cluster" ]]; then
            exit 0
        fi
    else
        log_info "Upgrading k3d from v$CURRENT_VERSION to v$K3D_VERSION"
    fi
fi

# Install k3d
log_info "Installing k3d v$K3D_VERSION..."
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | TAG=v${K3D_VERSION} bash

log_success "k3d v$K3D_VERSION installed"

# Optionally create cluster
if [[ "${1:-}" == "--cluster" ]]; then
    # Clean up existing cluster if present
    if k3d cluster list | grep -q "$CLUSTER_NAME"; then
        log_info "Deleting existing cluster: $CLUSTER_NAME"
        k3d cluster delete "$CLUSTER_NAME" || true
    fi
    
    log_info "Creating k3d cluster: $CLUSTER_NAME"
    k3d cluster create "$CLUSTER_NAME" \
        --api-port 6550 \
        --servers 1 \
        --agents 2 \
        --port "8080:80@loadbalancer" \
        --port "8443:443@loadbalancer" \
        --wait
    
    log_success "Cluster $CLUSTER_NAME created"
    
    # Verify
    kubectl cluster-info
fi
