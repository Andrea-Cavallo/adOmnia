# Multi-stage build for adOmnia
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    gtk+3.0-dev \
    webkit2gtk-dev

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
ARG VERSION=dev
ARG BUILD_DATE
ARG GIT_COMMIT
RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags "-s -w -X main.Version=${VERSION} -X main.BuildDate=${BUILD_DATE} -X main.GitCommit=${GIT_COMMIT}" \
    -o adomnia .

# Final stage - minimal runtime
FROM alpine:latest

RUN apk add --no-cache \
    gtk+3.0 \
    webkit2gtk \
    ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/adomnia .

# Expose default port
EXPOSE 7878

# Run as non-root user
RUN adduser -D -u 1000 adomnia && \
    chown -R adomnia:adomnia /app
USER adomnia

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7878/health || exit 1

ENTRYPOINT ["./adomnia"]
CMD ["-addr", ":7878", "-no-browser"]
