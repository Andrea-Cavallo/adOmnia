package sdk

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Empty struct{}

type HttpRequest struct {
	Method  string            `json:"method"`
	Url     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
}

type Event struct {
	Name    string `json:"name"`
	Payload []byte `json:"payload"`
}

type LogEntry struct {
	Level   string            `json:"level"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields"`
}

type EnvVariables struct {
	Variables map[string]string `json:"variables"`
}

type StorageKey struct {
	Key string `json:"key"`
}

type StorageValue struct {
	Value []byte `json:"value"`
	Found bool   `json:"found"`
}

type StorageEntry struct {
	Key   string `json:"key"`
	Value []byte `json:"value"`
}

// AdOmniaAPIServer is the server API (implemented by Go, called by Python workers).
type AdOmniaAPIServer interface {
	GetCurrentRequest(context.Context, *Empty) (*HttpRequest, error)
	EmitEvent(context.Context, *Event) (*Empty, error)
	Log(context.Context, *LogEntry) (*Empty, error)
	GetEnvVariables(context.Context, *Empty) (*EnvVariables, error)
	StorageGet(context.Context, *StorageKey) (*StorageValue, error)
	StorageSet(context.Context, *StorageEntry) (*Empty, error)
}

// AdOmniaAPIClient is the client API (used by Python workers to call Go).
type AdOmniaAPIClient interface {
	GetCurrentRequest(ctx context.Context, in *Empty, opts ...grpc.CallOption) (*HttpRequest, error)
	EmitEvent(ctx context.Context, in *Event, opts ...grpc.CallOption) (*Empty, error)
	Log(ctx context.Context, in *LogEntry, opts ...grpc.CallOption) (*Empty, error)
	GetEnvVariables(ctx context.Context, in *Empty, opts ...grpc.CallOption) (*EnvVariables, error)
	StorageGet(ctx context.Context, in *StorageKey, opts ...grpc.CallOption) (*StorageValue, error)
	StorageSet(ctx context.Context, in *StorageEntry, opts ...grpc.CallOption) (*Empty, error)
}

// UnimplementedAdOmniaAPIServer provides default not-implemented methods.
type UnimplementedAdOmniaAPIServer struct{}

func (UnimplementedAdOmniaAPIServer) GetCurrentRequest(context.Context, *Empty) (*HttpRequest, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetCurrentRequest not implemented")
}
func (UnimplementedAdOmniaAPIServer) EmitEvent(context.Context, *Event) (*Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method EmitEvent not implemented")
}
func (UnimplementedAdOmniaAPIServer) Log(context.Context, *LogEntry) (*Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Log not implemented")
}
func (UnimplementedAdOmniaAPIServer) GetEnvVariables(context.Context, *Empty) (*EnvVariables, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetEnvVariables not implemented")
}
func (UnimplementedAdOmniaAPIServer) StorageGet(context.Context, *StorageKey) (*StorageValue, error) {
	return nil, status.Errorf(codes.Unimplemented, "method StorageGet not implemented")
}
func (UnimplementedAdOmniaAPIServer) StorageSet(context.Context, *StorageEntry) (*Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method StorageSet not implemented")
}

const sdkServiceName = "/adomnia.sdk.AdOmniaAPI/"

func RegisterAdOmniaAPIServer(s *grpc.Server, srv AdOmniaAPIServer) {
	sd := &grpc.ServiceDesc{
		ServiceName: "adomnia.sdk.AdOmniaAPI",
		HandlerType: (*AdOmniaAPIServer)(nil),
		Methods: []grpc.MethodDesc{
			{MethodName: "GetCurrentRequest", Handler: sdkGetCurrentRequestHandler},
			{MethodName: "EmitEvent", Handler: sdkEmitEventHandler},
			{MethodName: "Log", Handler: sdkLogHandler},
			{MethodName: "GetEnvVariables", Handler: sdkGetEnvVariablesHandler},
			{MethodName: "StorageGet", Handler: sdkStorageGetHandler},
			{MethodName: "StorageSet", Handler: sdkStorageSetHandler},
		},
		Streams:  []grpc.StreamDesc{},
		Metadata: "sdk.proto",
	}
	s.RegisterService(sd, srv)
}

func sdkGetCurrentRequestHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(Empty)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(AdOmniaAPIServer).GetCurrentRequest(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: sdkServiceName + "GetCurrentRequest"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(AdOmniaAPIServer).GetCurrentRequest(ctx, req.(*Empty))
	})
}

func sdkEmitEventHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(Event)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(AdOmniaAPIServer).EmitEvent(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: sdkServiceName + "EmitEvent"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(AdOmniaAPIServer).EmitEvent(ctx, req.(*Event))
	})
}

func sdkLogHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(LogEntry)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(AdOmniaAPIServer).Log(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: sdkServiceName + "Log"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(AdOmniaAPIServer).Log(ctx, req.(*LogEntry))
	})
}

func sdkGetEnvVariablesHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(Empty)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(AdOmniaAPIServer).GetEnvVariables(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: sdkServiceName + "GetEnvVariables"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(AdOmniaAPIServer).GetEnvVariables(ctx, req.(*Empty))
	})
}

func sdkStorageGetHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(StorageKey)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(AdOmniaAPIServer).StorageGet(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: sdkServiceName + "StorageGet"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(AdOmniaAPIServer).StorageGet(ctx, req.(*StorageKey))
	})
}

func sdkStorageSetHandler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(StorageEntry)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(AdOmniaAPIServer).StorageSet(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: sdkServiceName + "StorageSet"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(AdOmniaAPIServer).StorageSet(ctx, req.(*StorageEntry))
	})
}

// Client implementation

type adOmniaAPIClient struct {
	cc grpc.ClientConnInterface
}

func NewAdOmniaAPIClient(cc grpc.ClientConnInterface) AdOmniaAPIClient {
	return &adOmniaAPIClient{cc}
}

func (c *adOmniaAPIClient) GetCurrentRequest(ctx context.Context, in *Empty, opts ...grpc.CallOption) (*HttpRequest, error) {
	out := new(HttpRequest)
	err := c.cc.Invoke(ctx, sdkServiceName+"GetCurrentRequest", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *adOmniaAPIClient) EmitEvent(ctx context.Context, in *Event, opts ...grpc.CallOption) (*Empty, error) {
	out := new(Empty)
	err := c.cc.Invoke(ctx, sdkServiceName+"EmitEvent", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *adOmniaAPIClient) Log(ctx context.Context, in *LogEntry, opts ...grpc.CallOption) (*Empty, error) {
	out := new(Empty)
	err := c.cc.Invoke(ctx, sdkServiceName+"Log", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *adOmniaAPIClient) GetEnvVariables(ctx context.Context, in *Empty, opts ...grpc.CallOption) (*EnvVariables, error) {
	out := new(EnvVariables)
	err := c.cc.Invoke(ctx, sdkServiceName+"GetEnvVariables", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *adOmniaAPIClient) StorageGet(ctx context.Context, in *StorageKey, opts ...grpc.CallOption) (*StorageValue, error) {
	out := new(StorageValue)
	err := c.cc.Invoke(ctx, sdkServiceName+"StorageGet", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *adOmniaAPIClient) StorageSet(ctx context.Context, in *StorageEntry, opts ...grpc.CallOption) (*Empty, error) {
	out := new(Empty)
	err := c.cc.Invoke(ctx, sdkServiceName+"StorageSet", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
