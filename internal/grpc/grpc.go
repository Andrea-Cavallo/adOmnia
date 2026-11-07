// Package grpc serves the sidecar endpoints of adOmnia's gRPC client: unary and streaming calls, including interactive streams that keep the send side open.
package grpc

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/jhump/protoreflect/desc"    //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"github.com/jhump/protoreflect/dynamic" //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
)

// --- Request / Response types ---

type grpcReflectRequest struct {
	Target   `json:",inline"`
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
	Services []grpcServiceInfo          `json:"services"`
	Schemas  map[string][]grpcFieldInfo `json:"schemas,omitempty"`
	Enums    map[string][]grpcEnumValue `json:"enums,omitempty"`
	Files    []string                   `json:"files,omitempty"`
}

type grpcDescribeRequest struct {
	Target      `json:",inline"`
	MessageType string            `json:"message_type"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	Descriptors *DescriptorSource `json:"descriptors,omitempty"`
}

type grpcFieldInfo struct {
	Name         string          `json:"name"`
	ProtoName    string          `json:"proto_name,omitempty"`
	Type         string          `json:"type"`
	Kind         string          `json:"kind,omitempty"`
	Number       int32           `json:"number"`
	Repeated     bool            `json:"repeated"`
	Map          bool            `json:"map,omitzero"`
	Required     bool            `json:"required,omitzero"`
	Optional     bool            `json:"optional,omitzero"`
	Oneof        bool            `json:"oneof,omitzero"`
	OneofName    string          `json:"oneof_name,omitempty"`
	OneofFields  []grpcFieldInfo `json:"oneof_fields,omitempty"`
	MessageType  string          `json:"message_type,omitempty"`
	EnumType     string          `json:"enum_type,omitempty"`
	EnumValues   []grpcEnumValue `json:"enum_values,omitempty"`
	KeyType      string          `json:"key_type,omitempty"`
	ValueType    string          `json:"value_type,omitempty"`
	DefaultValue any             `json:"default_value,omitempty"`
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

// --- Helpers ---

func grpcTLSConfig(caCertPath, clientCertPath, clientKeyPath string) (*tls.Config, error) {
	config := &tls.Config{MinVersion: tls.VersionTLS12}
	if caCertPath != "" {
		pemBytes, err := os.ReadFile(caCertPath) // NOSONAR -- the certificate paths come from the mTLS settings the user filled in the gRPC panel (a file picker); the sidecar is loopback-only, same trust domain as the app
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

func normalizeDefaultValue(v any) any {
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
		info.DefaultValue = map[string]any{}
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

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	jsonutil.MarshalWrite(w, v)
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
	if err := json.UnmarshalRead(r.Body, &req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == "" {
		http.Error(w, "address required", http.StatusBadRequest)
		return
	}

	conn, err := connections.get(req.Target)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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
	if err := json.UnmarshalRead(r.Body, &req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Address == "" && !req.Descriptors.offline() {
		http.Error(w, "address required", http.StatusBadRequest)
		return
	}
	if req.MessageType == "" {
		http.Error(w, "message_type required", http.StatusBadRequest)
		return
	}

	msgDesc, err := describeMessage(r.Context(), req)
	if err != nil {
		http.Error(w, "resolve message type: "+err.Error(), http.StatusBadGateway)
		return
	}

	schemas := map[string][]grpcFieldInfo{}
	enums := map[string][]grpcEnumValue{}
	collectMessageSchema(msgDesc, schemas, enums)
	writeJSON(w, http.StatusOK, grpcDescribeResponse{Fields: schemas[msgDesc.GetFullyQualifiedName()], Schemas: schemas, Enums: enums})
}

func grpcStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req grpcInvokeRequest
	if err := json.UnmarshalRead(r.Body, &req); err != nil {
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
	emit := func(value any) {
		data, _ := jsonutil.Marshal(value)
		_, _ = w.Write(append(data, '\n'))
		flusher.Flush()
	}
	conn, err := connections.get(req.Target)
	if err != nil {
		emit(map[string]any{"type": "complete", "status": "UNAVAILABLE", "error": err.Error()})
		return
	}
	timeout := defaultCallTimeout
	if req.Interactive {
		timeout = interactiveStreamTimeout
	}
	ctx, cancel := context.WithTimeout(r.Context(), req.timeout(timeout))
	defer cancel()
	ctx = outgoingContext(ctx, req.Metadata)
	method, err := resolveMethod(ctx, conn, req.Descriptors, req.Service, req.Method)
	if err != nil {
		emit(map[string]any{"type": "complete", "status": "NOT_FOUND", "error": err.Error()})
		return
	}
	if req.Interactive && !method.IsClientStreaming() {
		emit(map[string]any{"type": "complete", "status": "INVALID_ARGUMENT", "error": "interactive streams need a client- or bidi-streaming method"})
		return
	}
	if !method.IsServerStreaming() && !req.Interactive {
		emit(map[string]any{"type": "complete", "status": "INVALID_ARGUMENT", "error": "method is not server-streaming"})
		return
	}
	inputs := []jsonv1.RawMessage{req.Payload}
	if method.IsClientStreaming() {
		inputs = req.Messages
		if len(inputs) == 0 && !req.Interactive {
			inputs = []jsonv1.RawMessage{req.Payload}
		}
	}
	streamDesc := &grpc.StreamDesc{StreamName: req.Method, ServerStreams: method.IsServerStreaming(), ClientStreams: method.IsClientStreaming()}
	var headers, trailers metadata.MD
	started := time.Now()
	stream, err := conn.NewStream(ctx, streamDesc, fmt.Sprintf("/%s/%s", method.GetService().GetFullyQualifiedName(), method.GetName()), grpc.Header(&headers), grpc.Trailer(&trailers))
	if err != nil {
		st, _ := status.FromError(err)
		emit(map[string]any{"type": "complete", "status": st.Code().String(), "error": st.Message()})
		return
	}
	var session *streamSession
	if req.Interactive {
		id, opened, done := registerStreamSession(stream, method.GetInputType())
		defer done()
		session = opened
		emit(map[string]any{"type": "session", "id": id})
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
	if session != nil {
		session.mu.Unlock()
	} else if err := stream.CloseSend(); err != nil {
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
		if errors.Is(err, io.EOF) {
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
		if !method.IsServerStreaming() { // client streaming: one response, then the call is over
			emit(map[string]any{"type": "complete", "status": "OK", "time_ms": time.Since(started).Milliseconds(), "trailers": metadataMap(stream.Trailer())})
			return
		}
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

// grpcParseProtoHandler handles POST /grpc/parse-proto: inline .proto sources (the import tree uploaded together).
func grpcParseProtoHandler(w http.ResponseWriter, r *http.Request) {
	var req grpcParseProtoRequest
	if !decodePost(w, r, &req) {
		return
	}
	files := maps.Clone(req.Files)
	if files == nil {
		files = map[string]string{}
	}
	entries := req.EntryFiles
	if req.Source != "" && (len(files) == 0 || len(entries) == 0) {
		files["input.proto"] = req.Source
		entries = []string{"input.proto"}
	}
	if len(files) == 0 {
		http.Error(w, "source or files required", http.StatusBadRequest)
		return
	}
	writeDescriptors(w, DescriptorSource{Kind: SourceProto, Files: files, EntryFiles: entries})
}

// grpcParseProtosetHandler handles POST /grpc/parse-protoset: a compiled FileDescriptorSet, base64-encoded.
func grpcParseProtosetHandler(w http.ResponseWriter, r *http.Request) {
	var req grpcParseProtosetRequest
	if !decodePost(w, r, &req) {
		return
	}
	if req.Base64 == "" {
		http.Error(w, "base64 required", http.StatusBadRequest)
		return
	}
	writeDescriptors(w, DescriptorSource{Kind: SourceProtoset, ProtosetBase64: req.Base64})
}

// grpcDescriptorsHandler handles POST /grpc/descriptors: services and schemas of any offline source, also
// .proto files and protosets on disk (what a saved call keeps: paths, not copies).
func grpcDescriptorsHandler(w http.ResponseWriter, r *http.Request) {
	var source DescriptorSource
	if !decodePost(w, r, &source) {
		return
	}
	writeDescriptors(w, source)
}

func decodePost(w http.ResponseWriter, r *http.Request, target any) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return false
	}
	if err := json.UnmarshalRead(r.Body, target); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func writeDescriptors(w http.ResponseWriter, source DescriptorSource) {
	fds, err := loadDescriptorFiles(source)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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

// RegisterHandlers registers gRPC HTTP sidecar endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/grpc/reflect", grpcReflectHandler)
	mux.HandleFunc("/grpc/describe", grpcDescribeHandler)
	mux.HandleFunc("/grpc/invoke", grpcInvokeHandler)
	mux.HandleFunc("/grpc/stream", grpcStreamHandler)
	mux.HandleFunc("/grpc/stream/send", grpcStreamSendHandler)
	mux.HandleFunc("/grpc/stream/close", grpcStreamCloseHandler)
	mux.HandleFunc("/grpc/parse-proto", grpcParseProtoHandler)
	mux.HandleFunc("/grpc/parse-protoset", grpcParseProtosetHandler)
	mux.HandleFunc("/grpc/descriptors", grpcDescriptorsHandler)
	mux.HandleFunc("/grpc/mock/start", grpcMockStartHandler)
	mux.HandleFunc("/grpc/mock/stop", grpcMockStopHandler)
	mux.HandleFunc("/grpc/mock/rules", grpcMockRulesHandler)
	mux.HandleFunc("/grpc/mock/status", grpcMockStatusHandler)
	mux.HandleFunc("/grpc/mock/hits/clear", grpcMockClearHitsHandler)
}
