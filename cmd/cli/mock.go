package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/spf13/cobra"
)

var (
	mockPort     int
	mockPassword string
)

var mockCmd = &cobra.Command{
	Use:   "mock <config.json>",
	Short: "Start a mock server from a configuration file",
	Long:  "Start a local HTTP mock server using endpoint definitions from a JSON config file. Supports path matching, multiple response modes, and optional password protection.",
	Args:  cobra.ExactArgs(1),
	RunE:  runMockServer,
}

func init() {
	mockCmd.Flags().IntVarP(&mockPort, "port", "p", 9090, "Port to listen on")
	mockCmd.Flags().StringVar(&mockPassword, "password", "", "Optional password for mock server access")
}

type cliMockResponse struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Status   int               `json:"status"`
	Headers  map[string]string `json:"headers"`
	Body     string            `json:"body"`
	DelayMs  int               `json:"delayMs"`
	IsActive bool              `json:"isActive"`
}

type cliMockEndpoint struct {
	ID        string            `json:"id"`
	Path      string            `json:"path"`
	Method    string            `json:"method"`
	Responses []cliMockResponse `json:"responses"`
	Mode      string            `json:"mode"`
	rrIndex   uint64
}

type cliMockConfig struct {
	Port      int               `json:"port"`
	Password  string            `json:"password"`
	Endpoints []cliMockEndpoint `json:"endpoints"`
}

func runMockServer(cmd *cobra.Command, args []string) error {
	data, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("failed to read config: %w", err)
	}

	var cfg cliMockConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	if cmd.Flags().Changed("port") {
		cfg.Port = mockPort
	} else if cfg.Port == 0 {
		cfg.Port = mockPort
	}

	if mockPassword != "" {
		cfg.Password = mockPassword
	}

	if len(cfg.Endpoints) == 0 {
		return fmt.Errorf("no endpoints defined in config")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Password != "" {
			if r.Header.Get("X-Mock-Auth") != cfg.Password {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
		}

		ep, found := matchEndpoint(cfg.Endpoints, r.Method, r.URL.Path)
		if !found {
			http.Error(w, "No matching endpoint", http.StatusNotFound)
			fmt.Printf("  ✗ %s %s → 404 (no match)\n", r.Method, r.URL.Path)
			return
		}

		resp := selectResponse(ep)
		if resp == nil {
			http.Error(w, "No active response", http.StatusServiceUnavailable)
			fmt.Printf("  ✗ %s %s → 503 (no active response)\n", r.Method, r.URL.Path)
			return
		}

		if resp.DelayMs > 0 {
			time.Sleep(time.Duration(resp.DelayMs) * time.Millisecond)
		}

		for k, v := range resp.Headers {
			w.Header().Set(k, v)
		}
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", "application/json")
		}

		w.WriteHeader(resp.Status)
		fmt.Fprint(w, resp.Body)
		fmt.Printf("  ✓ %s %s → %d (%s)\n", r.Method, r.URL.Path, resp.Status, resp.Name)
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to bind port %d: %w", cfg.Port, err)
	}

	srv := &http.Server{Handler: mux}

	fmt.Printf("Mock server started on http://localhost:%d\n", cfg.Port)
	fmt.Printf("Endpoints: %d configured\n", len(cfg.Endpoints))
	for _, ep := range cfg.Endpoints {
		active := 0
		for _, r := range ep.Responses {
			if r.IsActive {
				active++
			}
		}
		fmt.Printf("  %s %s → %d responses (%d active, mode: %s)\n", ep.Method, ep.Path, len(ep.Responses), active, ep.Mode)
	}
	fmt.Println("\nPress Ctrl+C to stop...")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := srv.Serve(listener); err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		}
	}()

	<-sigCh
	fmt.Println("\nShutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	wg.Wait()
	fmt.Println("Mock server stopped.")
	return nil
}

func matchEndpoint(endpoints []cliMockEndpoint, method, path string) (*cliMockEndpoint, bool) {
	for i := range endpoints {
		ep := &endpoints[i]
		if !strings.EqualFold(ep.Method, method) && ep.Method != "*" && ep.Method != "" {
			continue
		}
		if matchPath(ep.Path, path) {
			return ep, true
		}
	}
	return nil, false
}

func matchPath(pattern, path string) bool {
	if pattern == path {
		return true
	}
	if strings.Contains(pattern, "**") {
		prefix := strings.Split(pattern, "**")[0]
		return strings.HasPrefix(path, prefix)
	}

	patParts := strings.Split(strings.Trim(pattern, "/"), "/")
	pathParts := strings.Split(strings.Trim(path, "/"), "/")

	if len(patParts) != len(pathParts) {
		return false
	}
	for i, pp := range patParts {
		if strings.HasPrefix(pp, ":") || pp == "*" {
			continue
		}
		if pp != pathParts[i] {
			return false
		}
	}
	return true
}

func selectResponse(ep *cliMockEndpoint) *cliMockResponse {
	var active []int
	for i, r := range ep.Responses {
		if r.IsActive {
			active = append(active, i)
		}
	}
	if len(active) == 0 {
		return nil
	}

	switch ep.Mode {
	case "random":
		idx := active[rand.Intn(len(active))]
		return &ep.Responses[idx]
	case "round_robin":
		n := atomic.AddUint64(&ep.rrIndex, 1) - 1
		idx := active[int(n)%len(active)]
		return &ep.Responses[idx]
	default:
		return &ep.Responses[active[0]]
	}
}
