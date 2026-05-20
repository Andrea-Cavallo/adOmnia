package worker

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type InitRequest struct {
	PluginId      string            `json:"plugin_id"`
	PluginVersion string            `json:"plugin_version"`
	Config        map[string]string `json:"config"`
	DataDir       string            `json:"data_dir"`
}

type InitResponse struct {
	Ready bool   `json:"ready"`
	Error string `json:"error"`
}

type ExecuteRequest struct {
	Action  string            `json:"action"`
	Payload []byte            `json:"payload"`
	Meta    map[string]string `json:"meta"`
}

type ExecuteResponse struct {
	Success    bool   `json:"success"`
	Result     []byte `json:"result"`
	Error      string `json:"error"`
	DurationMs int64  `json:"duration_ms"`
}

type ExecuteChunk struct {
	Data    []byte `json:"data"`
	IsFinal bool   `json:"is_final"`
	Error   string `json:"error"`
}

type PingRequest struct{}

type PingResponse struct {
	UptimeMs    int64 `json:"uptime_ms"`
	MemoryBytes int64 `json:"memory_bytes"`
}

type ShutdownRequest struct {
	GracePeriodMs int64 `json:"grace_period_ms"`
}

type ShutdownResponse struct {
	Clean bool `json:"clean"`
}

// WorkerServiceClient is the client API for WorkerService.
type WorkerServiceClient interface {
	Init(ctx context.Context, in *InitRequest, opts ...grpc.CallOption) (*InitResponse, error)
	Execute(ctx context.Context, in *ExecuteRequest, opts ...grpc.CallOption) (*ExecuteResponse, error)
	ExecuteStream(ctx context.Context, in *ExecuteRequest, opts ...grpc.CallOption) (WorkerService_ExecuteStreamClient, error)
	Ping(ctx context.Context, in *PingRequest, opts ...grpc.CallOption) (*PingResponse, error)
	Shutdown(ctx context.Context, in *ShutdownRequest, opts ...grpc.CallOption) (*ShutdownResponse, error)
}

type WorkerService_ExecuteStreamClient interface {
	Recv() (*ExecuteChunk, error)
	grpc.ClientStream
}

// WorkerServiceServer is the server API for WorkerService.
type WorkerServiceServer interface {
	Init(context.Context, *InitRequest) (*InitResponse, error)
	Execute(context.Context, *ExecuteRequest) (*ExecuteResponse, error)
	ExecuteStream(*ExecuteRequest, WorkerService_ExecuteStreamServer) error
	Ping(context.Context, *PingRequest) (*PingResponse, error)
	Shutdown(context.Context, *ShutdownRequest) (*ShutdownResponse, error)
}

type WorkerService_ExecuteStreamServer interface {
	Send(*ExecuteChunk) error
	grpc.ServerStream
}

// UnimplementedWorkerServiceServer provides default not-implemented methods.
type UnimplementedWorkerServiceServer struct{}

func (UnimplementedWorkerServiceServer) Init(context.Context, *InitRequest) (*InitResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Init not implemented")
}
func (UnimplementedWorkerServiceServer) Execute(context.Context, *ExecuteRequest) (*ExecuteResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Execute not implemented")
}
func (UnimplementedWorkerServiceServer) ExecuteStream(*ExecuteRequest, WorkerService_ExecuteStreamServer) error {
	return status.Errorf(codes.Unimplemented, "method ExecuteStream not implemented")
}
func (UnimplementedWorkerServiceServer) Ping(context.Context, *PingRequest) (*PingResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Ping not implemented")
}
func (UnimplementedWorkerServiceServer) Shutdown(context.Context, *ShutdownRequest) (*ShutdownResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Shutdown not implemented")
}

// Service descriptor and registration

const workerServiceName = "/adomnia.worker.WorkerService/"

func RegisterWorkerServiceServer(s *grpc.Server, srv WorkerServiceServer) {
	sd := &grpc.ServiceDesc{
		ServiceName: "adomnia.worker.WorkerService",
		HandlerType: (*WorkerServiceServer)(nil),
		Methods: []grpc.MethodDesc{
			{MethodName: "Init", Handler: workerInitHandler},
			{MethodName: "Execute", Handler: workerExecuteHandler},
			{MethodName: "Ping", Handler: workerPingHandler},
			{MethodName: "Shutdown", Handler: workerShutdownHandler},
		},
		Streams: []grpc.StreamDesc{
			{StreamName: "ExecuteStream", Handler: workerExecuteStreamHandler, ServerStreams: true},
		},
		Metadata: "worker.proto",
	}
	s.RegisterService(sd, srv)
}

func workerInitHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(InitRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(WorkerServiceServer).Init(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: workerServiceName + "Init"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(WorkerServiceServer).Init(ctx, req.(*InitRequest))
	})
}

func workerExecuteHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ExecuteRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(WorkerServiceServer).Execute(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: workerServiceName + "Execute"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(WorkerServiceServer).Execute(ctx, req.(*ExecuteRequest))
	})
}

func workerPingHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(PingRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(WorkerServiceServer).Ping(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: workerServiceName + "Ping"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(WorkerServiceServer).Ping(ctx, req.(*PingRequest))
	})
}

func workerShutdownHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ShutdownRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(WorkerServiceServer).Shutdown(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: workerServiceName + "Shutdown"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(WorkerServiceServer).Shutdown(ctx, req.(*ShutdownRequest))
	})
}

func workerExecuteStreamHandler(srv interface{}, stream grpc.ServerStream) error {
	in := new(ExecuteRequest)
	if err := stream.RecvMsg(in); err != nil {
		return err
	}
	return srv.(WorkerServiceServer).ExecuteStream(in, &executeStreamServer{stream})
}

type executeStreamServer struct {
	grpc.ServerStream
}

func (x *executeStreamServer) Send(m *ExecuteChunk) error {
	return x.ServerStream.SendMsg(m)
}

// Client implementation

type workerServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewWorkerServiceClient(cc grpc.ClientConnInterface) WorkerServiceClient {
	return &workerServiceClient{cc}
}

func (c *workerServiceClient) Init(ctx context.Context, in *InitRequest, opts ...grpc.CallOption) (*InitResponse, error) {
	out := new(InitResponse)
	err := c.cc.Invoke(ctx, workerServiceName+"Init", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *workerServiceClient) Execute(ctx context.Context, in *ExecuteRequest, opts ...grpc.CallOption) (*ExecuteResponse, error) {
	out := new(ExecuteResponse)
	err := c.cc.Invoke(ctx, workerServiceName+"Execute", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *workerServiceClient) ExecuteStream(ctx context.Context, in *ExecuteRequest, opts ...grpc.CallOption) (WorkerService_ExecuteStreamClient, error) {
	stream, err := c.cc.NewStream(ctx, &grpc.StreamDesc{StreamName: "ExecuteStream", ServerStreams: true}, workerServiceName+"ExecuteStream", opts...)
	if err != nil {
		return nil, err
	}
	if err := stream.SendMsg(in); err != nil {
		return nil, err
	}
	if err := stream.CloseSend(); err != nil {
		return nil, err
	}
	return &executeStreamClient{stream}, nil
}

type executeStreamClient struct {
	grpc.ClientStream
}

func (x *executeStreamClient) Recv() (*ExecuteChunk, error) {
	m := new(ExecuteChunk)
	if err := x.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *workerServiceClient) Ping(ctx context.Context, in *PingRequest, opts ...grpc.CallOption) (*PingResponse, error) {
	out := new(PingResponse)
	err := c.cc.Invoke(ctx, workerServiceName+"Ping", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *workerServiceClient) Shutdown(ctx context.Context, in *ShutdownRequest, opts ...grpc.CallOption) (*ShutdownResponse, error) {
	out := new(ShutdownResponse)
	err := c.cc.Invoke(ctx, workerServiceName+"Shutdown", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
