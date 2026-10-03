package dap

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"testing"
	"time"
)

// A second adapter uses different startup arguments, readiness text and adapterID.
// It runs from the test executable, so these tests do not need Go or Delve on PATH.
func TestDAPAdapterProcess(t *testing.T) {
	mode := os.Getenv("ADOMNIA_DAP_HELPER")
	if mode == "" {
		return
	}
	var stream io.ReadWriter = struct {
		io.Reader
		io.Writer
	}{os.Stdin, os.Stdout}
	if mode == "tcp" {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			os.Exit(2)
		}
		fmt.Fprintln(os.Stdout, "FAKE READY "+listener.Addr().String())
		conn, err := listener.Accept()
		if err != nil {
			os.Exit(3)
		}
		stream = conn
	}
	fmt.Fprintln(os.Stderr, "adapter diagnostic")
	reader := bufio.NewReader(stream)
	send := func(message any) {
		data, _ := json.Marshal(message)
		fmt.Fprintf(stream, "Content-Length: %d\r\n\r\n%s", len(data), data)
	}
	for {
		frame, err := readFrame(reader)
		if err != nil {
			os.Exit(0)
		}
		var request struct {
			Seq       int            `json:"seq"`
			Command   string         `json:"command"`
			Arguments map[string]any `json:"arguments"`
		}
		if json.Unmarshal(frame, &request) != nil {
			os.Exit(4)
		}
		body := any(map[string]any{})
		success := true
		switch request.Command {
		case "initialize":
			success = request.Arguments["adapterID"] == "fake-language"
		case "launch":
			success = request.Arguments["program"] == "fake-program"
		case "threads":
			body = map[string]any{"threads": []map[string]any{{"id": 1, "name": "fake thread"}}}
		case "evaluate":
			body = map[string]any{"result": "42"}
		}
		send(map[string]any{"seq": request.Seq + 100, "type": "response", "request_seq": request.Seq, "success": success, "command": request.Command, "body": body})
		if request.Command == "launch" {
			send(map[string]any{"seq": 200, "type": "event", "event": "initialized"})
		}
		if request.Command == "disconnect" {
			os.Exit(0)
		}
	}
}

func TestManagerSupportsStdioAndTCPAdapters(t *testing.T) {
	for _, transport := range []Transport{Stdio, TCPListen} {
		t.Run(string(transport), func(t *testing.T) {
			root := t.TempDir()
			manager := NewDebugManager()
			t.Cleanup(manager.Shutdown)
			states := make(chan DebugSessionInfo, 20)
			outputs := make(chan DebugOutput, 20)
			manager.SetEmitter(func(kind string, _ SessionID, _ string, payload any) {
				switch kind {
				case "debug.state":
					states <- payload.(DebugSessionInfo)
				case "debug.output":
					outputs <- payload.(DebugOutput)
				}
			})
			mode := "stdio"
			if transport == TCPListen {
				mode = "tcp"
			}
			spec := AdapterSpec{AdapterID: "fake-language", Executable: os.Args[0], Arguments: []string{"-test.run=^TestDAPAdapterProcess$"}, Environment: append(os.Environ(), "ADOMNIA_DAP_HELPER="+mode), WorkingDirectory: root, Transport: transport, ReadyPattern: `^FAKE READY (.*)$`, Launch: func(string) (string, map[string]any) { return "launch", map[string]any{"program": "fake-program"} }}
			started, err := manager.Start(Launch{SessionID: "fake-project", Root: root, Spec: spec})
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.After(10 * time.Second)
			ready := false
			for !ready {
				select {
				case state := <-states:
					if state.State == DebugTerminated {
						t.Fatalf("startup failed: %+v", state)
					}
					ready = state.State == DebugRunning
				case <-deadline:
					t.Fatal("handshake timed out")
				}
			}
			threads, err := manager.Threads(started.ID)
			if err != nil || len(threads) != 1 || threads[0].Name != "fake thread" {
				t.Fatalf("threads: %+v %v", threads, err)
			}
			value, err := manager.Evaluate(started.ID, "answer", 0, "watch")
			if err != nil || value.Result != "42" {
				t.Fatalf("evaluate: %+v %v", value, err)
			}
			select {
			case output := <-outputs:
				if output.Text != "adapter diagnostic\n" {
					t.Fatalf("unexpected diagnostic: %+v", output)
				}
			case <-deadline:
				t.Fatal("stderr diagnostic missing")
			}
			if err := manager.Stop(started.ID); err != nil {
				t.Fatal(err)
			}
			if len(manager.Active("fake-project")) != 0 {
				t.Fatal("adapter still active after disconnect")
			}
		})
	}
}

func TestManagerRejectsInvalidAdapterBeforeSpawning(t *testing.T) {
	manager := NewDebugManager()
	t.Cleanup(manager.Shutdown)
	for _, spec := range []AdapterSpec{
		{},
		{AdapterID: "fake", Executable: os.Args[0], Transport: TCPListen, ReadyPattern: "[", Launch: func(string) (string, map[string]any) { return "launch", nil }},
		{AdapterID: "fake", Executable: os.Args[0], Transport: TCPListen, ReadyPattern: "no capture", Launch: func(string) (string, map[string]any) { return "launch", nil }},
	} {
		if _, err := manager.Start(Launch{Spec: spec}); err == nil {
			t.Fatal("invalid adapter accepted")
		}
	}
}
