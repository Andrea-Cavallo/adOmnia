package grpc

import (
	"crypto/rand"
	"encoding/hex"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jhump/protoreflect/desc"    //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"github.com/jhump/protoreflect/dynamic" //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	reflectionv1 "google.golang.org/grpc/reflection/grpc_reflection_v1"
	reflectionv1alpha "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// The gRPC mock: a local server built from .proto files or a protoset, with no generated code. Every method of
// the descriptors answers; a rule picks the reply (JSON with {{request.field}} placeholders), the status and a
// delay, otherwise the reply is the empty message. Server reflection is on, so any client discovers it.

const (
	maxMockHits  = 200
	maxMockDelay = 30 * time.Second
)

// MockRule is how one method answers.
type MockRule struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Enabled bool   `json:"enabled"`
	// Service and Method select the call (fully qualified service, method name); "" matches any.
	Service string `json:"service,omitempty"`
	Method  string `json:"method,omitempty"`
	// Match is text the request JSON must contain; "" matches any request.
	Match string `json:"match,omitempty"`
	// Response is the reply JSON text, placeholders filled before it is parsed; for a server stream a JSON
	// array sends one message per element.
	Response string `json:"response,omitempty"`
	// Status is a gRPC code name; anything but OK fails the call with Message.
	Status   string            `json:"status,omitempty"`
	Message  string            `json:"message,omitempty"`
	DelayMs  int               `json:"delay_ms,omitzero"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

// MockConfig starts the mock: the descriptors to serve, the port (0 picks a free one) and the rules.
type MockConfig struct {
	Port        int              `json:"port,omitzero"`
	Descriptors DescriptorSource `json:"descriptors"`
	Rules       []MockRule       `json:"rules"`
}

// MockHit is one call the mock answered.
type MockHit struct {
	Timestamp int64  `json:"timestamp"`
	Method    string `json:"method"`
	Request   string `json:"request"`
	Response  string `json:"response"`
	Status    string `json:"status"`
	RuleID    string `json:"rule_id,omitempty"`
	RuleName  string `json:"rule_name,omitempty"`
}

// MockStatus is what the UI polls.
type MockStatus struct {
	Running  bool                    `json:"running"`
	Port     int                     `json:"port,omitzero"`
	Services []grpcParseProtoService `json:"services"`
	Hits     []MockHit               `json:"hits"`
}

type mockServer struct {
	mu       sync.Mutex
	server   *grpc.Server
	port     int
	files    []*desc.FileDescriptor
	rules    []MockRule
	hits     []MockHit
	services []grpcParseProtoService
}

var mock = &mockServer{}

// StartMock starts (or restarts) the mock server and returns its port.
func StartMock(config MockConfig) (int, error) {
	files, err := loadDescriptorFiles(config.Descriptors)
	if err != nil {
		return 0, err
	}
	services := grpcParseServicesFromFiles(files)
	if len(services) == 0 {
		return 0, errors.New("the descriptors define no service to mock")
	}
	registry, err := registryOf(files)
	if err != nil {
		return 0, err
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", config.Port))
	if err != nil {
		return 0, fmt.Errorf("listen on port %d: %w", config.Port, err)
	}
	StopMock()
	server := grpc.NewServer(grpc.UnknownServiceHandler(mock.handle))
	options := reflection.ServerOptions{Services: mockServiceInfo(services), DescriptorResolver: registry}
	reflectionv1.RegisterServerReflectionServer(server, reflection.NewServerV1(options))
	reflectionv1alpha.RegisterServerReflectionServer(server, reflection.NewServer(options))
	mock.mu.Lock()
	mock.server, mock.port, mock.files, mock.rules, mock.services, mock.hits = server, listener.Addr().(*net.TCPAddr).Port, files, config.Rules, services, nil
	port := mock.port
	mock.mu.Unlock()
	go func() { _ = server.Serve(listener) }() // Serve returns when StopMock stops the server
	return port, nil
}

// StopMock stops the mock server if it runs.
func StopMock() {
	mock.mu.Lock()
	server := mock.server
	mock.server, mock.port = nil, 0
	mock.mu.Unlock()
	if server != nil {
		server.Stop()
	}
}

// SetMockRules replaces the rules of the running mock: edits apply to the next call.
func SetMockRules(rules []MockRule) {
	mock.mu.Lock()
	defer mock.mu.Unlock()
	mock.rules = rules
}

// MockState is the current state of the mock.
func MockState() MockStatus {
	mock.mu.Lock()
	defer mock.mu.Unlock()
	hits := append([]MockHit{}, mock.hits...)
	services := []grpcParseProtoService{}
	if mock.server != nil {
		services = mock.services
	}
	return MockStatus{Running: mock.server != nil, Port: mock.port, Services: services, Hits: hits}
}

func clearMockHits() {
	mock.mu.Lock()
	defer mock.mu.Unlock()
	mock.hits = nil
}

// registryOf puts the files and their imports in a registry, imports first, for the reflection service.
func registryOf(files []*desc.FileDescriptor) (*protoregistry.Files, error) {
	registry := &protoregistry.Files{}
	seen := map[string]bool{}
	var register func(file *desc.FileDescriptor) error
	register = func(file *desc.FileDescriptor) error {
		if seen[file.GetName()] {
			return nil
		}
		seen[file.GetName()] = true
		for _, dependency := range file.GetDependencies() {
			if err := register(dependency); err != nil {
				return err
			}
		}
		if _, err := registry.FindFileByPath(file.GetName()); err == nil {
			return nil
		}
		return registry.RegisterFile(file.UnwrapFile())
	}
	for _, file := range files {
		if err := register(file); err != nil {
			return nil, fmt.Errorf("register %s: %w", file.GetName(), err)
		}
	}
	return registry, nil
}

type mockServiceInfo []grpcParseProtoService

// GetServiceInfo lists the mocked services for reflection (the unknown-service handler registers none).
func (services mockServiceInfo) GetServiceInfo() map[string]grpc.ServiceInfo {
	info := map[string]grpc.ServiceInfo{}
	for _, service := range services {
		methods := make([]grpc.MethodInfo, 0, len(service.Methods))
		for _, method := range service.Methods {
			methods = append(methods, grpc.MethodInfo{Name: method.Name, IsClientStream: method.ClientStreaming, IsServerStream: method.ServerStreaming})
		}
		info[service.Name] = grpc.ServiceInfo{Methods: methods}
	}
	return info
}

func (m *mockServer) snapshot() ([]*desc.FileDescriptor, []MockRule) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.files, append([]MockRule(nil), m.rules...)
}

func (m *mockServer) record(hit MockHit) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hits = append(m.hits, hit)
	if len(m.hits) > maxMockHits {
		m.hits = m.hits[len(m.hits)-maxMockHits:]
	}
}

// handle answers every call: it finds the method in the descriptors and replies by rule.
func (m *mockServer) handle(_ any, stream grpc.ServerStream) error {
	fullMethod, ok := grpc.MethodFromServerStream(stream)
	if !ok {
		return status.Error(codes.Internal, "no method in the stream")
	}
	files, rules := m.snapshot()
	serviceName, methodName, _ := strings.Cut(strings.TrimPrefix(fullMethod, "/"), "/")
	service := findService(files, serviceName)
	if service == nil {
		return status.Errorf(codes.Unimplemented, "%s is not in the mocked descriptors", serviceName)
	}
	method := service.FindMethodByName(methodName)
	if method == nil {
		return status.Errorf(codes.Unimplemented, "%s has no method %s", serviceName, methodName)
	}
	if method.IsClientStreaming() && method.IsServerStreaming() {
		return m.answerEach(stream, method, rules)
	}
	requests, err := receiveRequests(stream, method)
	if err != nil {
		return err
	}
	return m.answer(stream, method, rules, requests)
}

// receiveRequests reads the one request, or every request of a client stream, as JSON text.
func receiveRequests(stream grpc.ServerStream, method *desc.MethodDescriptor) ([]string, error) {
	var requests []string
	for {
		message := dynamic.NewMessage(method.GetInputType())
		err := stream.RecvMsg(message)
		if errors.Is(err, io.EOF) {
			return requests, nil
		}
		if err != nil {
			return nil, err
		}
		text, err := message.MarshalJSON()
		if err != nil {
			return nil, status.Errorf(codes.Internal, "encode request: %v", err)
		}
		requests = append(requests, string(text))
		if !method.IsClientStreaming() {
			return requests, nil
		}
	}
}

// answer replies once to a unary, client-streaming or server-streaming call.
func (m *mockServer) answer(stream grpc.ServerStream, method *desc.MethodDescriptor, rules []MockRule, requests []string) error {
	request := "{}"
	if len(requests) > 0 {
		request = requests[len(requests)-1]
	}
	if method.IsClientStreaming() {
		request = "[" + strings.Join(requests, ",") + "]"
	}
	return m.reply(stream, method, pickRule(rules, method, request), request)
}

// answerEach replies to every message of a bidirectional stream, as an echo server would.
func (m *mockServer) answerEach(stream grpc.ServerStream, method *desc.MethodDescriptor, rules []MockRule) error {
	for {
		message := dynamic.NewMessage(method.GetInputType())
		err := stream.RecvMsg(message)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		text, err := message.MarshalJSON()
		if err != nil {
			return status.Errorf(codes.Internal, "encode request: %v", err)
		}
		if err := m.reply(stream, method, pickRule(rules, method, string(text)), string(text)); err != nil {
			return err
		}
	}
}

func (m *mockServer) reply(stream grpc.ServerStream, method *desc.MethodDescriptor, rule *MockRule, request string) error {
	hit := MockHit{Timestamp: time.Now().UnixMilli(), Method: method.GetFullyQualifiedName(), Request: request, Status: "OK"}
	if rule != nil {
		hit.RuleID, hit.RuleName = rule.ID, rule.Name
		if rule.DelayMs > 0 {
			time.Sleep(min(time.Duration(rule.DelayMs)*time.Millisecond, maxMockDelay))
		}
		if len(rule.Metadata) > 0 {
			_ = stream.SetHeader(metadata.New(rule.Metadata)) // headers already sent on a later bidi reply: nothing to change
		}
		if code := codeOf(rule.Status); code != codes.OK {
			hit.Status, hit.Response = code.String(), rule.Message
			m.record(hit)
			return status.Error(code, renderTemplate(rule.Message, request))
		}
	}
	replies, err := replyMessages(method, rule, request)
	if err != nil {
		hit.Status, hit.Response = codes.Internal.String(), err.Error()
		m.record(hit)
		return status.Error(codes.Internal, err.Error())
	}
	texts := make([]string, 0, len(replies))
	for _, message := range replies {
		if err := stream.SendMsg(message); err != nil {
			return err
		}
		text, _ := message.MarshalJSON() // the message was just built from JSON: it encodes back
		texts = append(texts, string(text))
	}
	hit.Response = strings.Join(texts, "\n")
	m.record(hit)
	return nil
}

// replyMessages builds the reply: the rule's JSON with placeholders filled, one message per array element for a
// server stream, the empty message without a rule.
func replyMessages(method *desc.MethodDescriptor, rule *MockRule, request string) ([]*dynamic.Message, error) {
	body := "{}"
	if rule != nil && strings.TrimSpace(rule.Response) != "" {
		body = renderTemplate(rule.Response, request)
	}
	items := []jsonv1.RawMessage{jsonv1.RawMessage(body)}
	if method.IsServerStreaming() && strings.HasPrefix(strings.TrimSpace(body), "[") {
		if err := json.Unmarshal([]byte(body), &items); err != nil {
			return nil, fmt.Errorf("the reply is not a JSON array: %w", err)
		}
	}
	messages := make([]*dynamic.Message, 0, len(items))
	for index, item := range items {
		message, err := decodeMessage(item, method.GetOutputType(), fmt.Sprintf("reply %d", index+1))
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, nil
}

// pickRule is the first enabled rule for the method whose match text is in the request.
func pickRule(rules []MockRule, method *desc.MethodDescriptor, request string) *MockRule {
	service := method.GetService().GetFullyQualifiedName()
	for index := range rules {
		rule := &rules[index]
		if !rule.Enabled || (rule.Service != "" && rule.Service != service) || (rule.Method != "" && rule.Method != method.GetName()) {
			continue
		}
		if rule.Match == "" || strings.Contains(request, rule.Match) {
			return rule
		}
	}
	return nil
}

// codeOf reads a gRPC code name in any spelling: NOT_FOUND, NotFound, not_found; unknown names are Unknown.
func codeOf(name string) codes.Code {
	folded := normalizeCode(name)
	if folded == "" || folded == "ok" {
		return codes.OK
	}
	for code := codes.OK; code <= codes.Unauthenticated; code++ {
		if normalizeCode(code.String()) == folded {
			return code
		}
	}
	return codes.Unknown
}

func normalizeCode(name string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), "_", ""))
}

var placeholder = regexp.MustCompile(`\{\{\s*([^}]+?)\s*\}\}`)

// renderTemplate fills {{request.path}} with values of the request JSON, {{$uuid}} and {{$now}}.
func renderTemplate(text, request string) string {
	var data any
	_ = json.Unmarshal([]byte(request), &data) // a request that is not JSON leaves the request placeholders empty
	return placeholder.ReplaceAllStringFunc(text, func(match string) string {
		name := strings.TrimSpace(placeholder.FindStringSubmatch(match)[1])
		switch {
		case name == "$uuid":
			return newUUID()
		case name == "$now":
			return time.Now().UTC().Format(time.RFC3339)
		case name == "request":
			return request
		case strings.HasPrefix(name, "request."):
			return lookupPath(data, strings.TrimPrefix(name, "request."))
		}
		return match
	})
}

func lookupPath(value any, path string) string {
	for part := range strings.SplitSeq(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return ""
		}
		value = object[part]
	}
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		text, _ := json.Marshal(typed) // values decoded from JSON encode back
		return string(text)
	}
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // crypto/rand never fails on supported platforms
	b[6], b[8] = (b[6]&0x0f)|0x40, (b[8]&0x3f)|0x80
	text := hex.EncodeToString(b)
	return text[:8] + "-" + text[8:12] + "-" + text[12:16] + "-" + text[16:20] + "-" + text[20:]
}

// --- HTTP endpoints ---

func grpcMockStartHandler(w http.ResponseWriter, r *http.Request) {
	var config MockConfig
	if !decodePost(w, r, &config) {
		return
	}
	port, err := StartMock(config)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"port": port})
}

func grpcMockStopHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	StopMock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func grpcMockRulesHandler(w http.ResponseWriter, r *http.Request) {
	var rules []MockRule
	if !decodePost(w, r, &rules) {
		return
	}
	SetMockRules(rules)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func grpcMockStatusHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, MockState())
}

func grpcMockClearHitsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	clearMockHits()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
