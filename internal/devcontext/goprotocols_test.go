package devcontext

import (
	"go/parser"
	"go/token"
	"testing"
)

func protocolsOf(t *testing.T, rel, src string) []Entity {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, rel, src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatal(err)
	}
	return append(detectRoutes(rel, fset, file), detectProtocols(rel, fset, file)...)
}

func TestDetectGRPCRegistrationWithAddress(t *testing.T) {
	got := byID(protocolsOf(t, "cmd/server/main.go", `package main
func main() {
	lis, _ := net.Listen("tcp", ":50051")
	s := grpc.NewServer()
	orderv1.RegisterOrderServiceServer(s, &orders{})
	healthpb.RegisterHealthServer(s, health.NewServer())
	s.Serve(lis)
}`))
	order := got["grpc:orderv1.OrderService"]
	if order.Attrs["service"] != "OrderService" || order.Attrs["address"] != ":50051" || order.Sources[0].Line != 5 {
		t.Fatalf("grpc entity: %+v", order)
	}
	if _, ok := got["grpc:healthpb.Health"]; !ok {
		t.Fatalf("health registration missing: %v", keys(got))
	}
}

func TestDetectWebSocketServerLinkedToRouteAndClient(t *testing.T) {
	entities := merge(protocolsOf(t, "api/ws.go", `package api
import "github.com/gorilla/websocket"
var upgrader = websocket.Upgrader{}
func routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /ws/chat", h.serveChat)
}
func (h *handler) serveChat(w http.ResponseWriter, r *http.Request) {
	conn, _ := upgrader.Upgrade(w, r, nil)
	_ = conn
}
func dial() {
	websocket.DefaultDialer.Dial("ws://localhost:9000/feed", nil)
}`))
	linkWebSockets(entities)
	got := byID(entities)
	server := got["websocket:server:api/ws.go:serveChat"]
	if server.Attrs["path"] != "/ws/chat" || server.Label != "/ws/chat" || server.Sources[0].Line != 8 {
		t.Fatalf("server websocket: %+v", server)
	}
	if client := got["websocket:client:ws://localhost:9000/feed"]; client.Attrs["role"] != "client" {
		t.Fatalf("client websocket: %+v in %v", client, keys(got))
	}
}

func TestNoWebSocketWithoutLibraryImport(t *testing.T) {
	for _, e := range protocolsOf(t, "x.go", `package x
func f() { upgrader.Upgrade(w, r, nil) }`) {
		if e.Kind == "websocket" {
			t.Fatalf("unexpected websocket entity %+v", e)
		}
	}
}
