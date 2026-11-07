package grpc

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// Connections are reused across calls to the same server: a new HTTP/2 connection (and TLS handshake) per call
// made load tests and long sessions pay the setup every time. An idle connection is closed after a while.

const idleConnectionTimeout = 5 * time.Minute

// Target is where a call goes and how it authenticates the transport.
type Target struct {
	Address        string `json:"address"`
	TLS            bool   `json:"tls"`
	CACertPath     string `json:"ca_cert_path,omitempty"`
	ClientCertPath string `json:"client_cert_path,omitempty"`
	ClientKeyPath  string `json:"client_key_path,omitempty"`
}

// key identifies a connection: the certificate files' modification times are part of it, so replacing a
// certificate on disk opens a new connection instead of reusing the old handshake.
func (t Target) key() string {
	parts := []string{t.Address, fmt.Sprint(t.TLS)}
	for _, path := range []string{t.CACertPath, t.ClientCertPath, t.ClientKeyPath} {
		stamp := ""
		if info, err := os.Stat(path); path != "" && err == nil {
			stamp = info.ModTime().String()
		}
		parts = append(parts, path, stamp)
	}
	return strings.Join(parts, "\x00")
}

type pooledConnection struct {
	conn     *grpc.ClientConn
	lastUsed time.Time
}

type connectionPool struct {
	mu    sync.Mutex
	conns map[string]*pooledConnection
	now   func() time.Time
}

var connections = &connectionPool{conns: map[string]*pooledConnection{}, now: time.Now}

// get returns the open connection to the target, opening it if needed. Callers never close it.
func (p *connectionPool) get(target Target) (*grpc.ClientConn, error) {
	key := target.key()
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	p.evictIdle(now)
	if pooled, ok := p.conns[key]; ok {
		pooled.lastUsed = now
		return pooled.conn, nil
	}
	conn, err := dial(target)
	if err != nil {
		return nil, err
	}
	p.conns[key] = &pooledConnection{conn: conn, lastUsed: now}
	return conn, nil
}

func (p *connectionPool) evictIdle(now time.Time) {
	for key, pooled := range p.conns {
		if now.Sub(pooled.lastUsed) > idleConnectionTimeout {
			_ = pooled.conn.Close() // an idle connection has no call in flight; a close error changes nothing
			delete(p.conns, key)
		}
	}
}

// closeAll closes every pooled connection (sidecar shutdown, tests).
func (p *connectionPool) closeAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for key, pooled := range p.conns {
		_ = pooled.conn.Close() // shutting down: nothing to do with the error
		delete(p.conns, key)
	}
}

// CloseConnections closes the pooled client connections.
func CloseConnections() { connections.closeAll() }

func dial(target Target) (*grpc.ClientConn, error) {
	if target.Address == "" || !strings.Contains(target.Address, ":") {
		return nil, fmt.Errorf("invalid gRPC address: %s (expected host:port)", target.Address)
	}
	var options []grpc.DialOption
	if target.TLS {
		tlsConfig, err := grpcTLSConfig(target.CACertPath, target.ClientCertPath, target.ClientKeyPath)
		if err != nil {
			return nil, err
		}
		options = append(options, grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)))
	} else {
		options = append(options, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}
	// NewClient connects lazily and resolves with DNS by default; "passthrough" keeps host:port as written.
	address := target.Address
	if !strings.Contains(address, "://") {
		address = "passthrough:///" + address
	}
	conn, err := grpc.NewClient(address, options...)
	if err != nil {
		return nil, fmt.Errorf("failed to dial %s: %w", target.Address, err)
	}
	return conn, nil
}
