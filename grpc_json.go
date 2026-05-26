package main

import "encoding/json"

// jsonGRPCCodec matches the JSON-over-gRPC protocol used by the Python SDK.
// Byte slices use encoding/json's base64 representation on the wire.
type jsonGRPCCodec struct{}

func (jsonGRPCCodec) Marshal(value interface{}) ([]byte, error) {
	return json.Marshal(value)
}

func (jsonGRPCCodec) Unmarshal(data []byte, value interface{}) error {
	return json.Unmarshal(data, value)
}

func (jsonGRPCCodec) Name() string {
	return "json"
}
