package grpc

import (
	"bytes"
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"google.golang.org/grpc"
	grpc_testing "google.golang.org/grpc/interop/grpc_testing"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

// startServerWithoutReflection is a real server that does not answer reflection, like many production ones.
func startServerWithoutReflection(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	grpc_testing.RegisterTestServiceServer(server, grpcStreamingTestService{})
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	return listener.Addr().String()
}

// writeProtoset writes the compiled descriptors of the grpc.testing service, imports first, as protoc would.
func writeProtoset(t *testing.T) string {
	t.Helper()
	set := &descriptorpb.FileDescriptorSet{}
	seen := map[string]bool{}
	var add func(file protoreflect.FileDescriptor)
	add = func(file protoreflect.FileDescriptor) {
		if seen[file.Path()] {
			return
		}
		seen[file.Path()] = true
		for index := 0; index < file.Imports().Len(); index++ {
			add(file.Imports().Get(index).FileDescriptor)
		}
		set.File = append(set.File, protodesc.ToFileDescriptorProto(file))
	}
	add(grpc_testing.File_grpc_testing_test_proto)
	data, err := proto.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "testing.protoset")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCallWithoutReflectionNeedsDescriptorsAndWorksWithAProtoset(t *testing.T) {
	address := startServerWithoutReflection(t)
	request := CallRequest{Address: address, Service: "grpc.testing.TestService", Method: "UnaryCall", Payload: []byte(`{"payload":{"body":"aGk="}}`), TimeoutMs: 2000}
	if result := Call(context.Background(), request); result.Status == "OK" || !strings.Contains(result.Error, "load the .proto files") {
		t.Fatalf("without reflection and descriptors the call must fail and say what to do: %+v", result)
	}
	request.Descriptors = &DescriptorSource{Kind: SourceProtoset, ProtosetPath: writeProtoset(t)}
	result := Call(context.Background(), request)
	if result.Status != "OK" || !strings.Contains(fmt.Sprint(result.Response), "aGk=") {
		t.Fatalf("the protoset must describe the call: %+v", result)
	}
	if result.ResponseMetadata["x-test-header"] != "header-value" {
		t.Fatalf("headers are lost: %+v", result.ResponseMetadata)
	}
	streaming := request
	streaming.Method, streaming.Payload = "StreamingInputCall", nil
	streaming.Messages = []jsonv1.RawMessage{jsonv1.RawMessage(`{"payload":{"body":"YWE="}}`), jsonv1.RawMessage(`{"payload":{"body":"YmJi"}}`)}
	if got := Call(context.Background(), streaming); got.Status != "OK" || !strings.Contains(fmt.Sprint(got.Messages), "5") {
		t.Fatalf("a client stream must work offline too: %+v", got)
	}
}

func TestCallsToTheSameServerShareOneConnection(t *testing.T) {
	connections.closeAll()
	address := startServerWithoutReflection(t)
	request := CallRequest{Address: address, Service: "grpc.testing.TestService", Method: "UnaryCall", Payload: []byte(`{}`), Descriptors: &DescriptorSource{Kind: SourceProtoset, ProtosetPath: writeProtoset(t)}}
	for range 3 {
		if result := Call(context.Background(), request); result.Status != "OK" {
			t.Fatal(result.Error)
		}
	}
	connections.mu.Lock()
	open := len(connections.conns)
	connections.mu.Unlock()
	if open != 1 {
		t.Fatalf("connections = %d, want 1", open)
	}
}

const echoProto = `syntax = "proto3";
package demo.v1;
import "common/money.proto";
import "google/protobuf/timestamp.proto";

message SayRequest { string name = 1; common.Money tip = 2; }
message SayReply { string text = 1; common.Money tip = 2; google.protobuf.Timestamp at = 3; }

service Echo {
  rpc Say(SayRequest) returns (SayReply);
  rpc List(SayRequest) returns (stream SayReply);
  rpc Chat(stream SayRequest) returns (stream SayReply);
}
`

const moneyProto = `syntax = "proto3";
package common;
message Money { string currency = 1; int64 units = 2; }
`

// writeEchoProtos lays out a project: protos/demo/v1/echo.proto imports protos/common/money.proto.
func writeEchoProtos(t *testing.T) (string, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "protos")
	for name, text := range map[string]string{"demo/v1/echo.proto": echoProto, "common/money.proto": moneyProto} {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return filepath.Join(root, "demo", "v1", "echo.proto"), root
}

func TestMockServesProtoFilesFromDiskWithRulesAndReflection(t *testing.T) {
	protoPath, importRoot := writeEchoProtos(t)
	descriptors := DescriptorSource{Kind: SourceProto, ProtoPaths: []string{protoPath}, ImportPaths: []string{importRoot}}
	port, err := StartMock(MockConfig{Descriptors: descriptors, Rules: []MockRule{
		{ID: "fail", Enabled: true, Method: "Say", Match: "boom", Status: "NOT_FOUND", Message: "no {{request.name}} here"},
		{ID: "hello", Name: "Hello", Enabled: true, Service: "demo.v1.Echo", Method: "Say", Response: `{"text":"hi {{request.name}}","tip":{"currency":"EUR","units":"{{request.tip.units}}"}}`},
		{ID: "list", Enabled: true, Method: "List", Response: `[{"text":"one"},{"text":"two"}]`},
		{ID: "chat", Enabled: true, Method: "Chat", Response: `{"text":"echo {{request.name}}"}`},
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(StopMock)
	address := fmt.Sprintf("127.0.0.1:%d", port)

	offline := CallRequest{Address: address, Service: "demo.v1.Echo", Method: "Say", Payload: []byte(`{"name":"Ada","tip":{"units":"7"}}`), Descriptors: &descriptors, TimeoutMs: 2000}
	result := Call(context.Background(), offline)
	if result.Status != "OK" || !strings.Contains(fmt.Sprint(result.Response), "hi Ada") || !strings.Contains(fmt.Sprint(result.Response), "units:7") {
		t.Fatalf("offline call to the mock: %+v", result)
	}
	viaReflection := offline
	viaReflection.Descriptors = nil
	if got := Call(context.Background(), viaReflection); got.Status != "OK" || !strings.Contains(fmt.Sprint(got.Response), "hi Ada") {
		t.Fatalf("the mock must answer reflection too: %+v", got)
	}
	failing := offline
	failing.Payload = []byte(`{"name":"boom"}`)
	if got := Call(context.Background(), failing); !strings.EqualFold(strings.ReplaceAll(got.Status, "_", ""), "notfound") || got.Error != "no boom here" {
		t.Fatalf("a rule with a status must fail the call: %+v", got)
	}
	list := offline
	list.Method = "List"
	if got := Call(context.Background(), list); got.Status != "OK" || len(got.Messages) != 2 {
		t.Fatalf("a server stream sends one message per array element: %+v", got)
	}
	chat := offline
	chat.Method, chat.Payload = "Chat", nil
	chat.Messages = []jsonv1.RawMessage{jsonv1.RawMessage(`{"name":"a"}`), jsonv1.RawMessage(`{"name":"b"}`)}
	if got := Call(context.Background(), chat); got.Status != "OK" || !strings.Contains(fmt.Sprint(got.Messages), "echo a") || !strings.Contains(fmt.Sprint(got.Messages), "echo b") {
		t.Fatalf("a bidi stream answers every message: %+v", got)
	}
	state := MockState()
	if !state.Running || state.Port != port || len(state.Hits) != 6 || state.Hits[0].RuleName != "Hello" {
		t.Fatalf("mock state = %+v", state)
	}
	StopMock()
	if MockState().Running {
		t.Fatal("the mock must stop")
	}
}

func TestDescriptorsEndpointReadsProtoFilesFromDisk(t *testing.T) {
	protoPath, importRoot := writeEchoProtos(t)
	body, _ := jsonutil.Marshal(DescriptorSource{Kind: SourceProto, ProtoPaths: []string{protoPath}, ImportPaths: []string{importRoot}})
	recorder := httptest.NewRecorder()
	grpcDescriptorsHandler(recorder, httptest.NewRequest(http.MethodPost, "/grpc/descriptors", bytes.NewReader(body)))
	var response grpcParseProtoResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("%v: %s", err, recorder.Body.String())
	}
	if len(response.Services) != 1 || response.Services[0].Name != "demo.v1.Echo" || len(response.Services[0].Methods) != 3 {
		t.Fatalf("services = %+v", response.Services)
	}
	if _, ok := response.Schemas["demo.v1.SayRequest"]; !ok {
		t.Fatalf("schemas = %v", response.Schemas)
	}
	recorder = httptest.NewRecorder()
	relative, _ := jsonutil.Marshal(DescriptorSource{Kind: SourceProto, ProtoPaths: []string{"echo.proto"}})
	grpcDescriptorsHandler(recorder, httptest.NewRequest(http.MethodPost, "/grpc/descriptors", bytes.NewReader(relative)))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a relative path must be refused, got %d", recorder.Code)
	}
}

func TestRenderTemplateAndCodes(t *testing.T) {
	got := renderTemplate(`{"id":"{{request.user.id}}","raw":{{request}},"x":"{{unknown}}"}`, `{"user":{"id":42}}`)
	if got != `{"id":"42","raw":{"user":{"id":42}},"x":"{{unknown}}"}` {
		t.Fatalf("render = %s", got)
	}
	for name, want := range map[string]string{"NOT_FOUND": "NotFound", "notfound": "NotFound", "": "OK", "Unavailable": "Unavailable", "nope": "Unknown"} {
		if got := codeOf(name).String(); got != want {
			t.Errorf("codeOf(%q) = %s, want %s", name, got, want)
		}
	}
}
