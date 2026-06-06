package grpc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
	"google.golang.org/grpc"
	grpc_testing "google.golang.org/grpc/interop/grpc_testing"
	"google.golang.org/grpc/reflection"
	"google.golang.org/protobuf/proto"
)

type grpcStreamingTestService struct {
	grpc_testing.UnimplementedTestServiceServer
}

func (grpcStreamingTestService) StreamingInputCall(stream grpc.ClientStreamingServer[grpc_testing.StreamingInputCallRequest, grpc_testing.StreamingInputCallResponse]) error {
	var total int32
	for {
		message, err := stream.Recv()
		if err == io.EOF {
			return stream.SendAndClose(&grpc_testing.StreamingInputCallResponse{AggregatedPayloadSize: total})
		}
		if err != nil {
			return err
		}
		total += int32(len(message.GetPayload().GetBody()))
	}
}

func (grpcStreamingTestService) FullDuplexCall(stream grpc.BidiStreamingServer[grpc_testing.StreamingOutputCallRequest, grpc_testing.StreamingOutputCallResponse]) error {
	for {
		message, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := stream.Send(&grpc_testing.StreamingOutputCallResponse{Payload: message.GetPayload()}); err != nil {
			return err
		}
	}
}

func startGrpcStreamingTestServer(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server := grpc.NewServer()
	grpc_testing.RegisterTestServiceServer(server, grpcStreamingTestService{})
	reflection.Register(server)

	go func() {
		_ = server.Serve(listener)
	}()

	t.Cleanup(func() {
		server.Stop()
		_ = listener.Close()
	})

	return listener.Addr().String()
}

func invokeGrpcStreamingRequest(t *testing.T, address string, method string, messages []map[string]interface{}) grpcInvokeResponse {
	t.Helper()

	body, err := json.Marshal(map[string]interface{}{
		"address":  address,
		"service":  "grpc.testing.TestService",
		"method":   method,
		"messages": messages,
	})
	if err != nil {
		t.Fatalf("marshal invoke request: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/grpc/invoke", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	grpcInvokeHandler(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("invoke HTTP status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var result grpcInvokeResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode invoke response: %v", err)
	}
	if result.Error != "" || result.Status != "OK" {
		t.Fatalf("invoke failed: status=%s error=%s body=%s", result.Status, result.Error, recorder.Body.String())
	}
	return result
}

func TestGrpcInvokeClientStreamingMessages(t *testing.T) {
	result := invokeGrpcStreamingRequest(t, startGrpcStreamingTestServer(t), "StreamingInputCall", []map[string]interface{}{
		{"payload": map[string]interface{}{"body": "YQ=="}},
		{"payload": map[string]interface{}{"body": "YmM="}},
	})

	if len(result.Messages) != 1 {
		t.Fatalf("client-stream response messages = %d, want 1", len(result.Messages))
	}
	response, ok := result.Messages[0].(map[string]interface{})
	if !ok {
		t.Fatalf("client-stream response type = %T", result.Messages[0])
	}
	size := response["aggregatedPayloadSize"]
	if size == nil {
		size = response["aggregated_payload_size"]
	}
	if size != float64(3) {
		t.Fatalf("aggregated payload size = %#v, want 3", size)
	}
}

func TestGrpcInvokeBidirectionalStreamingMessages(t *testing.T) {
	result := invokeGrpcStreamingRequest(t, startGrpcStreamingTestServer(t), "FullDuplexCall", []map[string]interface{}{
		{"payload": map[string]interface{}{"body": "YQ=="}},
		{"payload": map[string]interface{}{"body": "YmM="}},
	})

	if len(result.Messages) != 2 {
		t.Fatalf("bidi response messages = %d, want 2", len(result.Messages))
	}
}

func TestGrpcParseProtoWithImportsReturnsRichSchema(t *testing.T) {
	body, err := json.Marshal(map[string]interface{}{
		"files": map[string]string{
			"common.proto": `syntax = "proto3";
				package demo;
				message Profile { string name = 1; map<string, string> labels = 2; }`,
			"service.proto": `syntax = "proto3";
				package demo;
				import "common.proto";
				enum Mood { MOOD_UNSPECIFIED = 0; HAPPY = 1; SAD = 2; }
				message HelloRequest {
					string id = 1;
					repeated string tags = 2;
					Mood mood = 3;
					Profile profile = 4;
					oneof target { string user = 5; int64 org = 6; }
				}
				message HelloResponse { string message = 1; }
				service Greeter { rpc SayHello(HelloRequest) returns (HelloResponse); }`,
		},
		"entry_files": []string{"service.proto"},
	})
	if err != nil {
		t.Fatalf("marshal parse proto request: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/grpc/parse-proto", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	grpcParseProtoHandler(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("parse proto status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	var result grpcParseProtoResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode parse proto response: %v", err)
	}
	if len(result.Services) != 1 || result.Services[0].Name != "demo.Greeter" {
		t.Fatalf("services = %#v, want demo.Greeter", result.Services)
	}
	fields := result.Schemas["demo.HelloRequest"]
	if len(fields) == 0 {
		t.Fatalf("missing demo.HelloRequest schema: %#v", result.Schemas)
	}
	var sawRepeated, sawEnum, sawMessage, sawOneof bool
	for _, field := range fields {
		switch field.Name {
		case "tags":
			sawRepeated = field.Repeated
		case "mood":
			sawEnum = len(field.EnumValues) == 3
		case "profile":
			sawMessage = field.MessageType == "demo.Profile"
		case "target":
			sawOneof = field.Oneof && len(field.OneofFields) == 2
		}
	}
	if !sawRepeated || !sawEnum || !sawMessage || !sawOneof {
		t.Fatalf("schema flags repeated=%v enum=%v message=%v oneof=%v fields=%#v", sawRepeated, sawEnum, sawMessage, sawOneof, fields)
	}
	profileFields := result.Schemas["demo.Profile"]
	if len(profileFields) < 2 || !profileFields[1].Map {
		t.Fatalf("profile map schema missing: %#v", profileFields)
	}
}

func TestGrpcParseProtosetReturnsLinkedSchema(t *testing.T) {
	parser := protoparse.Parser{
		Accessor: protoparse.FileContentsFromMap(map[string]string{
			"demo.proto": `syntax = "proto3";
				package demo;
				message PingRequest { string id = 1; }
				message PingResponse { string id = 1; }
				service Echo { rpc Ping(PingRequest) returns (PingResponse); }`,
		}),
	}
	fds, err := parser.ParseFiles("demo.proto")
	if err != nil {
		t.Fatalf("parse proto: %v", err)
	}
	set := desc.ToFileDescriptorSet(fds...)
	raw, err := proto.Marshal(set)
	if err != nil {
		t.Fatalf("marshal descriptor set: %v", err)
	}
	body, err := json.Marshal(map[string]string{"base64": base64.StdEncoding.EncodeToString(raw)})
	if err != nil {
		t.Fatalf("marshal protoset request: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/grpc/parse-protoset", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	grpcParseProtosetHandler(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("parse protoset status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	var result grpcParseProtoResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode protoset response: %v", err)
	}
	if len(result.Services) != 1 || result.Services[0].Name != "demo.Echo" {
		t.Fatalf("services = %#v, want demo.Echo", result.Services)
	}
	if len(result.Schemas["demo.PingRequest"]) != 1 {
		t.Fatalf("missing Ping schema: %#v", result.Schemas)
	}
}
