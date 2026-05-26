package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc"
	grpc_testing "google.golang.org/grpc/interop/grpc_testing"
	"google.golang.org/grpc/reflection"
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
