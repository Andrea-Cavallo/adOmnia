package proxy

import (
	"net/http"
	"testing"
)

func TestForwardTargetError(t *testing.T) {
	cases := []struct {
		name   string
		target string
		port   int
		status int // 0 = allowed
	}{
		{"plain http", "http://example.com/a?b=1", 8888, 0},
		{"https", "https://example.com:8443/", 8888, 0},
		{"another local service", "http://127.0.0.1:3000/api", 8888, 0},
		{"own port on loopback", "http://127.0.0.1:8888/x", 8888, http.StatusLoopDetected},
		{"own port on localhost", "http://localhost:8888/x", 8888, http.StatusLoopDetected},
		{"own port on ipv6 loopback", "http://[::1]:8888/", 8888, http.StatusLoopDetected},
		{"own port on a remote host is fine", "http://example.com:8888/", 8888, 0},
		{"file scheme", "file:///etc/passwd", 8888, http.StatusBadGateway},
		{"gopher scheme", "gopher://example.com/", 8888, http.StatusBadGateway},
		{"no host", "http:///path", 8888, http.StatusBadGateway},
		{"garbage", "http://[::1", 8888, http.StatusBadGateway},
		{"proxy not started", "http://127.0.0.1:8888/", 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := forwardTargetError(tc.target, tc.port)
			switch {
			case tc.status == 0 && err != nil:
				t.Fatalf("%s must be forwarded, got %v", tc.target, err)
			case tc.status != 0 && err == nil:
				t.Fatalf("%s must be refused", tc.target)
			case tc.status != 0 && err.status != tc.status:
				t.Fatalf("%s: status %d, want %d", tc.target, err.status, tc.status)
			}
		})
	}
}
