package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"

	pb "adomnia/proto/sdk"

	bolt "go.etcd.io/bbolt"
	"google.golang.org/grpc"
)

// SDKServer implements the AdOmniaAPI gRPC service.
// Python workers call this server to access adOmnia state.
type SDKServer struct {
	pb.UnimplementedAdOmniaAPIServer
	grpcServer *grpc.Server
	port       int
	app        *App

	// eventCallback is called when a plugin emits an event
	eventCallback func(name string, payload []byte)
}

func NewSDKServer(app *App) *SDKServer {
	return &SDKServer{
		app: app,
	}
}

func (s *SDKServer) Start() (int, error) {
	port, err := getFreePort()
	if err != nil {
		return 0, fmt.Errorf("failed to get free port for SDK server: %w", err)
	}

	lis, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", port))
	if err != nil {
		return 0, fmt.Errorf("failed to listen on port %d: %w", port, err)
	}

	s.grpcServer = grpc.NewServer()
	pb.RegisterAdOmniaAPIServer(s.grpcServer, s)
	s.port = port

	go func() {
		if err := s.grpcServer.Serve(lis); err != nil {
			log.Printf("[sdk-server] gRPC server error: %v", err)
		}
	}()

	log.Printf("[sdk-server] started on port %d", port)
	return port, nil
}

func (s *SDKServer) Stop() {
	if s.grpcServer != nil {
		s.grpcServer.GracefulStop()
		log.Printf("[sdk-server] stopped")
	}
}

func (s *SDKServer) SetEventCallback(cb func(name string, payload []byte)) {
	s.eventCallback = cb
}

// GetCurrentRequest returns the current HTTP request from the composer.
func (s *SDKServer) GetCurrentRequest(ctx context.Context, _ *pb.Empty) (*pb.HttpRequest, error) {
	// Read from the app's current state via storage
	if storeDB == nil {
		return &pb.HttpRequest{}, nil
	}

	var reqData []byte
	storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("workspace"))
		if b != nil {
			reqData = b.Get([]byte("current_request"))
		}
		return nil
	})

	if reqData == nil {
		return &pb.HttpRequest{
			Method: "GET",
			Url:    "",
		}, nil
	}

	var req struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	if err := json.Unmarshal(reqData, &req); err != nil {
		return &pb.HttpRequest{Method: "GET"}, nil
	}

	return &pb.HttpRequest{
		Method:  req.Method,
		Url:     req.URL,
		Headers: req.Headers,
		Body:    []byte(req.Body),
	}, nil
}

// EmitEvent forwards a plugin event toward the frontend via Wails events.
func (s *SDKServer) EmitEvent(ctx context.Context, event *pb.Event) (*pb.Empty, error) {
	log.Printf("[sdk-server] event received: %s", event.Name)

	if s.eventCallback != nil {
		s.eventCallback(event.Name, event.Payload)
	}

	return &pb.Empty{}, nil
}

// Log handles structured log entries from Python workers.
func (s *SDKServer) Log(ctx context.Context, entry *pb.LogEntry) (*pb.Empty, error) {
	fields := ""
	if len(entry.Fields) > 0 {
		b, _ := json.Marshal(entry.Fields)
		fields = " " + string(b)
	}

	switch entry.Level {
	case "error":
		log.Printf("[plugin] ERROR: %s%s", entry.Message, fields)
	case "warn":
		log.Printf("[plugin] WARN: %s%s", entry.Message, fields)
	case "debug":
		log.Printf("[plugin] DEBUG: %s%s", entry.Message, fields)
	default:
		log.Printf("[plugin] INFO: %s%s", entry.Message, fields)
	}

	return &pb.Empty{}, nil
}

// GetEnvVariables returns the active environment variables from adOmnia.
func (s *SDKServer) GetEnvVariables(ctx context.Context, _ *pb.Empty) (*pb.EnvVariables, error) {
	if storeDB == nil {
		return &pb.EnvVariables{Variables: map[string]string{}}, nil
	}

	var envData []byte
	storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("workspace"))
		if b != nil {
			envData = b.Get([]byte("active_env"))
		}
		return nil
	})

	if envData == nil {
		return &pb.EnvVariables{Variables: map[string]string{}}, nil
	}

	var env struct {
		Variables []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"variables"`
	}
	if err := json.Unmarshal(envData, &env); err != nil {
		return &pb.EnvVariables{Variables: map[string]string{}}, nil
	}

	vars := make(map[string]string, len(env.Variables))
	for _, v := range env.Variables {
		vars[v.Key] = v.Value
	}

	return &pb.EnvVariables{Variables: vars}, nil
}

// StorageGet reads from plugin-specific storage.
func (s *SDKServer) StorageGet(ctx context.Context, key *pb.StorageKey) (*pb.StorageValue, error) {
	if storeDB == nil {
		return &pb.StorageValue{Found: false}, nil
	}

	var value []byte
	storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("plugin_storage"))
		if b != nil {
			v := b.Get([]byte(key.Key))
			if v != nil {
				value = make([]byte, len(v))
				copy(value, v)
			}
		}
		return nil
	})

	if value == nil {
		return &pb.StorageValue{Found: false}, nil
	}

	return &pb.StorageValue{Value: value, Found: true}, nil
}

// StorageSet writes to plugin-specific storage.
func (s *SDKServer) StorageSet(ctx context.Context, entry *pb.StorageEntry) (*pb.Empty, error) {
	if storeDB == nil {
		return nil, fmt.Errorf("storage not available")
	}

	err := storeDB.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte("plugin_storage"))
		if err != nil {
			return err
		}
		return b.Put([]byte(entry.Key), entry.Value)
	})
	if err != nil {
		return nil, fmt.Errorf("storage write failed: %w", err)
	}

	return &pb.Empty{}, nil
}
