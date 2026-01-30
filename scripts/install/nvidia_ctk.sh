#!/usr/bin/env bash
# =============================================================================
# NVIDIA Container Toolkit Installation Script (Idempotent)
# =============================================================================
# Installs NVIDIA Container Toolkit for GPU support in containers.
# Linux only - not applicable on macOS.
#
# Usage:
#   ./scripts/install/nvidia_ctk.sh
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
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }

# Check OS
OS=$(uname -s)
if [[ "$OS" != "Linux" ]]; then
    log_error "NVIDIA Container Toolkit is only supported on Linux."
    log_info "For macOS, GPU acceleration uses Metal/MLX natively."
    exit 1
fi

# Check for NVIDIA GPU
if ! lspci 2>/dev/null | grep -i nvidia &> /dev/null; then
    log_warning "No NVIDIA GPU detected."
    log_info "If running in a VM or cloud, GPU passthrough may be required."
fi

# Check NVIDIA driver
if ! command -v nvidia-smi &> /dev/null; then
    log_error "NVIDIA driver not installed."
    log_info "Install with: sudo apt install nvidia-driver-535 (or newer)"
    exit 1
fi

log_info "NVIDIA GPU detected:"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
echo ""

# Check if already installed
if command -v nvidia-ctk &> /dev/null; then
    CURRENT_VERSION=$(nvidia-ctk --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "unknown")
    log_success "NVIDIA Container Toolkit already installed (v$CURRENT_VERSION)"
    
    # Still need to verify runtime configuration
else
    # Install NVIDIA Container Toolkit
    log_info "Installing NVIDIA Container Toolkit v$NVIDIA_CONTAINER_TOOLKIT_VERSION..."
    
    # Add repository
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
    
    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    
    log_success "NVIDIA Container Toolkit installed"
fi

# Configure container runtime
log_info "Configuring container runtime..."

# Check for Docker
if command -v docker &> /dev/null; then
    log_info "Configuring Docker..."
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker 2>/dev/null || true
    log_success "Docker configured for NVIDIA"
fi

# Check for containerd (used by Kubernetes)
if systemctl is-active --quiet containerd 2>/dev/null; then
    log_info "Configuring containerd..."
    sudo nvidia-ctk runtime configure --runtime=containerd
    sudo systemctl restart containerd 2>/dev/null || true
    log_success "containerd configured for NVIDIA"
fi

# Verify installation
log_info "Verifying GPU access in containers..."
if docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
    log_success "GPU accessible in containers!"
else
    log_warning "Could not verify GPU access. You may need to restart the Docker daemon."
fi

echo ""
log_success "NVIDIA Container Toolkit setup complete!"
echo ""
echo "Test GPU access:"
echo "  docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi"
