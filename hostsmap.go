package main

import (
	"context"
	"net"
	"strings"
	"time"
)

// HostMapEntry is the DNS-override entry sent by the frontend.
// It mirrors the TypeScript HostEntry interface (only the fields needed at dial time).
type HostMapEntry struct {
	Host    string `json:"host"`
	IP      string `json:"ip"`
	Enabled bool   `json:"enabled"`
}

// buildDialerWithHosts returns a DialContext function that overrides hostname
// resolution for entries in the provided map.
//
// Resolution priority:
//  1. "hostname:port" exact match (most specific)
//  2. "hostname" match (port-agnostic)
//  3. system DNS (fallback)
//
// The Host header and TLS ServerName are NOT modified here — only the TCP
// dial target changes — so SNI and virtual hosting continue to work correctly.
func buildDialerWithHosts(entries []HostMapEntry) func(ctx context.Context, network, addr string) (net.Conn, error) {
	// Build lookup maps
	byHostPort := map[string]string{} // "host:port" → ip
	byHost := map[string]string{}     // "host"      → ip

	for _, e := range entries {
		if !e.Enabled || e.Host == "" || e.IP == "" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(e.Host))
		ip := strings.TrimSpace(e.IP)

		if strings.Contains(key, ":") {
			// Entry already includes port (e.g. "api.example.com:443")
			byHostPort[key] = ip
		} else {
			byHost[key] = ip
		}
	}

	base := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			// addr has no port — dial as-is
			return base.DialContext(ctx, network, addr)
		}

		lowerHost := strings.ToLower(host)

		// Check "host:port" first, then "host"
		if ip, ok := byHostPort[lowerHost+":"+port]; ok {
			addr = net.JoinHostPort(ip, port)
		} else if ip, ok := byHost[lowerHost]; ok {
			addr = net.JoinHostPort(ip, port)
		}

		return base.DialContext(ctx, network, addr)
	}
}
