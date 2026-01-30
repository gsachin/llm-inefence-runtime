#!/usr/bin/env bash
# =============================================================================
# Helm Installation Script (Idempotent)
# =============================================================================
# Installs Helm and adds common chart repositories.
#
# Usage:
#   ./scripts/install/helm.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../versions.env"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }

# Check if already installed at correct version
if command -v helm &> /dev/null; then
    CURRENT_VERSION=$(helm version --short 2>/dev/null | cut -d'+' -f1 | sed 's/v//')
    if [[ "$CURRENT_VERSION" == "$HELM_VERSION" ]]; then
        log_success "Helm v$HELM_VERSION already installed"
    else
        log_info "Helm v$CURRENT_VERSION installed (expected v$HELM_VERSION)"
    fi
else
    # Install Helm
    log_info "Installing Helm v$HELM_VERSION..."
    
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    case $ARCH in
        x86_64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
    esac
    
    HELM_URL="https://get.helm.sh/helm-v${HELM_VERSION}-${OS}-${ARCH}.tar.gz"
    
    curl -fsSL "$HELM_URL" | tar xz
    sudo mv "${OS}-${ARCH}/helm" /usr/local/bin/helm
    rm -rf "${OS}-${ARCH}"
    
    log_success "Helm v$HELM_VERSION installed"
fi

# Add common repositories
log_info "Adding Helm repositories..."

declare -A REPOS=(
    ["jetstack"]="https://charts.jetstack.io"
    ["bitnami"]="https://charts.bitnami.com/bitnami"
    ["nvidia"]="https://helm.ngc.nvidia.com/nvidia"
    ["prometheus-community"]="https://prometheus-community.github.io/helm-charts"
)

for name in "${!REPOS[@]}"; do
    if helm repo list 2>/dev/null | grep -q "^$name"; then
        log_success "Repo '$name' already added"
    else
        helm repo add "$name" "${REPOS[$name]}" 2>/dev/null || true
        log_success "Added repo: $name"
    fi
done

helm repo update

echo ""
log_success "Helm setup complete!"
echo ""
echo "Verify: helm version"
