package grpc

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
	"github.com/jhump/protoreflect/dynamic"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// --- Request / Response types ---

type grpcReflectRequest struct {
	Address        string            `json:"address"`
	TLS            bool              `json:"tls"`
	CACertPath     string            `json:"ca_cert_path,omitempty"`
	ClientCertPath string            `json:"client_cert_path,omitempty"`
	ClientKeyPath  string            `json:"client_key_path,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
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
	Services []grpcServiceInfo          `json:"services"`
	Schemas  map[string][]grpcFieldInfo `json:"schemas,omitempty"`
	Enums    map[string][]grpcEnumValue `json:"enums,omitempty"`
	Files    []string                   `json:"files,omitempty"`
}

type grpcDescribeRequest struct {
	Address        string            `json:"address"`
	TLS            bool              `json:"tls"`
	CACertPath     string            `json:"ca_cert_path,omitempty"`
	ClientCertPath string            `json:"client_cert_path,omitempty"`
	ClientKeyPath  string            `json:"client_key_path,omitempty"`
	MessageType    string            `json:"message_type"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

type grpcFieldInfo struct {
	Name         string          `json:"name"`
	ProtoName    string          `json:"proto_name,omitempty"`
	Type         string          `json:"type"`
	Kind         string          `json:"kind,omitempty"`
	Number       int32           `json:"number"`
	Repeated     bool            `json:"repeated"`
	Map          bool            `json:"map,omitempty"`
	Required     bool            `json:"required,omitempty"`
	Optional     bool            `json:"optional,omitempty"`
	Oneof        bool            `json:"oneof,omitempty"`
	OneofName    string          `json:"oneof_name,omitempty"`
	OneofFields  []grpcFieldInfo `json:"oneof_fields,omitempty"`
	MessageType  string          `json:"message_type,omitempty"`
	EnumType     string          `json:"enum_type,omitempty"`
	EnumValues   []grpcEnumValue `json:"enum_values,omitempty"`
	KeyType      string          `json:"key_type,omitempty"`
	ValueType    string          `json:"value_type,omitempty"`
	DefaultValue interface{}     `json:"default_value,omitempty"`
	Description  string          `json:"description,omitempty"`
}

type grpcDescribeResponse struct {
	Fields  []grpcFieldInfo            `json:"fields"`
	Schemas map[string][]grpcFieldInfo `json:"schemas,omitempty"`
	Enums   map[string][]grpcEnumValue `json:"enums,omitempty"`
}

type grpcEnumValue struct {
	Name   string `json:"name"`
	Number int32  `json:"number"`
}

type grpcInvokeRequest struct {
	Address        string            `json:"address"`
	TLS            bool              `json:"tls"`
	CACertPath     string            `json:"ca_cert_path,omitempty"`
	ClientCertPath string            `json:"client_cert_path,omitempty"`
	ClientKeyPath  string            `json:"client_key_path,omitempty"`
	Service        string            `json:"service"`
	Method         string            `json:"method"`
	Payload        json.RawMessage   `json:"payload"`
	Messages       []json.RawMessage `json:"messages,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	TimeoutMs      int               `json:"timeout_ms,omitempty"`
}

type grpcInvokeResponse struct {
	Response         interface{}       `json:"response,omitempty"`
	Messages         []interface{}     `json:"messages,omitempty"`
	Error            string            `json:"error,omitempty"`
	Status           string            `json:"status"`
	TimeMs           int64             `json:"time_ms"`
	ResponseMetadata map[string]string `json:"response_metadata,omitempty"`
	ResponseTrailers map[string]string `json:"response_trailers,omitempty"`
}

// --- Helpers ---

func grpcTLSConfig(caCertPath, clientCertPath, clientKeyPath string) (*tls.Config, error) {
	config := &tls.Config{MinVersion: tls.VersionTLS12}
	if caCertPath != "" {
		pemBytes, err := os.ReadFile(caCertPath)
		if err != nil {
			return nil, fmt.Errorf("read CA certificate: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pemBytes) {
			return nil, fmt.Errorf("CA certificate is not valid PEM")
		}
		config.RootCAs = pool
	}
	if clientCertPath != "" || clientKeyPath != "" {
		if clientCertPath == "" || clientKeyPath == "" {
			return nil, fmt.Errorf("client certificate and client key must be provided together for mTLS")
		}
		cert, err := tls.LoadX509KeyPair(clientCertPath, clientKeyPath)
		if err != nil {
			return nil, fmt.Errorf("load client certificate/key: %w", err)
		}
		config.Certificates = []tls.Certificate{cert}
	}
	return config, nil
}

func grpcDial(address string, useTLS bool, timeout time.Duration, caCertPath, clientCertPath, clientKeyPath string) (*grpc.ClientConn, error) {
	if address == "" || !strings.Contains(address, ":") {
		return nil, fmt.Errorf("invalid gRPC address: %s (expected host:port)", address)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var opts []grpc.DialOption
	if useTLS {
		tlsConfig, err := grpcTLSConfig(caCertPath, clientCertPath, clientKeyPath)
		if err != nil {
			return nil, err
		}
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)))
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

func fieldKind(fd *desc.FieldDescriptor) string {
	name := strings.TrimPrefix(fd.GetType().String(), "TYPE_")
	return lowercase(name)
}

func normalizeDefaultValue(v interface{}) interface{} {
	switch value := v.(type) {
	case int64:
		return fmt.Sprintf("%d", value)
	case uint64:
		return fmt.Sprintf("%d", value)
	case []byte:
		if value == nil {
			return ""
		}
		return base64.StdEncoding.EncodeToString(value)
	default:
		return value
	}
}

func enumValues(ed *desc.EnumDescriptor) []grpcEnumValue {
	if ed == nil {
		return nil
	}
	values := make([]grpcEnumValue, 0, len(ed.GetValues()))
	for _, val := range ed.GetValues() {
		values = append(values, grpcEnumValue{Name: val.GetName(), Number: val.GetNumber()})
	}
	return values
}

func mapKeyValueTypes(fd *desc.FieldDescriptor) (string, string) {
	if !fd.IsMap() || fd.GetMessageType() == nil {
		return "", ""
	}
	key := fd.GetMessageType().FindFieldByName("key")
	value := fd.GetMessageType().FindFieldByName("value")
	keyType := ""
	valueType := ""
	if key != nil {
		keyType = fieldTypeName(key)
	}
	if value != nil {
		valueType = fieldTypeName(value)
	}
	return keyType, valueType
}

func buildFieldInfo(fd *desc.FieldDescriptor) grpcFieldInfo {
	info := grpcFieldInfo{
		Name:         fd.GetJSONName(),
		ProtoName:    fd.GetName(),
		Type:         fieldTypeName(fd),
		Kind:         fieldKind(fd),
		Number:       fd.GetNumber(),
		Repeated:     fd.IsRepeated(),
		Map:          fd.IsMap(),
		Required:     fd.IsRequired(),
		Optional:     fd.IsProto3Optional() || (!fd.GetFile().IsProto3() && !fd.IsRequired() && !fd.IsRepeated()),
		DefaultValue: normalizeDefaultValue(fd.GetDefaultValue()),
	}
	if fd.GetMessageType() != nil {
		info.MessageType = fd.GetMessageType().GetFullyQualifiedName()
	}
	if fd.GetEnumType() != nil {
		info.EnumType = fd.GetEnumType().GetFullyQualifiedName()
		info.EnumValues = enumValues(fd.GetEnumType())
	}
	if fd.GetOneOf() != nil {
		info.OneofName = fd.GetOneOf().GetName()
	}
	if fd.IsMap() {
		info.KeyType, info.ValueType = mapKeyValueTypes(fd)
		info.DefaultValue = map[string]interface{}{}
	}
	label := ""
	if info.Required {
		label = "required "
	} else if info.Repeated {
		label = "repeated "
	} else if info.Optional {
		label = "optional "
	}
	info.Description = fmt.Sprintf("%s%s %s = %d;", label, info.Type, info.ProtoName, info.Number)
	return info
}

func buildOneofInfo(ood *desc.OneOfDescriptor) grpcFieldInfo {
	choices := make([]grpcFieldInfo, 0, len(ood.GetChoices()))
	for _, choice := range ood.GetChoices() {
		field := buildFieldInfo(choice)
		field.Oneof = true
		field.OneofName = ood.GetName()
		choices = append(choices, field)
	}
	return grpcFieldInfo{
		Name:        ood.GetName(),
		ProtoName:   ood.GetName(),
		Type:        "oneof",
		Kind:        "oneof",
		Oneof:       true,
		OneofName:   ood.GetName(),
		OneofFields: choices,
		Description: fmt.Sprintf("oneof %s", ood.GetName()),
	}
}

func collectMessageSchema(md *desc.MessageDescriptor, schemas map[string][]grpcFieldInfo, enums map[string][]grpcEnumValue) {
	if md == nil {
		return
	}
	name := md.GetFullyQualifiedName()
	if _, seen := schemas[name]; seen {
		return
	}
	fields := make([]grpcFieldInfo, 0, len(md.GetFields()))
	schemas[name] = fields
	oneofsSeen := map[*desc.OneOfDescriptor]struct{}{}
	for _, fd := range md.GetFields() {
		if fd.GetEnumType() != nil {
			enums[fd.GetEnumType().GetFullyQualifiedName()] = enumValues(fd.GetEnumType())
		}
		if fd.GetOneOf() != nil {
			ood := fd.GetOneOf()
			if _, seen := oneofsSeen[ood]; seen {
				continue
			}
			oneofsSeen[ood] = struct{}{}
			fields = append(fields, buildOneofInfo(ood))
			for _, choice := range ood.GetChoices() {
				if choice.GetMessageType() != nil && !choice.IsMap() {
					collectMessageSchema(choice.GetMessageType(), schemas, enums)
				}
			}
			continue
		}
		fields = append(fields, buildFieldInfo(fd))
		if fd.GetMessageType() != nil && !fd.IsMap() {
			collectMessageSchema(fd.GetMessageType(), schemas, enums)
		}
	}
	schemas[name] = fields
	for _, nested := range md.GetNestedMessageTypes() {
		collectMessageSchema(nested, schemas, enums)
	}
	for _, enumDesc := range md.GetNestedEnumTypes() {
		enums[enumDesc.GetFullyQualifiedName()] = enumValues(enumDesc)
	}
}

func collectFileSchemas(fds []*desc.FileDescriptor) (map[string][]grpcFieldInfo, map[string][]grpcEnumValue, []string) {
	schemas := map[string][]grpcFieldInfo{}
	enums := map[string][]grpcEnumValue{}
	files := make([]string, 0, len(fds))
	for _, fd := range fds {
		files = append(files, fd.GetName())
		for _, enumDesc := range fd.GetEnumTypes() {
			enums[enumDesc.GetFullyQualifiedName()] = enumValues(enumDesc)
		}
		for _, msg := range fd.GetMessageTypes() {
			collectMessageSchema(msg, schemas, enums)
		}
	}
	return schemas, enums, files
}

func grpcParseServicesFromFiles(fds []*desc.FileDescriptor) []grpcParseProtoService {
	var services []grpcParseProtoService
	for _, fd := range fds {
		pkg := fd.GetPackage()
		for _, sd := range fd.GetServices() {
			name := sd.GetName()
			if pkg != "" {
				name = pkg + "." + name
			}
			methods := make([]grpcParseProtoMethod, 0, len(sd.GetMethods()))
			for _, md := range sd.GetMethods() {
				methods = append(methods, grpcParseProtoMethod{
					Name:            md.GetName(),
					InputType:       md.GetInputType().GetFullyQualifiedName(),
					OutputType:      md.GetOutputType().GetFullyQualifiedName(),
					ClientStreaming: md.IsClientStreaming(),
					ServerStreaming: md.IsServerStreaming(),
				})
			}
			services = append(services, grpcParseProtoService{Name: name, Methods: methods})
		}
	}
	return services
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

	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second, req.CACertPath, req.ClientCertPath, req.ClientKeyPath)
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
	fileSet := map[string]*desc.FileDescriptor{}
	for _, svcName := range serviceNames {
		// Skip the reflection service itself
		if svcName == "grpc.reflection.v1alpha.ServerReflection" || svcName == "grpc.reflection.v1.ServerReflection" {
			continue
		}

		svcDesc, err := refClient.ResolveService(svcName)
		if err != nil {
			continue
		}
		if svcDesc.GetFile() != nil {
			fileSet[svcDesc.GetFile().GetName()] = svcDesc.GetFile()
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

	files := make([]*desc.FileDescriptor, 0, len(fileSet))
	for _, fd := range fileSet {
		files = append(files, fd)
	}
	schemas, enums, fileNames := collectFileSchemas(files)
	writeJSON(w, http.StatusOK, grpcReflectResponse{Services: services, Schemas: schemas, Enums: enums, Files: fileNames})
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

	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second, req.CACertPath, req.ClientCertPath, req.ClientKeyPath)
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

	schemas := map[string][]grpcFieldInfo{}
	enums := map[string][]grpcEnumValue{}
	collectMessageSchema(msgDesc, schemas, enums)
	writeJSON(w, http.StatusOK, grpcDescribeResponse{Fields: schemas[msgDesc.GetFullyQualifiedName()], Schemas: schemas, Enums: enums})
}

// grpcInvokeHandler handles POST /grpc/invoke.
// Unary and server-streaming calls use payload; client and bidi streams use messages.
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

	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second, req.CACertPath, req.ClientCertPath, req.ClientKeyPath)
	if err != nil {
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:  err.Error(),
			Status: "UNAVAILABLE",
		})
		return
	}
	defer conn.Close()

	timeout := 30 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
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
	inputPayloads := []json.RawMessage{req.Payload}
	if methodDesc.IsClientStreaming() {
		inputPayloads = req.Messages
		if len(inputPayloads) == 0 {
			inputPayloads = []json.RawMessage{req.Payload}
		}
	}
	inputMessages := make([]*dynamic.Message, 0, len(inputPayloads))
	for index, rawPayload := range inputPayloads {
		inputMsg := dynamic.NewMessage(methodDesc.GetInputType())
		if len(rawPayload) > 0 && string(rawPayload) != "null" {
			if err := inputMsg.UnmarshalJSON(rawPayload); err != nil {
				label := "payload"
				if methodDesc.IsClientStreaming() {
					label = fmt.Sprintf("message %d", index+1)
				}
				writeJSON(w, http.StatusOK, grpcInvokeResponse{
					Error:  "unmarshal " + label + ": " + err.Error(),
					Status: "INVALID_ARGUMENT",
				})
				return
			}
		}
		inputMessages = append(inputMessages, inputMsg)
	}

	// Prepare output message
	outputMsg := dynamic.NewMessage(methodDesc.GetOutputType())

	// Build the full method name for invocation
	fullMethod := fmt.Sprintf("/%s/%s", req.Service, req.Method)

	// Invoke the RPC
	start := time.Now()
	var respHeaders metadata.MD
	var respTrailers metadata.MD
	if methodDesc.IsClientStreaming() || methodDesc.IsServerStreaming() {
		streamDesc := &grpc.StreamDesc{
			StreamName:    req.Method,
			ServerStreams: methodDesc.IsServerStreaming(),
			ClientStreams: methodDesc.IsClientStreaming(),
		}
		stream, err := conn.NewStream(ctx, streamDesc, fullMethod, grpc.Header(&respHeaders), grpc.Trailer(&respTrailers))
		if err != nil {
			st, _ := status.FromError(err)
			writeJSON(w, http.StatusOK, grpcInvokeResponse{
				Error:  st.Message(),
				Status: st.Code().String(),
				TimeMs: time.Since(start).Milliseconds(),
			})
			return
		}
		type streamResult struct {
			messages []interface{}
			err      error
		}
		recvDone := make(chan streamResult, 1)
		go func() {
			messages := make([]interface{}, 0)
			for {
				msg := dynamic.NewMessage(methodDesc.GetOutputType())
				err := stream.RecvMsg(msg)
				if err == io.EOF {
					recvDone <- streamResult{messages: messages}
					return
				}
				if err != nil {
					recvDone <- streamResult{messages: messages, err: err}
					return
				}
				msgJSON, err := msg.MarshalJSON()
				if err != nil {
					recvDone <- streamResult{messages: messages, err: fmt.Errorf("marshal stream message: %w", err)}
					return
				}
				var item interface{}
				if err := json.Unmarshal(msgJSON, &item); err != nil {
					recvDone <- streamResult{messages: messages, err: fmt.Errorf("decode stream message: %w", err)}
					return
				}
				messages = append(messages, item)
			}
		}()

		for _, inputMsg := range inputMessages {
			if err := stream.SendMsg(inputMsg); err != nil {
				st, _ := status.FromError(err)
				writeJSON(w, http.StatusOK, grpcInvokeResponse{
					Error:  st.Message(),
					Status: st.Code().String(),
					TimeMs: time.Since(start).Milliseconds(),
				})
				return
			}
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

		result := <-recvDone
		if result.err != nil {
			st, ok := status.FromError(result.err)
			statusCode := "INTERNAL"
			errorMessage := result.err.Error()
			if ok {
				statusCode = st.Code().String()
				errorMessage = st.Message()
			}
			writeJSON(w, http.StatusOK, grpcInvokeResponse{
				Messages:         result.messages,
				Error:            errorMessage,
				Status:           statusCode,
				TimeMs:           time.Since(start).Milliseconds(),
				ResponseMetadata: metadataMap(respHeaders),
				ResponseTrailers: metadataMap(respTrailers),
			})
			return
		}

		respMeta := make(map[string]string)
		for k, vals := range respHeaders {
			if len(vals) > 0 {
				respMeta[k] = vals[0]
			}
		}
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Messages:         result.messages,
			Status:           "OK",
			TimeMs:           time.Since(start).Milliseconds(),
			ResponseMetadata: respMeta,
			ResponseTrailers: metadataMap(respTrailers),
		})
		return
	}

	err = conn.Invoke(ctx, fullMethod, inputMessages[0], outputMsg,
		grpc.Header(&respHeaders),
		grpc.Trailer(&respTrailers),
	)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		st, _ := status.FromError(err)
		writeJSON(w, http.StatusOK, grpcInvokeResponse{
			Error:            st.Message(),
			Status:           st.Code().String(),
			TimeMs:           elapsed,
			ResponseMetadata: metadataMap(respHeaders),
			ResponseTrailers: metadataMap(respTrailers),
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
		ResponseTrailers: metadataMap(respTrailers),
	})
}

func grpcStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req grpcInvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == "" || req.Service == "" || req.Method == "" {
		http.Error(w, "address, service and method required", http.StatusBadRequest)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	emit := func(value any) { data, _ := json.Marshal(value); _, _ = w.Write(append(data, '\n')); flusher.Flush() }
	conn, err := grpcDial(req.Address, req.TLS, 10*time.Second, req.CACertPath, req.ClientCertPath, req.ClientKeyPath)
	if err != nil {
		emit(map[string]any{"type": "complete", "status": "UNAVAILABLE", "error": err.Error()})
		return
	}
	defer conn.Close()
	timeout := 30 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	ctx = outgoingContext(ctx, req.Metadata)
	refClient := grpcReflectionClient(ctx, conn)
	defer refClient.Reset()
	service, err := refClient.ResolveService(req.Service)
	if err != nil {
		emit(map[string]any{"type": "complete", "status": "NOT_FOUND", "error": "resolve service: " + err.Error()})
		return
	}
	method := service.FindMethodByName(req.Method)
	if method == nil {
		emit(map[string]any{"type": "complete", "status": "NOT_FOUND", "error": "method not found"})
		return
	}
	if !method.IsServerStreaming() {
		emit(map[string]any{"type": "complete", "status": "INVALID_ARGUMENT", "error": "method is not server-streaming"})
		return
	}
	inputs := []json.RawMessage{req.Payload}
	if method.IsClientStreaming() {
		inputs = req.Messages
		if len(inputs) == 0 {
			inputs = []json.RawMessage{req.Payload}
		}
	}
	streamDesc := &grpc.StreamDesc{StreamName: req.Method, ServerStreams: true, ClientStreams: method.IsClientStreaming()}
	var headers, trailers metadata.MD
	started := time.Now()
	stream, err := conn.NewStream(ctx, streamDesc, fmt.Sprintf("/%s/%s", req.Service, req.Method), grpc.Header(&headers), grpc.Trailer(&trailers))
	if err != nil {
		st, _ := status.FromError(err)
		emit(map[string]any{"type": "complete", "status": st.Code().String(), "error": st.Message()})
		return
	}
	for index, raw := range inputs {
		message := dynamic.NewMessage(method.GetInputType())
		if len(raw) > 0 && string(raw) != "null" {
			if err := message.UnmarshalJSON(raw); err != nil {
				emit(map[string]any{"type": "complete", "status": "INVALID_ARGUMENT", "error": fmt.Sprintf("unmarshal message %d: %v", index+1, err)})
				return
			}
		}
		if err := stream.SendMsg(message); err != nil {
			st, _ := status.FromError(err)
			emit(map[string]any{"type": "complete", "status": st.Code().String(), "error": st.Message()})
			return
		}
	}
	if err := stream.CloseSend(); err != nil {
		st, _ := status.FromError(err)
		emit(map[string]any{"type": "complete", "status": st.Code().String(), "error": st.Message()})
		return
	}
	if headerValues, err := stream.Header(); err == nil {
		headers = headerValues
		emit(map[string]any{"type": "headers", "metadata": metadataMap(headers)})
	}
	for {
		message := dynamic.NewMessage(method.GetOutputType())
		err := stream.RecvMsg(message)
		if err == io.EOF {
			emit(map[string]any{"type": "complete", "status": "OK", "time_ms": time.Since(started).Milliseconds(), "trailers": metadataMap(stream.Trailer())})
			return
		}
		if err != nil {
			st, _ := status.FromError(err)
			emit(map[string]any{"type": "complete", "status": st.Code().String(), "error": st.Message(), "time_ms": time.Since(started).Milliseconds(), "trailers": metadataMap(stream.Trailer())})
			return
		}
		data, err := message.MarshalJSON()
		if err != nil {
			emit(map[string]any{"type": "complete", "status": "INTERNAL", "error": err.Error()})
			return
		}
		var value any
		_ = json.Unmarshal(data, &value)
		emit(map[string]any{"type": "message", "message": value})
	}
}

func metadataMap(md metadata.MD) map[string]string {
	out := make(map[string]string, len(md))
	for key, values := range md {
		if len(values) > 0 {
			out[key] = strings.Join(values, ", ")
		}
	}
	return out
}

// --- Proto file parsing (no server required) ---

type grpcParseProtoRequest struct {
	Source     string            `json:"source"`
	Files      map[string]string `json:"files,omitempty"`
	EntryFiles []string          `json:"entry_files,omitempty"`
}

type grpcParseProtosetRequest struct {
	Base64 string `json:"base64"`
}

type grpcParseProtoMethod struct {
	Name            string `json:"name"`
	InputType       string `json:"input_type"`
	OutputType      string `json:"output_type"`
	ClientStreaming bool   `json:"client_streaming"`
	ServerStreaming bool   `json:"server_streaming"`
}

type grpcParseProtoService struct {
	Name    string                 `json:"name"`
	Methods []grpcParseProtoMethod `json:"methods"`
}

type grpcParseProtoResponse struct {
	Services []grpcParseProtoService    `json:"services"`
	Schemas  map[string][]grpcFieldInfo `json:"schemas,omitempty"`
	Enums    map[string][]grpcEnumValue `json:"enums,omitempty"`
	Files    []string                   `json:"files,omitempty"`
}

// grpcParseProtoHandler handles POST /grpc/parse-proto
// Parses a .proto source file and returns all services and methods found.
func grpcParseProtoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req grpcParseProtoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Source == "" {
		if len(req.Files) == 0 {
			http.Error(w, "source or files required", http.StatusBadRequest)
			return
		}
	}

	files := map[string]string{}
	for name, source := range req.Files {
		if strings.TrimSpace(name) != "" {
			files[strings.ReplaceAll(name, "\\", "/")] = source
		}
	}
	if req.Source != "" && len(files) == 0 {
		files["input.proto"] = req.Source
	}
	if req.Source != "" && len(files) > 0 && len(req.EntryFiles) == 0 {
		files["input.proto"] = req.Source
	}
	entryFiles := make([]string, 0, len(req.EntryFiles))
	for _, name := range req.EntryFiles {
		normalized := strings.ReplaceAll(name, "\\", "/")
		if normalized != "" {
			entryFiles = append(entryFiles, normalized)
		}
	}
	if len(entryFiles) == 0 {
		if _, ok := files["input.proto"]; ok {
			entryFiles = append(entryFiles, "input.proto")
		} else {
			for name := range files {
				entryFiles = append(entryFiles, name)
			}
		}
	}
	if len(entryFiles) == 0 {
		http.Error(w, "no proto entry files provided", http.StatusBadRequest)
		return
	}

	parser := protoparse.Parser{
		Accessor: protoparse.FileContentsFromMap(files),
	}

	fds, err := parser.ParseFiles(entryFiles...)
	if err != nil {
		http.Error(w, "parse proto: "+err.Error(), http.StatusBadRequest)
		return
	}

	schemas, enums, fileNames := collectFileSchemas(fds)
	writeJSON(w, http.StatusOK, grpcParseProtoResponse{
		Services: grpcParseServicesFromFiles(fds),
		Schemas:  schemas,
		Enums:    enums,
		Files:    fileNames,
	})
}

// grpcParseProtosetHandler handles POST /grpc/parse-protoset
// Parses a binary FileDescriptorSet/protoset and returns all services and methods found.
func grpcParseProtosetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req grpcParseProtosetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Base64 == "" {
		http.Error(w, "base64 required", http.StatusBadRequest)
		return
	}
	raw, err := base64.StdEncoding.DecodeString(req.Base64)
	if err != nil {
		http.Error(w, "decode protoset: "+err.Error(), http.StatusBadRequest)
		return
	}
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(raw, &set); err != nil {
		http.Error(w, "parse FileDescriptorSet: "+err.Error(), http.StatusBadRequest)
		return
	}

	linked, err := desc.CreateFileDescriptorsFromSet(&set)
	if err != nil {
		http.Error(w, "link FileDescriptorSet: "+err.Error(), http.StatusBadRequest)
		return
	}
	fds := make([]*desc.FileDescriptor, 0, len(linked))
	for _, fd := range linked {
		fds = append(fds, fd)
	}
	schemas, enums, fileNames := collectFileSchemas(fds)
	writeJSON(w, http.StatusOK, grpcParseProtoResponse{
		Services: grpcParseServicesFromFiles(fds),
		Schemas:  schemas,
		Enums:    enums,
		Files:    fileNames,
	})
}

// RegisterHandlers registers gRPC HTTP sidecar endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/grpc/reflect", grpcReflectHandler)
	mux.HandleFunc("/grpc/describe", grpcDescribeHandler)
	mux.HandleFunc("/grpc/invoke", grpcInvokeHandler)
	mux.HandleFunc("/grpc/stream", grpcStreamHandler)
	mux.HandleFunc("/grpc/parse-proto", grpcParseProtoHandler)
	mux.HandleFunc("/grpc/parse-protoset", grpcParseProtosetHandler)
}
