package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
)

// --- Request / Response types ---

type grpcReflectRequest struct {
	Address  string            `json:"address"`
	TLS      bool              `json:"tls"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

type grpcMethodInfo struct {
	Name            string `json:"name"`
	InputType       string `json:"input_type"`
	OutputType      string `json:"output_type"`
	ClientStreaming bool   `json:"client_streaming"`
	ServerStreaming bool   `json:"server_streaming"`
}

type grpcServiceInfo struct {
	Name    string           `json:"name"`
	Methods []grpcMethodInfo `json:"methods"`
}

type grpcReflectResponse struct {
	Services []grpcServiceInfo `json:"services"`
}

type grpcDescribeRequest struct {
	Address     string            `json:"address"`
	TLS         bool              `json:"tls"`
	MessageType string            `json:"message_type"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

type grpcFieldInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Number   int32  `json:"number"`
	Repeated bool   `json:"repeated"`
}

type grpcDescribeResponse struct {
	Fields []grpcFieldInfo `json:"fields"`
}

type grpcInvokeRequest struct {
	Address  string            `json:"address"`
	TLS      bool              `json:"tls"`
	Service  string            `json:"service"`
	Method   string            `json:"method"`
	Payload  json.RawMessage   `json:"payload"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

type grpcInvokeResponse struct {
	Response         interface{}       `json:"response,omitempty"`
	Messages         []interface{}     `json:"messages,omitempty"`
	Error            string            `json:"error,omitempty"`
	Status           string            `json:"status"`
	TimeMs           int64             `json:"time_ms"`
	ResponseMetadata map[string]string `json:"response_metadata,omitempty"`
}

// --- Helpers ---

func grpcDial(address string, useTLS bool, timeout time.Duration) (*grpc.ClientConn, error) {
	if address == "" || !strings.Contains(address, ":") {
		return nil, fmt.Errorf("invalid gRPC address: %s (expected host:port)", address)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var opts []grpc.DialOption
	if useTLS {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{})))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	conn, err := grpc.DialContext(ctx, address, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to dial %s: %w", address, err)
	}
	return conn, nil
}

func grpcReflectionClient(ctx context.Context, conn *grpc.ClientConn) *grpcreflect.Client {
	stub := rpb.NewServerReflectionClient(conn)
	return grpcreflect.NewClientV1Alpha(ctx, stub)
}

func outgoingContext(ctx context.Context, md map[string]string) context.Context {
	if len(md) == 0 {
		return ctx
	}
	pairs := make([]string, 0, len(md)*2)
	for k, v := range md {
		pairs = append(pairs, k, v)
	}
	return metadata.NewOutgoingContext(ctx, metadata.Pairs(pairs...))
}

func fieldTypeName(fd *desc.FieldDescriptor) string {
	switch fd.GetType().String() {
	case "TYPE_MESSAGE":
		return fd.GetMessageType().GetFullyQualifiedName()
	case "TYPE_ENUM":
		return fd.GetEnumType().GetFullyQualifiedName()
	default:
		// Strip the TYPE_ prefix and lowercase
		name := fd.GetType().String()
		if len(name) > 5 && name[:5] == "TYPE_" {
			return lowercase(name[5:])
		}
		return name
	}
}

func lowercase(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// --- Handlers ---

// grpcReflectHandler handles POST /grpc/reflect
// Lists all services and their methods via server reflection.
func grpcReflectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req grpcReflectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == "" {
		http.Error(w, "address required", http.StatusBadRequest)
		return
	}

	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctx = outgoingContext(ctx, req.Metadata)

	refClient := grpcReflectionClient(ctx, conn)
	defer refClient.Reset()

	serviceNames, err := refClient.ListServices()
	if err != nil {
		http.Error(w, "reflection list services: "+err.Error(), http.StatusBadGateway)
		return
	}

	var services []grpcServiceInfo
	for _, svcName := range serviceNames {
		// Skip the reflection service itself
		if svcName == "grpc.reflection.v1alpha.ServerReflection" || svcName == "grpc.reflection.v1.ServerReflection" {
			continue
		}

		svcDesc, err := refClient.ResolveService(svcName)
		if err != nil {
			continue
		}

		var methods []grpcMethodInfo
		for _, md := range svcDesc.GetMethods() {
			methods = append(methods, grpcMethodInfo{
				Name:            md.GetName(),
				InputType:       md.GetInputType().GetFullyQualifiedName(),
				OutputType:      md.GetOutputType().GetFullyQualifiedName(),
				ClientStreaming: md.IsClientStreaming(),
				ServerStreaming: md.IsServerStreaming(),
			})
		}

		services = append(services, grpcServiceInfo{
			Name:    svcName,
			Methods: methods,
		})
	}

	writeJSON(w, http.StatusOK, grpcReflectResponse{Services: services})
}

// grpcDescribeHandler handles POST /grpc/describe
// Returns the field schema of a protobuf message type.
func grpcDescribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req grpcDescribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == "" {
		http.Error(w, "address required", http.StatusBadRequest)
		return
	}
	if req.MessageType == "" {
		http.Error(w, "message_type required", http.StatusBadRequest)
		return
	}

	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctx = outgoingContext(ctx, req.Metadata)

	refClient := grpcReflectionClient(ctx, conn)
	defer refClient.Reset()

	msgDesc, err := refClient.ResolveMessage(req.MessageType)
	if err != nil {
		http.Error(w, "resolve message type: "+err.Error(), http.StatusBadGateway)
		return
	}

	var fields []grpcFieldInfo
	for _, fd := range msgDesc.GetFields() {
		fields = append(fields, grpcFieldInfo{
			Name:     fd.GetName(),
			Type:     fieldTypeName(fd),
			Number:   fd.GetNumber(),
			Repeated: fd.IsRepeated(),
		})
	}

	writeJSON(w, http.StatusOK, grpcDescribeResponse{Fields: fields})
}

// grpcInvokeHandler handles POST /grpc/invoke
// Invokes a unary gRPC method with a JSON payload and returns the response.
func grpcInvokeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req grpcInvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == "" {
		http.Error(w, "address required", http.StatusBadRequest)
		return
	}
	if req.Service == "" {
		http.Error(w, "service required", http.StatusBadRequest)
		return
	}
	if req.Method == "" {
		http.Error(w, "method required", http.StatusBadRequest)
		return
	}

	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second)
	if err != nil {
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  err.Error(),
			Status: "UNAVAILABLE",
		})
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ctx = outgoingContext(ctx, req.Metadata)

	refClient := grpcReflectionClient(ctx, conn)
	defer refClient.Reset()

	// Resolve the service descriptor
	svcDesc, err := refClient.ResolveService(req.Service)
	if err != nil {
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  "resolve service: " + err.Error(),
			Status: "NOT_FOUND",
		})
		return
	}

	// Find the method
	methodDesc := svcDesc.FindMethodByName(req.Method)
	if methodDesc == nil {
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  fmt.Sprintf("method %q not found in service %q", req.Method, req.Service),
			Status: "NOT_FOUND",
		})
		return
	}
	if methodDesc.IsClientStreaming() {
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  "client-streaming and bidirectional-streaming calls require an interactive stream sender and are not supported by this beta client yet",
			Status: "UNIMPLEMENTED",
		})
		return
	}

	// Build dynamic request message from JSON payload
	inputMsg := dynamic.NewMessage(methodDesc.GetInputType())
	if len(req.Payload) > 0 && string(req.Payload) != "null" {
		if err := inputMsg.UnmarshalJSON(req.Payload); err != nil {
			writeJSON(w, http.StatusOK, grpcInvokeResponse{
				Error:  "unmarshal payload: " + err.Error(),
				Status: "INVALID_ARGUMENT",
			})
			return
		}
	}

	// Prepare output message
	outputMsg := dynamic.NewMessage(methodDesc.GetOutputType())

	// Build the full method name for invocation
	fullMethod := fmt.Sprintf("/%s/%s", req.Service, req.Method)

	// Invoke the RPC
	start := time.Now()
	var respHeaders metadata.MD
	if methodDesc.IsServerStreaming() {
		streamDesc := &grpc.StreamDesc{
			StreamName:    req.Method,
			ServerStreams: true,
			ClientStreams: false,
		}
		stream, err := conn.NewStream(ctx, streamDesc, fullMethod, grpc.Header(&respHeaders))
		if err != nil {
			st, _ := status.FromError(err)
			writeJSON(w, http.StatusOK, grpcInvokeResponse{
				Error:  st.Message(),
				Status: st.Code().String(),
				TimeMs: time.Since(start).Milliseconds(),
			})
			return
		}
		if err := stream.SendMsg(inputMsg); err != nil {
			st, _ := status.FromError(err)
			writeJSON(w, http.StatusOK, grpcInvokeResponse{
				Error:  st.Message(),
				Status: st.Code().String(),
				TimeMs: time.Since(start).Milliseconds(),
			})
			return
		}
		if err := stream.CloseSend(); err != nil {
			st, _ := status.FromError(err)
			writeJSON(w, http.StatusOK, grpcInvokeResponse{
				Error:  st.Message(),
				Status: st.Code().String(),
				TimeMs: time.Since(start).Milliseconds(),
			})
			return
		}

		messages := make([]interface{}, 0)
		for {
			msg := dynamic.NewMessage(methodDesc.GetOutputType())
			err := stream.RecvMsg(msg)
			if err == io.EOF {
				break
			}
			if err != nil {
				st, _ := status.FromError(err)
				writeJSON(w, http.StatusOK, grpcInvokeResponse{
					Messages: messages,
					Error:    st.Message(),
					Status:   st.Code().String(),
					TimeMs:   time.Since(start).Milliseconds(),
				})
				return
			}
			msgJSON, err := msg.MarshalJSON()
			if err != nil {
				writeJSON(w, http.StatusOK, grpcInvokeResponse{
					Messages: messages,
					Error:    "marshal stream message: " + err.Error(),
					Status:   "INTERNAL",
					TimeMs:   time.Since(start).Milliseconds(),
				})
				return
			}
			var item interface{}
			json.Unmarshal(msgJSON, &item)
			messages = append(messages, item)
		}

		respMeta := make(map[string]string)
		for k, vals := range respHeaders {
			if len(vals) > 0 {
				respMeta[k] = vals[0]
			}
		}
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Messages:         messages,
			Status:           "OK",
			TimeMs:           time.Since(start).Milliseconds(),
			ResponseMetadata: respMeta,
		})
		return
	}

	err = conn.Invoke(ctx, fullMethod, inputMsg, outputMsg,
		grpc.Header(&respHeaders),
	)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		st, _ := status.FromError(err)
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  st.Message(),
			Status: st.Code().String(),
			TimeMs: elapsed,
		})
		return
	}

	// Marshal response to JSON
	respJSON, err := outputMsg.MarshalJSON()
	if err != nil {
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  "marshal response: " + err.Error(),
			Status: "INTERNAL",
			TimeMs: elapsed,
		})
		return
	}

	var respData interface{}
	json.Unmarshal(respJSON, &respData)

	// Collect response metadata
	respMeta := make(map[string]string)
	for k, vals := range respHeaders {
		if len(vals) > 0 {
			respMeta[k] = vals[0]
		}
	}

	writeJSON(w, http.StatusOK, grpcInvokeResponse{
		Response:         respData,
		Status:           "OK",
		TimeMs:           elapsed,
		ResponseMetadata: respMeta,
	})
}
