#!/usr/bin/env bash
# =============================================================================
# MLOps Wizard Bootstrap Script
# =============================================================================
# Sets up the development environment with all required dependencies.
#
# Usage:
#   ./scripts/bootstrap.sh              # Full setup
#   ./scripts/bootstrap.sh --check      # Check installed versions
#   ./scripts/bootstrap.sh --deps-only  # Python deps only
#
# Supports: macOS, Linux (Ubuntu/Debian), WSL2
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load pinned versions
source "$SCRIPT_DIR/versions.env"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

command_exists() {
    command -v "$1" &> /dev/null
}

get_os() {
    case "$(uname -s)" in
        Darwin) echo "macos" ;;
        Linux)
            if [[ -f /proc/sys/fs/binfmt_misc/WSLInterop ]]; then
                echo "wsl2"
            else
                echo "linux"
            fi
            ;;
        *) echo "unknown" ;;
    esac
}

get_arch() {
    case "$(uname -m)" in
        arm64|aarch64) echo "arm64" ;;
        x86_64|amd64) echo "amd64" ;;
        *) echo "unknown" ;;
    esac
}

# -----------------------------------------------------------------------------
# Version Check Mode
# -----------------------------------------------------------------------------

check_versions() {
    log_info "Checking installed versions..."
    echo ""
    
    local all_ok=true
    
    # Python
    if command_exists python3; then
        local py_ver=$(python3 --version 2>&1 | awk '{print $2}')
        if [[ "$py_ver" == "$PYTHON_VERSION"* ]]; then
            log_success "Python: $py_ver (expected: $PYTHON_VERSION)"
        else
            log_warning "Python: $py_ver (expected: $PYTHON_VERSION)"
        fi
    else
        log_error "Python: not installed"
        all_ok=false
    fi
    
    # kubectl
    if command_exists kubectl; then
        local kubectl_ver=$(kubectl version --client -o json 2>/dev/null | grep -o '"gitVersion": "[^"]*"' | head -1 | cut -d'"' -f4)
        log_success "kubectl: $kubectl_ver (expected: v$KUBECTL_VERSION)"
    else
        log_error "kubectl: not installed"
        all_ok=false
    fi
    
    # helm
    if command_exists helm; then
        local helm_ver=$(helm version --short 2>/dev/null | cut -d'+' -f1)
        log_success "helm: $helm_ver (expected: v$HELM_VERSION)"
    else
        log_error "helm: not installed"
        all_ok=false
    fi
    
    # Node.js
    if command_exists node; then
        local node_ver=$(node --version)
        log_success "node: $node_ver (expected: v$NODE_VERSION)"
    else
        log_warning "node: not installed (optional)"
    fi
    
    echo ""
    if $all_ok; then
        log_success "All required tools are installed"
    else
        log_error "Some tools are missing. Run: ./scripts/bootstrap.sh"
    fi
}

# -----------------------------------------------------------------------------
# Installation Functions
# -----------------------------------------------------------------------------

install_homebrew() {
    if command_exists brew; then
        log_success "Homebrew already installed"
        return
    fi
    
    log_info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add to PATH for current session
    if [[ "$(get_arch)" == "arm64" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    else
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    
    log_success "Homebrew installed"
}

install_python_macos() {
    if command_exists pyenv; then
        log_info "Using pyenv to install Python $PYTHON_VERSION..."
        pyenv install -s "$PYTHON_VERSION"
        pyenv local "$PYTHON_VERSION"
    else
        log_info "Installing Python via Homebrew..."
        brew install python@3.11
    fi
    log_success "Python installed"
}

install_python_linux() {
    if command_exists python3.11; then
        log_success "Python 3.11 already installed"
        return
    fi
    
    log_info "Installing Python $PYTHON_VERSION..."
    sudo apt-get update
    sudo apt-get install -y python3.11 python3.11-venv python3-pip
    log_success "Python installed"
}

install_kubectl() {
    if command_exists kubectl; then
        log_success "kubectl already installed"
        return
    fi
    
    local os=$(get_os)
    local arch=$(get_arch)
    
    log_info "Installing kubectl v$KUBECTL_VERSION..."
    
    if [[ "$os" == "macos" ]]; then
        brew install kubectl
    else
        curl -LO "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${arch}/kubectl"
        chmod +x kubectl
        sudo mv kubectl /usr/local/bin/
    fi
    
    log_success "kubectl installed"
}

install_helm() {
    if command_exists helm; then
        log_success "Helm already installed"
        return
    fi
    
    log_info "Installing Helm v$HELM_VERSION..."
    
    if [[ "$(get_os)" == "macos" ]]; then
        brew install helm
    else
        curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    fi
    
    log_success "Helm installed"
}

install_python_deps() {
    log_info "Installing Python dependencies..."
    
    cd "$REPO_ROOT"
    
    # Create venv if it doesn't exist
    if [[ ! -d ".venv" ]]; then
        python3 -m venv .venv
    fi
    
    # Activate venv and install
    source .venv/bin/activate
    pip install --upgrade pip
    pip install -r orchestrator/requirements.txt
    pip install -r orchestrator/requirement-dev.txt
    
    log_success "Python dependencies installed"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    local mode="${1:-full}"
    
    echo ""
    echo "=============================================="
    echo "  MLOps Wizard Bootstrap"
    echo "=============================================="
    echo ""
    
    local os=$(get_os)
    local arch=$(get_arch)
    log_info "Detected: OS=$os, Arch=$arch"
    echo ""
    
    case "$mode" in
        --check)
            check_versions
            exit 0
            ;;
        --deps-only)
            install_python_deps
            exit 0
            ;;
        --help|-h)
            echo "Usage: $0 [--check|--deps-only|--help]"
            echo ""
            echo "Options:"
            echo "  --check      Check installed versions"
            echo "  --deps-only  Install Python dependencies only"
            echo "  --help       Show this help"
            exit 0
            ;;
    esac
    
    # Full installation
    case "$os" in
        macos)
            install_homebrew
            install_python_macos
            ;;
        linux|wsl2)
            install_python_linux
            ;;
        *)
            log_error "Unsupported OS: $os"
            exit 1
            ;;
    esac
    
    install_kubectl
    install_helm
    install_python_deps
    
    echo ""
    log_success "Bootstrap complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Activate the virtual environment: source .venv/bin/activate"
    echo "  2. Run the orchestrator: python -m orchestrator.cli --help"
    echo "  3. Start the API server: uvicorn orchestrator.api.main:app --reload"
    echo ""
}

main "$@"
