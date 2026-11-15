// Package agentcontrol connects local MCP processes to an already running IDE.
package agentcontrol

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxMessage = 2 * 1024 * 1024

type Request struct {
	Project   string         `json:"project"`
	Operation string         `json:"operation"`
	Arguments map[string]any `json:"arguments"`
}
type Endpoint struct {
	Address string `json:"address"`
	Token   string `json:"token"`
}
type Handler func(context.Context, Request) (any, error)
type Server struct {
	http     *http.Server
	endpoint Endpoint
	path     string
}

// Discovery is per desktop process, outside project folders and version control.
func Directory() (string, error) {
	base, err := os.UserConfigDir()
	return filepath.Join(base, "adOmnia", "agent-control"), err
}
func Start(directory string, handler Handler) (*Server, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	token := make([]byte, 32)
	if _, err = rand.Read(token); err != nil {
		listener.Close()
		return nil, err
	}
	server := &Server{endpoint: Endpoint{Address: "http://" + listener.Addr().String(), Token: hex.EncodeToString(token)}, path: filepath.Join(directory, fmt.Sprintf("%d.json", os.Getpid()))}
	if err = os.MkdirAll(directory, 0700); err != nil {
		listener.Close()
		return nil, err
	}
	encoded, err := json.Marshal(server.endpoint)
	if err == nil {
		err = os.WriteFile(server.path, encoded, 0600)
	}
	if err != nil {
		listener.Close()
		return nil, err
	}
	server.http = &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 60 * time.Second, MaxHeaderBytes: 8192, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/call" {
			http.NotFound(w, r)
			return
		}
		// Browser pages must never be able to invoke the desktop bridge.
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if r.Header.Get("Origin") != "" || subtle.ConstantTimeCompare([]byte(provided), []byte(server.endpoint.Token)) != 1 {
			http.Error(w, "unauthorized", 401)
			return
		}
		var request Request
		if err := json.UnmarshalRead(http.MaxBytesReader(w, r.Body, MaxMessage), &request); err != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		value, err := handler(r.Context(), request)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.MarshalWrite(w, value); err != nil {
			return
		}
	})}
	go func() { _ = server.http.Serve(listener) }()
	return server, nil
}
func (s *Server) Close() error {
	_ = os.Remove(s.path)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return s.http.Shutdown(ctx)
}

// Call never follows redirects and accepts only loopback discovery addresses.
func Call(ctx context.Context, directory string, request Request) (any, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, errors.New("open adOmnia desktop before using IDE tools")
	}
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 55 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var last error
	var candidates []Endpoint
	var status any
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil || len(content) > 4096 {
			continue
		}
		var endpoint Endpoint
		if json.Unmarshal(content, &endpoint) != nil || !strings.HasPrefix(endpoint.Address, "http://127.0.0.1:") || len(endpoint.Token) != 64 {
			continue
		}
		address := strings.TrimPrefix(endpoint.Address, "http://")
		host, port, err := net.SplitHostPort(address)
		if err != nil || host != "127.0.0.1" || strings.ContainsAny(port, "/?#") {
			continue
		}
		probe, cancel := context.WithTimeout(ctx, 2*time.Second)
		probeData, _ := json.Marshal(Request{Project: request.Project, Operation: "ide_status", Arguments: request.Arguments})
		req, err := http.NewRequestWithContext(probe, http.MethodPost, endpoint.Address+"/call", bytes.NewReader(probeData))
		if err != nil {
			cancel()
			continue
		}
		req.Header.Set("Authorization", "Bearer "+endpoint.Token)
		req.Header.Set("Content-Type", "application/json")
		response, err := client.Do(req)
		if err != nil {
			cancel()
			last = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, MaxMessage+1))
		response.Body.Close()
		cancel()
		if readErr != nil {
			return nil, readErr
		}
		if len(body) > MaxMessage {
			return nil, errors.New("IDE response exceeds limit")
		}
		if response.StatusCode != 200 {
			last = fmt.Errorf("IDE: %s", strings.TrimSpace(string(body)))
			continue
		}
		var result any
		if err = json.Unmarshal(body, &result); err != nil {
			return nil, err
		}
		candidates = append(candidates, endpoint)
		status = result
	}
	if len(candidates) > 1 {
		return nil, errors.New("project is open in multiple adOmnia processes; close the duplicate before controlling it")
	}
	if len(candidates) == 1 {
		if request.Operation == "ide_status" {
			return status, nil
		}
		endpoint := candidates[0]
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.Address+"/call", bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+endpoint.Token)
		req.Header.Set("Content-Type", "application/json")
		response, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, MaxMessage+1))
		if err != nil {
			return nil, err
		}
		if len(body) > MaxMessage {
			return nil, errors.New("IDE response exceeds limit")
		}
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("IDE: %s", strings.TrimSpace(string(body)))
		}
		var result any
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if last != nil {
		return nil, last
	}
	return nil, errors.New("no running adOmnia IDE found")
}
