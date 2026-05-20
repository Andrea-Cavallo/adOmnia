# Makefile for adOmnia
# Cross-platform build automation

.PHONY: help build build-all clean test fmt vet lint run install dev release

# Configuration
BINARY_NAME=adomnia
VERSION?=dev
BUILD_DIR=dist
GO=go
LDFLAGS=-s -w -X main.Version=$(VERSION) -X main.BuildDate=$(shell date -u +"%Y-%m-%dT%H:%M:%SZ") -X main.GitCommit=$(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Default target
.DEFAULT_GOAL := help

help: ## Show this help message
	@echo "adOmnia Build Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

build: ## Build for current platform
	@echo "Building $(BINARY_NAME) v$(VERSION)..."
	$(GO) build -ldflags "$(LDFLAGS) -H windowsgui" -o $(BINARY_NAME).exe .
	@echo "✓ Build complete: $(BINARY_NAME).exe"

build-all: clean ## Build for all platforms
	@echo "Building for all platforms..."
	@mkdir -p $(BUILD_DIR)
	
	@echo "→ Windows AMD64..."
	@GOOS=windows GOARCH=amd64 CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS) -H windowsgui" -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe .
	
	@echo "→ macOS Intel..."
	@GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 .
	
	@echo "→ macOS Apple Silicon..."
	@GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 .
	
	@echo "→ Linux AMD64..."
	@GOOS=linux GOARCH=amd64 CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 .
	
	@echo "→ Linux ARM64..."
	@GOOS=linux GOARCH=arm64 CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-arm64 .
	
	@echo "✓ All builds complete in $(BUILD_DIR)/"
	@ls -lh $(BUILD_DIR)/

clean: ## Remove build artifacts
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)
	@rm -f $(BINARY_NAME) $(BINARY_NAME).exe
	@echo "✓ Clean complete"

test: ## Run tests
	@echo "Running tests..."
	$(GO) test -v -race ./...

fmt: ## Format code
	@echo "Formatting code..."
	$(GO) fmt ./...
	@echo "✓ Code formatted"

vet: ## Run go vet
	@echo "Running go vet..."
	$(GO) vet ./...
	@echo "✓ No issues found"

lint: ## Run linter (requires golangci-lint)
	@echo "Running linter..."
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run; \
	else \
		echo "⚠️  golangci-lint not installed. Install: https://golangci-lint.run/usage/install/"; \
	fi

run: build ## Build and run
	@echo "Running $(BINARY_NAME)..."
	./$(BINARY_NAME).exe

install: ## Install binary to system
	@echo "Installing $(BINARY_NAME)..."
	$(GO) install -ldflags "$(LDFLAGS)"
	@echo "✓ Installed to $(shell go env GOPATH)/bin/$(BINARY_NAME)"

dev: ## Run in development mode (auto-reload on changes)
	@echo "Starting development mode..."
	@if command -v air >/dev/null 2>&1; then \
		air; \
	else \
		echo "⚠️  'air' not found. Install: go install github.com/cosmtrek/air@latest"; \
		$(MAKE) run; \
	fi

deps: ## Download dependencies
	@echo "Downloading dependencies..."
	$(GO) mod download
	$(GO) mod verify
	@echo "✓ Dependencies ready"

tidy: ## Tidy dependencies
	@echo "Tidying dependencies..."
	$(GO) mod tidy
	@echo "✓ go.mod updated"

update: ## Update dependencies
	@echo "Updating dependencies..."
	$(GO) get -u ./...
	$(GO) mod tidy
	@echo "✓ Dependencies updated"

release: build-all ## Build release artifacts with checksums
	@echo "Creating release artifacts..."
	@cd $(BUILD_DIR) && sha256sum $(BINARY_NAME)-* > SHA256SUMS.txt
	@echo "✓ Release ready in $(BUILD_DIR)/"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Test binaries on each platform"
	@echo "  2. Update CHANGELOG.md"
	@echo "  3. Create git tag: git tag v$(VERSION)"
	@echo "  4. Push tag: git push origin v$(VERSION)"
	@echo "  5. Create GitHub release with artifacts"

version: ## Show version info
	@echo "Version: $(VERSION)"
	@echo "Build Date: $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")"
	@echo "Git Commit: $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
	@echo "Go Version: $(shell $(GO) version)"

docker-build: ## Build Docker image
	@echo "Building Docker image..."
	docker build \
		--build-arg VERSION=$(VERSION) \
		--build-arg BUILD_DATE=$(shell date -u +"%Y-%m-%dT%H:%M:%SZ") \
		--build-arg GIT_COMMIT=$(shell git rev-parse --short HEAD) \
		-t adomnia:$(VERSION) \
		-t adomnia:latest \
		.
	@echo "✓ Docker image built: adomnia:$(VERSION)"

docker-run: ## Run Docker container
	@echo "Running Docker container..."
	docker run -p 7878:7878 --rm adomnia:latest

check: fmt vet test ## Run all checks (format, vet, test)
	@echo "✓ All checks passed"
