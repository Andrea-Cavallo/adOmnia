package grpc

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jhump/protoreflect/desc"    //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"github.com/jhump/protoreflect/dynamic" //nolint:staticcheck // protoreflect v1 API: moving to protocompile + dynamicpb is a separate refactor
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const defaultCallTimeout = 30 * time.Second

// CallRequest is one gRPC call: unary and server-streaming calls send Payload, client and bidi streams send
// Messages in order. Descriptors describe the service when the server has no reflection.
type CallRequest struct {
	Target      `json:",inline"`
	Service     string              `json:"service"`
	Method      string              `json:"method"`
	Payload     jsonv1.RawMessage   `json:"payload"`
	Messages    []jsonv1.RawMessage `json:"messages,omitempty"`
	Metadata    map[string]string   `json:"metadata,omitempty"`
	TimeoutMs   int                 `json:"timeout_ms,omitzero"`
	Descriptors *DescriptorSource   `json:"descriptors,omitempty"`
	// Interactive (only /grpc/stream): keep sending open; drive it with /grpc/stream/send and /close.
	Interactive bool `json:"interactive,omitzero"`
}

// CallResponse is the outcome of a call; Status is the gRPC code name ("OK", "NOT_FOUND"…).
type CallResponse struct {
	Response         any               `json:"response,omitempty"`
	Messages         []any             `json:"messages,omitempty"`
	Error            string            `json:"error,omitempty"`
	Status           string            `json:"status"`
	TimeMs           int64             `json:"time_ms"`
	ResponseMetadata map[string]string `json:"response_metadata,omitempty"`
	ResponseTrailers map[string]string `json:"response_trailers,omitempty"`
}

type grpcInvokeRequest = CallRequest
type grpcInvokeResponse = CallResponse

func (r CallRequest) validate() error {
	switch {
	case r.Address == "":
		return errors.New("address required")
	case r.Service == "":
		return errors.New("service required")
	case r.Method == "":
		return errors.New("method required")
	}
	return nil
}

func (r CallRequest) timeout(fallback time.Duration) time.Duration {
	if r.TimeoutMs > 0 {
		return time.Duration(r.TimeoutMs) * time.Millisecond
	}
	return fallback
}

// inputs are the request messages: the payload, or the ordered messages of a client/bidi stream.
func (r CallRequest) inputs(method *desc.MethodDescriptor) []jsonv1.RawMessage {
	if method.IsClientStreaming() && len(r.Messages) > 0 {
		return r.Messages
	}
	return []jsonv1.RawMessage{r.Payload}
}

func failure(code, message string, started time.Time) CallResponse {
	return CallResponse{Status: code, Error: message, TimeMs: time.Since(started).Milliseconds()}
}

func statusFailure(err error, started time.Time) CallResponse {
	st, _ := status.FromError(err)
	return failure(st.Code().String(), st.Message(), started)
}

// decodeMessage reads one JSON message into the input type; label names it in the error.
func decodeMessage(raw jsonv1.RawMessage, input *desc.MessageDescriptor, label string) (*dynamic.Message, error) {
	message := dynamic.NewMessage(input)
	if len(raw) == 0 || string(raw) == "null" {
		return message, nil
	}
	if err := message.UnmarshalJSON(raw); err != nil {
		return nil, fmt.Errorf("unmarshal %s: %w", label, err)
	}
	return message, nil
}

// encodeMessage turns a response message into plain JSON values; a message that does not round-trip stays text.
func encodeMessage(message *dynamic.Message) (any, error) {
	data, err := message.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("marshal response: %w", err)
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return string(data), nil
	}
	return value, nil
}

// Call runs a unary call, or a whole client/server/bidi stream collecting every response.
func Call(ctx context.Context, request CallRequest) CallResponse {
	started := time.Now()
	if err := request.validate(); err != nil {
		return failure("INVALID_ARGUMENT", err.Error(), started)
	}
	conn, err := connections.get(request.Target)
	if err != nil {
		return failure("UNAVAILABLE", err.Error(), started)
	}
	ctx, cancel := context.WithTimeout(ctx, request.timeout(defaultCallTimeout))
	defer cancel()
	ctx = outgoingContext(ctx, request.Metadata)
	method, err := resolveMethod(ctx, conn, request.Descriptors, request.Service, request.Method)
	if err != nil {
		return failure("NOT_FOUND", err.Error(), started)
	}
	inputs := make([]*dynamic.Message, 0, len(request.Messages)+1)
	for index, raw := range request.inputs(method) {
		label := "payload"
		if method.IsClientStreaming() {
			label = fmt.Sprintf("message %d", index+1)
		}
		message, err := decodeMessage(raw, method.GetInputType(), label)
		if err != nil {
			return failure("INVALID_ARGUMENT", err.Error(), started)
		}
		inputs = append(inputs, message)
	}
	fullMethod := fmt.Sprintf("/%s/%s", method.GetService().GetFullyQualifiedName(), method.GetName())
	if method.IsClientStreaming() || method.IsServerStreaming() {
		return callStream(ctx, conn, method, fullMethod, inputs, started)
	}
	return callUnary(ctx, conn, method, fullMethod, inputs[0], started)
}

func callUnary(ctx context.Context, conn *grpc.ClientConn, method *desc.MethodDescriptor, fullMethod string, input *dynamic.Message, started time.Time) CallResponse {
	var headers, trailers metadata.MD
	output := dynamic.NewMessage(method.GetOutputType())
	err := conn.Invoke(ctx, fullMethod, input, output, grpc.Header(&headers), grpc.Trailer(&trailers))
	if err != nil {
		response := statusFailure(err, started)
		response.ResponseMetadata, response.ResponseTrailers = metadataMap(headers), metadataMap(trailers)
		return response
	}
	value, err := encodeMessage(output)
	if err != nil {
		return failure("INTERNAL", err.Error(), started)
	}
	return CallResponse{Response: value, Status: "OK", TimeMs: time.Since(started).Milliseconds(), ResponseMetadata: metadataMap(headers), ResponseTrailers: metadataMap(trailers)}
}

func callStream(ctx context.Context, conn *grpc.ClientConn, method *desc.MethodDescriptor, fullMethod string, inputs []*dynamic.Message, started time.Time) CallResponse {
	var headers, trailers metadata.MD
	description := &grpc.StreamDesc{StreamName: method.GetName(), ServerStreams: method.IsServerStreaming(), ClientStreams: method.IsClientStreaming()}
	stream, err := conn.NewStream(ctx, description, fullMethod, grpc.Header(&headers), grpc.Trailer(&trailers))
	if err != nil {
		return statusFailure(err, started)
	}
	received := make(chan receiveResult, 1)
	go func() { received <- receiveAll(stream, method.GetOutputType()) }()
	for _, input := range inputs {
		if err := stream.SendMsg(input); err != nil {
			break // the receive side reports the status that ended the stream
		}
	}
	if err := stream.CloseSend(); err != nil {
		return statusFailure(err, started)
	}
	result := <-received
	response := CallResponse{Messages: result.messages, Status: "OK", TimeMs: time.Since(started).Milliseconds(), ResponseMetadata: metadataMap(headers), ResponseTrailers: metadataMap(trailers)}
	if result.err != nil {
		response.Status, response.Error = "INTERNAL", result.err.Error()
		if st, ok := status.FromError(result.err); ok {
			response.Status, response.Error = st.Code().String(), st.Message()
		}
	}
	return response
}

type receiveResult struct {
	messages []any
	err      error
}

func receiveAll(stream grpc.ClientStream, output *desc.MessageDescriptor) receiveResult {
	messages := make([]any, 0)
	for {
		message := dynamic.NewMessage(output)
		err := stream.RecvMsg(message)
		if errors.Is(err, io.EOF) {
			return receiveResult{messages: messages}
		}
		if err != nil {
			return receiveResult{messages: messages, err: err}
		}
		value, err := encodeMessage(message)
		if err != nil {
			return receiveResult{messages: messages, err: err}
		}
		messages = append(messages, value)
	}
}

// grpcInvokeHandler handles POST /grpc/invoke: one Call, its outcome as JSON (gRPC errors are not HTTP errors).
func grpcInvokeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var request CallRequest
	if err := json.UnmarshalRead(r.Body, &request); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := request.validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, Call(r.Context(), request))
}
