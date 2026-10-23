# Multi-stage build for adOmnia
FROM golang:1.27.3-alpine3.24 AS builder

# Install build dependencies
# Alpine package versions are dropped from the mirrors as new builds land; the base image tag pins the release.
# hadolint ignore=DL3018
RUN apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    nodejs \
    npm \
    gtk+3.0-dev \
    webkit2gtk-4.1-dev

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

COPY frontend/package*.json ./frontend/
WORKDIR /build/frontend
# Lockfile-exact install without dependency lifecycle scripts (esbuild/rolldown ship their binaries as optional deps).
RUN npm ci --ignore-scripts
WORKDIR /build

# Copy source code
COPY . .

WORKDIR /build/frontend
RUN npm run build
WORKDIR /build

# Build binary
ARG VERSION=dev
ARG BUILD_DATE
ARG GIT_COMMIT
RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -buildvcs=false -trimpath -tags 'production gtk3' \
    -ldflags "-s -w -X main.Version=${VERSION} -X main.BuildDate=${BUILD_DATE} -X main.GitCommit=${GIT_COMMIT}" \
    -o adomnia .

# Final stage - minimal runtime
FROM alpine:3.24

# Alpine package versions are dropped from the mirrors as new builds land; the base image tag pins the release.
# hadolint ignore=DL3018
RUN apk add --no-cache \
    gtk+3.0 \
    webkit2gtk-4.1 \
    ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/adomnia .

# Expose default port
EXPOSE 7878

# Run as non-root user
RUN adduser -D -u 1000 adomnia && \
    chown -R adomnia:adomnia /app
USER 1000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:7878/health"]

ENTRYPOINT ["./adomnia"]
CMD ["-addr", ":7878", "-no-browser"]
