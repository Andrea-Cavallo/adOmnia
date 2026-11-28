package loadtest

import (
	"context"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/grpc"
)

// grpcTarget is one gRPC call per iteration, on the shared connection of internal/grpc.
type grpcTarget struct {
	call grpc.CallRequest
	step string
}

func newGrpcTarget(call grpc.CallRequest) grpcTarget {
	if len(call.Payload) == 0 {
		call.Payload = []byte("{}")
	}
	return grpcTarget{call: call, step: call.Service + "/" + call.Method}
}

// Status codes that mean no server answered: like a refused connection they stay out of
// the percentiles.
const (
	grpcUnavailable      = 14
	grpcDeadlineExceeded = 4
)

func (t grpcTarget) iterate(ctx context.Context, _, _ int) ([]sample, bool) {
	started := time.Now()
	resp := grpc.Call(ctx, t.call)
	s := sample{stepID: "call", step: t.step, started: started, latency: time.Since(started), sent: true, canceled: ctx.Err() != nil}
	code := grpcStatusCode(resp.Status)
	// internal/grpc reports a failed reflection lookup as NOT_FOUND even when the server was
	// never reached: the cause in the message tells the two apart.
	unreachable := strings.Contains(resp.Error, "code = Unavailable") || strings.Contains(resp.Error, "connection error")
	switch {
	case code < 0 || code == grpcUnavailable || unreachable:
		s.errCode, s.errMsg = "CONN_ERR", resp.Error
	case code == 0:
		s.label, s.status = "OK", 0
		if resp.Error != "" {
			s.errCode, s.errMsg = "GRPC", resp.Error
		}
	case code == grpcDeadlineExceeded:
		s.label, s.status, s.errCode, s.errMsg = grpcCodeNames[code], code, "TIMEOUT", resp.Error
	default:
		s.label, s.status, s.errCode, s.errMsg = grpcCodeNames[code], code, "GRPC_"+grpcCodeNames[code], resp.Error
	}
	if s.errMsg == "" && s.errCode != "" {
		s.errMsg = "gRPC " + resp.Status
	}
	return []sample{s}, !s.ok()
}
