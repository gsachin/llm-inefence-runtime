# =============================================================================
# MLOps Wizard Makefile
# =============================================================================
# Standardized commands for development, testing, and deployment.
#
# Usage:
#   make help        - Show all available commands
#   make setup       - Full development environment setup
#   make deps        - Install Python dependencies only
#   make check       - Run linting and type checks
#   make test        - Run test suite
#   make api         - Start the FastAPI server
# =============================================================================

.PHONY: help setup deps check test api clean lint format typecheck cluster kserve ui ui-dev ui-electron ui-build ui-package

# Default target
.DEFAULT_GOAL := help

# Variables
PYTHON := python3
VENV := .venv
VENV_BIN := $(VENV)/bin
PIP := $(VENV_BIN)/pip
PYTHON_BIN := $(VENV_BIN)/python
UVICORN := $(VENV_BIN)/uvicorn

# Colors for terminal output
BOLD := $(shell tput bold 2>/dev/null || echo "")
RESET := $(shell tput sgr0 2>/dev/null || echo "")
GREEN := $(shell tput setaf 2 2>/dev/null || echo "")
YELLOW := $(shell tput setaf 3 2>/dev/null || echo "")

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------

help: ## Show this help message
	@echo ""
	@echo "$(BOLD)MLOps Wizard$(RESET) - Development Commands"
	@echo ""
	@echo "$(BOLD)Setup:$(RESET)"
	@grep -E '^(setup|deps|cluster|kserve):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(BOLD)Development:$(RESET)"
	@grep -E '^(api|cli|check|lint|format|typecheck):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(BOLD)Testing:$(RESET)"
	@grep -E '^(test|test-cov):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(BOLD)Cleanup:$(RESET)"
	@grep -E '^(clean|clean-all):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(BOLD)Frontend:$(RESET)"
	@grep -E '^(ui|ui-deps|ui-electron|ui-build|ui-package|ui-dist|ui-clean):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# -----------------------------------------------------------------------------
# Setup
# -----------------------------------------------------------------------------

setup: ## Full environment setup (tools + deps)
	@echo "$(YELLOW)Running bootstrap...$(RESET)"
	@chmod +x scripts/bootstrap.sh
	@./scripts/bootstrap.sh
	@echo "$(GREEN)✓ Setup complete$(RESET)"

deps: $(VENV) ## Install Python dependencies only
	@echo "$(YELLOW)Installing Python dependencies...$(RESET)"
	@$(PIP) install --upgrade pip
	@$(PIP) install -r orchestrator/requirements.txt
	@$(PIP) install -r orchestrator/requirement-dev.txt
	@echo "$(GREEN)✓ Dependencies installed$(RESET)"

$(VENV):
	@echo "$(YELLOW)Creating virtual environment...$(RESET)"
	@$(PYTHON) -m venv $(VENV)
	@echo "$(GREEN)✓ Virtual environment created$(RESET)"

cluster: ## Create local k3d cluster
	@echo "$(YELLOW)Creating k3d cluster...$(RESET)"
	@chmod +x scripts/install/k3d.sh
	@./scripts/install/k3d.sh --cluster
	@echo "$(GREEN)✓ Cluster ready$(RESET)"

kserve: ## Install KServe stack
	@echo "$(YELLOW)Installing KServe...$(RESET)"
	@chmod +x scripts/install/kserve.sh
	@./scripts/install/kserve.sh
	@echo "$(GREEN)✓ KServe ready$(RESET)"

# -----------------------------------------------------------------------------
# Development
# -----------------------------------------------------------------------------

api: deps ## Start FastAPI development server
	@echo "$(YELLOW)Starting API server...$(RESET)"
	@$(UVICORN) orchestrator.api.main:create_app --factory --reload --host 0.0.0.0 --port 8000

cli: deps ## Run CLI in interactive mode
	@$(PYTHON_BIN) -m orchestrator.cli $(ARGS)

check: lint typecheck ## Run all checks (lint + typecheck)

lint: deps ## Run ruff linter
	@echo "$(YELLOW)Running linter...$(RESET)"
	@$(VENV_BIN)/ruff check orchestrator/ --fix
	@echo "$(GREEN)✓ Linting passed$(RESET)"

format: deps ## Format code with ruff
	@echo "$(YELLOW)Formatting code...$(RESET)"
	@$(VENV_BIN)/ruff format orchestrator/
	@echo "$(GREEN)✓ Formatting complete$(RESET)"

typecheck: deps ## Run mypy type checker
	@echo "$(YELLOW)Running type checker...$(RESET)"
	@$(VENV_BIN)/mypy orchestrator/ --ignore-missing-imports
	@echo "$(GREEN)✓ Type checking passed$(RESET)"

# -----------------------------------------------------------------------------
# Testing
# -----------------------------------------------------------------------------

test: deps ## Run test suite
	@echo "$(YELLOW)Running tests...$(RESET)"
	@$(VENV_BIN)/pytest tests/ -v
	@echo "$(GREEN)✓ Tests passed$(RESET)"

test-cov: deps ## Run tests with coverage
	@echo "$(YELLOW)Running tests with coverage...$(RESET)"
	@$(VENV_BIN)/pytest tests/ -v --cov=orchestrator --cov-report=html --cov-report=term
	@echo "$(GREEN)✓ Coverage report: htmlcov/index.html$(RESET)"

# -----------------------------------------------------------------------------
# Cleanup
# -----------------------------------------------------------------------------

clean: ## Remove generated files
	@echo "$(YELLOW)Cleaning...$(RESET)"
	@rm -rf __pycache__ .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "$(GREEN)✓ Clean$(RESET)"

clean-all: clean ## Remove everything including venv
	@echo "$(YELLOW)Deep cleaning...$(RESET)"
	@rm -rf $(VENV)
	@echo "$(GREEN)✓ All clean$(RESET)"

# -----------------------------------------------------------------------------
# Deployment
# -----------------------------------------------------------------------------

deploy: deps ## Deploy a model (use PROFILE=<name>)
ifndef PROFILE
	@echo "$(YELLOW)Usage: make deploy PROFILE=<profile_name>$(RESET)"
	@echo ""
	@echo "Available profiles:"
	@$(PYTHON_BIN) -m orchestrator.cli --list-profiles
else
	@$(PYTHON_BIN) -m orchestrator.cli --profile $(PROFILE)
endif

destroy: deps ## Destroy all deployed resources
	@echo "$(YELLOW)Destroying all resources...$(RESET)"
	@$(PYTHON_BIN) -c "from orchestrator.lifecycle.manager import ResourceLifecycleManager; m = ResourceLifecycleManager(); m.destroy_all()"
	@echo "$(GREEN)✓ All resources destroyed$(RESET)"

# -----------------------------------------------------------------------------
# Frontend (UI)
# -----------------------------------------------------------------------------

FRONTEND_DIR := frontend

ui: ui-deps ## Run web UI in development mode (browser)
	@echo "$(YELLOW)Starting web UI...$(RESET)"
	@cd $(FRONTEND_DIR) && npm run dev

ui-deps: ## Install frontend dependencies
	@echo "$(YELLOW)Installing frontend dependencies...$(RESET)"
	@cd $(FRONTEND_DIR) && npm install
	@echo "$(GREEN)✓ Frontend dependencies installed$(RESET)"

ui-electron: ui-deps ## Run Electron desktop app in development mode
	@echo "$(YELLOW)Starting Electron app...$(RESET)"
	@cd $(FRONTEND_DIR) && npm run dev:electron

ui-build: ui-deps ## Build frontend for production
	@echo "$(YELLOW)Building frontend...$(RESET)"
	@cd $(FRONTEND_DIR) && npm run build:electron
	@echo "$(GREEN)✓ Build complete$(RESET)"

ui-package: ui-build ## Package Electron app (unsigned, for testing)
	@echo "$(YELLOW)Packaging Electron app...$(RESET)"
	@cd $(FRONTEND_DIR) && npm run package
	@echo "$(GREEN)✓ Package ready in frontend/release/$(RESET)"

ui-dist: ui-build ## Build distributable installers (dmg, AppImage, exe)
	@echo "$(YELLOW)Building distributables...$(RESET)"
	@cd $(FRONTEND_DIR) && npm run dist
	@echo "$(GREEN)✓ Distributables ready in frontend/release/$(RESET)"

ui-clean: ## Clean frontend build artifacts
	@echo "$(YELLOW)Cleaning frontend...$(RESET)"
	@rm -rf $(FRONTEND_DIR)/dist $(FRONTEND_DIR)/dist-electron $(FRONTEND_DIR)/release $(FRONTEND_DIR)/node_modules
	@echo "$(GREEN)✓ Frontend clean$(RESET)"
