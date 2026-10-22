package rust

import "testing"

func TestGrpcServicesFromTonic(t *testing.T) {
	got := GrpcServicesInFile("src/main.rs", []byte(`tonic::include_proto!("greeter");

#[tonic::async_trait]
impl Greeter for MyGreeter {
    async fn say_hello(&self, req: Request<HelloRequest>) -> Result<Response<HelloReply>, Status> {
        Ok(Response::new(HelloReply {}))
    }
}
`))
	services := map[string]bool{}
	protos := map[string]bool{}
	for _, r := range got {
		services[r.Service] = true
		protos[r.Proto] = true
	}
	if !services["greeter"] || !services["Greeter"] {
		t.Fatalf("services = %#v (got %+v)", services, got)
	}
	if !protos["greeter"] {
		t.Fatalf("protos = %#v", protos)
	}
}

func TestGrpcCompileProtosInBuildScript(t *testing.T) {
	got := GrpcServicesInFile("build.rs", []byte(`fn main() {
    tonic_build::compile_protos("proto/greeter.proto").unwrap();
}
`))
	if len(got) != 1 || got[0].Proto != "proto/greeter.proto" {
		t.Fatalf("got = %+v", got)
	}
}

func TestWebSocketHandlerFromAxum(t *testing.T) {
	source := `async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

let app = Router::new().route("/ws", get(ws_handler));
`
	got := WebSocketsInFile("src/main.rs", []byte(source))
	if len(got) != 1 || got[0].Handler != "ws_handler" || got[0].Path != "/ws" {
		t.Fatalf("got = %+v", got)
	}
	if got[0].SSE {
		t.Fatal("a WebSocket handler must not be marked SSE")
	}
}

func TestSSEHandlerFromAxum(t *testing.T) {
	source := `async fn events() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    Sse::new(stream)
}

let app = Router::new().route("/events", get(events));
`
	got := WebSocketsInFile("src/main.rs", []byte(source))
	if len(got) != 1 || got[0].Handler != "events" || got[0].Path != "/events" || !got[0].SSE {
		t.Fatalf("got = %+v", got)
	}
}

func TestWebSocketAttributeRoute(t *testing.T) {
	source := `#[get("/ws")]
async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}
`
	got := WebSocketsInFile("src/main.rs", []byte(source))
	if len(got) != 1 || got[0].Path != "/ws" {
		t.Fatalf("got = %+v", got)
	}
}

func TestNoWebSocketsWithoutUpgrade(t *testing.T) {
	got := WebSocketsInFile("src/main.rs", []byte("fn main() {}\n"))
	if len(got) != 0 {
		t.Fatalf("got = %+v", got)
	}
}
