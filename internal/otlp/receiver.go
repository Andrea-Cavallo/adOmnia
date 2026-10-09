package otlp

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

const (
	DefaultHTTPPort = 4318
	DefaultGRPCPort = 4317
	maxBodyBytes    = 16 << 20
	maxStoredSpans  = 50_000
)

// Status describes the receiver for the UI.
type Status struct {
	Running  bool   `json:"running"`
	HTTPAddr string `json:"httpAddr,omitempty"`
	GRPCAddr string `json:"grpcAddr,omitempty"`
	Traces   int    `json:"traces"`
	Spans    int    `json:"spans"`
	Error    string `json:"error,omitempty"`
}

// Receiver listens on loopback only, for OTLP/HTTP (/v1/traces) and OTLP/gRPC.
type Receiver struct {
	mu         sync.Mutex
	store      *Store
	httpServer *http.Server
	grpcServer *grpc.Server
	httpAddr   string
	grpcAddr   string
	lastError  string
}

func NewReceiver() *Receiver { return &Receiver{store: NewStore(maxStoredSpans)} }

func (r *Receiver) Store() *Store { return r.store }

// Start opens both listeners; a port of 0 picks a free one (tests), -1 disables that protocol.
func (r *Receiver) Start(httpPort, grpcPort int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.httpServer != nil || r.grpcServer != nil {
		return nil
	}
	var httpListener, grpcListener net.Listener
	var err error
	if httpPort >= 0 {
		if httpListener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", httpPort)); err != nil {
			r.lastError = err.Error()
			return fmt.Errorf("OTLP/HTTP port %d: %w", httpPort, err)
		}
	}
	if grpcPort >= 0 {
		if grpcListener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", grpcPort)); err != nil {
			if httpListener != nil {
				_ = httpListener.Close()
			}
			r.lastError = err.Error()
			return fmt.Errorf("OTLP/gRPC port %d: %w", grpcPort, err)
		}
	}
	r.lastError = ""
	if httpListener != nil {
		mux := http.NewServeMux()
		mux.HandleFunc("/v1/traces", r.handleHTTP)
		r.httpServer = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
		r.httpAddr = httpListener.Addr().String()
		go func(server *http.Server) { _ = server.Serve(httpListener) }(r.httpServer)
	}
	if grpcListener != nil {
		r.grpcServer = grpc.NewServer(grpc.MaxRecvMsgSize(maxBodyBytes))
		coltracepb.RegisterTraceServiceServer(r.grpcServer, traceService{store: r.store})
		r.grpcAddr = grpcListener.Addr().String()
		go func(server *grpc.Server) { _ = server.Serve(grpcListener) }(r.grpcServer)
	}
	return nil
}

func (r *Receiver) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = r.httpServer.Shutdown(ctx)
		cancel()
		r.httpServer = nil
	}
	if r.grpcServer != nil {
		r.grpcServer.Stop()
		r.grpcServer = nil
	}
	r.httpAddr, r.grpcAddr = "", ""
}

func (r *Receiver) Status() Status {
	r.mu.Lock()
	status := Status{Running: r.httpServer != nil || r.grpcServer != nil, HTTPAddr: r.httpAddr, GRPCAddr: r.grpcAddr, Error: r.lastError}
	r.mu.Unlock()
	status.Traces, status.Spans = r.store.Counts()
	return status
}

func (r *Receiver) handleHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var body io.Reader = http.MaxBytesReader(w, req.Body, maxBodyBytes)
	if strings.EqualFold(req.Header.Get("Content-Encoding"), "gzip") {
		reader, err := gzip.NewReader(body)
		if err != nil {
			http.Error(w, "invalid gzip body", http.StatusBadRequest)
			return
		}
		defer reader.Close()
		body = io.LimitReader(reader, maxBodyBytes)
	}
	data, err := io.ReadAll(body)
	if err != nil {
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return
	}
	isJSON := strings.HasPrefix(req.Header.Get("Content-Type"), "application/json")
	request := &coltracepb.ExportTraceServiceRequest{}
	if isJSON {
		request, err = DecodeJSON(data)
	} else {
		err = proto.Unmarshal(data, request)
	}
	if err != nil {
		http.Error(w, "invalid OTLP payload: "+err.Error(), http.StatusBadRequest)
		return
	}
	r.store.Add(Convert(request))
	if isJSON {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
		return
	}
	w.Header().Set("Content-Type", "application/x-protobuf")
	out, _ := proto.Marshal(&coltracepb.ExportTraceServiceResponse{})
	_, _ = w.Write(out)
}

type traceService struct {
	coltracepb.UnimplementedTraceServiceServer
	store *Store
}

func (s traceService) Export(_ context.Context, request *coltracepb.ExportTraceServiceRequest) (*coltracepb.ExportTraceServiceResponse, error) {
	if request == nil {
		return nil, errors.New("empty request")
	}
	s.store.Add(Convert(request))
	return &coltracepb.ExportTraceServiceResponse{}, nil
}
