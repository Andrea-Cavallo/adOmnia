package devcontext

import "testing"

// I servizi gRPC tonic devono diventare entità grpc come quelle Go e dei `.proto`.
func TestDetectRustGrpc(t *testing.T) {
	src := []byte(`tonic::include_proto!("greeter");

#[tonic::async_trait]
impl Greeter for MyGreeter {
    async fn say_hello(&self, _: Request<HelloRequest>) -> Result<Response<HelloReply>, Status> {
        Ok(Response::new(HelloReply {}))
    }
}
`)
	entities := detectRustGrpc("src/main.rs", src)
	byID := map[string]Entity{}
	for _, e := range entities {
		byID[e.ID] = e
	}
	if _, ok := byID["grpc:greeter"]; !ok {
		t.Fatalf("missing include_proto grpc entity: %+v", entities)
	}
	if e, ok := byID["grpc:Greeter"]; !ok || e.Attrs["service"] != "Greeter" {
		t.Fatalf("missing impl service grpc entity: %+v", entities)
	}
	if entities[0].Attrs["language"] != "rust" {
		t.Fatalf("language attr missing: %+v", entities[0].Attrs)
	}
}

// Each rpc method of a tonic impl is an attribute of the service entity: the gRPC client opens it.
func TestDetectRustGrpcCarriesRpcHandlers(t *testing.T) {
	src := []byte(`#[tonic::async_trait]
impl Greeter for MyGreeter {
    async fn say_hello(&self, request: Request<HelloRequest>) -> Result<Response<HelloReply>, Status> {
        todo!()
    }
}
`)
	entities := detectRustGrpc("src/main.rs", src)
	if len(entities) != 1 || entities[0].Attrs[RPCHandlerAttrPrefix+"say_hello"] != "3" || entities[0].Attrs["declFile"] != "src/main.rs" {
		t.Fatalf("entities = %+v", entities)
	}
}

// Gli handler WebSocket e SSE devono diventare entità websocket con il percorso della route.
func TestDetectRustWebSocket(t *testing.T) {
	src := []byte(`async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

let app = Router::new().route("/ws", get(ws_handler));
`)
	entities := detectRustWebSocket("src/main.rs", src)
	if len(entities) != 1 {
		t.Fatalf("want 1 websocket, got %+v", entities)
	}
	if entities[0].Kind != "websocket" || entities[0].Attrs["role"] != "server" || entities[0].Attrs["path"] != "/ws" {
		t.Fatalf("websocket = %+v", entities[0])
	}
}

func TestDetectRustFileYieldsRoutesGrpcWebsocketAndMore(t *testing.T) {
	src := []byte(`tonic::include_proto!("greeter");

#[get("/health")]
async fn health() -> impl Responder { "ok" }

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse { ws.on_upgrade(handle_socket) }
`)
	entities := detectRustFile("src/main.rs", src)
	kinds := map[string]bool{}
	for _, e := range entities {
		kinds[e.Kind] = true
	}
	for _, want := range []string{"route", "grpc", "websocket"} {
		if !kinds[want] {
			t.Fatalf("missing %q in %+v", want, kinds)
		}
	}
}
