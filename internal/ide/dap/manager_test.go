package dap

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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
	if mode == "tcp-known" {
		// The port is chosen by the caller: nothing is printed, the client must know the address.
		listener, err := net.Listen("tcp", os.Getenv("ADOMNIA_DAP_PORT"))
		if err != nil {
			os.Exit(2)
		}
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
		message := ""
		switch request.Command {
		case "initialize":
			success = request.Arguments["adapterID"] == "fake-language"
		case "launch":
			success = request.Arguments["program"] == "fake-program"
		case "threads":
			body = map[string]any{"threads": []map[string]any{{"id": 1, "name": "fake thread"}}}
		case "evaluate":
			body = map[string]any{"result": "42"}
		case "setExceptionBreakpoints":
			// Rifiuta riecheggiando i filtri ricevuti: il messaggio prova cosa è arrivato davvero.
			success = false
			message = "adapter saw filters " + fmt.Sprint(request.Arguments["filters"])
		}
		response := map[string]any{"seq": request.Seq + 100, "type": "response", "request_seq": request.Seq, "success": success, "command": request.Command, "body": body}
		if message != "" {
			response["message"] = message
		}
		send(response)
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

func TestManagerSpawnsProcessAtKnownAddress(t *testing.T) {
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
	// Reserve a free port and release it for the adapter: the address is known in advance and the
	// adapter never prints it (this is how debugpy works).
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	spec := AdapterSpec{
		AdapterID: "fake-language", Executable: os.Args[0], Arguments: []string{"-test.run=^TestDAPAdapterProcess$"},
		Environment:      append(os.Environ(), "ADOMNIA_DAP_HELPER=tcp-known", "ADOMNIA_DAP_PORT="+address),
		WorkingDirectory: root, Address: address,
		Launch: func(string) (string, map[string]any) { return "launch", map[string]any{"program": "fake-program"} },
	}
	started, err := manager.Start(Launch{SessionID: "fake-project", Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(10 * time.Second)
	for {
		select {
		case state := <-states:
			if state.State == DebugTerminated {
				t.Fatalf("startup failed: %+v", state)
			}
			if state.State == DebugRunning {
				goto running
			}
		case <-deadline:
			t.Fatal("handshake timed out")
		}
	}
running:
	threads, err := manager.Threads(started.ID)
	if err != nil || len(threads) != 1 {
		t.Fatalf("threads: %+v %v", threads, err)
	}
	select {
	case output := <-outputs:
		if output.Text != "adapter diagnostic\n" {
			t.Fatalf("unexpected output: %+v", output)
		}
	case <-deadline:
		t.Fatal("process output not forwarded to the debug console")
	}
	if err := manager.Stop(started.ID); err != nil {
		t.Fatal(err)
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

// TestExceptionBreakpointsReachTheAdapter prova PY-6.2: i filtri salvati partono durante
// l'handshake e i cambi a sessione viva arrivano al debug adapter. Il fake adapter rifiuta la
// richiesta riecheggiando i filtri ricevuti, così il messaggio nella vista prova cosa è arrivato.
func TestExceptionBreakpointsReachTheAdapter(t *testing.T) {
	root := t.TempDir()
	manager := NewDebugManager()
	t.Cleanup(manager.Shutdown)
	views := make(chan ExceptionBreakpointsView, 20)
	states := make(chan DebugSessionInfo, 20)
	manager.SetEmitter(func(kind string, _ SessionID, _ string, payload any) {
		switch kind {
		case "debug.exceptionBreakpoints":
			views <- payload.(ExceptionBreakpointsView)
		case "debug.state":
			states <- payload.(DebugSessionInfo)
		}
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	spec := AdapterSpec{
		AdapterID: "fake-language", Executable: os.Args[0], Arguments: []string{"-test.run=^TestDAPAdapterProcess$"},
		Environment:      append(os.Environ(), "ADOMNIA_DAP_HELPER=tcp-known", "ADOMNIA_DAP_PORT="+address),
		WorkingDirectory: root, Address: address,
		Launch: func(string) (string, map[string]any) { return "launch", map[string]any{"program": "fake-program"} },
	}
	manager.SeedBreakpoints(SessionID("fake-project"), nil, FunctionBreakpointSettings{}, ExceptionBreakpointSettings{Filters: []string{"raised", "uncaught"}})
	started, err := manager.Start(Launch{SessionID: "fake-project", Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	// L'handshake rimanda i filtri salvati, prima di configurationDone.
	if view := awaitExceptionView(t, views); !strings.Contains(view.Message, "[raised uncaught]") {
		t.Fatalf("handshake did not send the saved filters: %+v", view)
	}
	// La sessione deve arrivare a running prima dei cambi a runtime.
	deadline := time.After(10 * time.Second)
	for {
		select {
		case state := <-states:
			if state.State == DebugTerminated {
				t.Fatalf("startup failed: %+v", state)
			}
			if state.State == DebugRunning {
				goto running
			}
		case <-deadline:
			t.Fatal("handshake timed out")
		}
	}
running:
	live := manager.SetExceptionBreakpoints(SessionID("fake-project"), ExceptionBreakpointSettings{Filters: []string{"uncaught"}})
	if !strings.Contains(live.Message, "[uncaught]") {
		t.Fatalf("live update did not reach the adapter: %+v", live)
	}
	// Una sessione chiusa non deve più ricevere cambi.
	if err := manager.Stop(started.ID); err != nil {
		t.Fatal(err)
	}
}

func awaitExceptionView(t *testing.T, views <-chan ExceptionBreakpointsView) ExceptionBreakpointsView {
	t.Helper()
	select {
	case view := <-views:
		return view
	case <-time.After(10 * time.Second):
		t.Fatal("the adapter never received setExceptionBreakpoints")
		return ExceptionBreakpointsView{}
	}
}

// TestAdapterThatNeverOpensTheEndpointEndsTheSession prova PY-6.5: un debug adapter che non apre
// mai l'endpoint DAP fa scattare il timeout di avvio e la sessione muore con un errore chiaro,
// invece di restare viva in attesa.
func TestAdapterThatNeverOpensTheEndpointEndsTheSession(t *testing.T) {
	previous := debugAddressTimeout
	debugAddressTimeout = 300 * time.Millisecond
	defer func() { debugAddressTimeout = previous }()
	root := t.TempDir()
	manager := NewDebugManager()
	t.Cleanup(manager.Shutdown)
	states := make(chan DebugSessionInfo, 20)
	manager.SetEmitter(func(kind string, _ SessionID, _ string, payload any) {
		if kind == "debug.state" {
			states <- payload.(DebugSessionInfo)
		}
	})
	spec := AdapterSpec{
		AdapterID: "fake", Executable: neverReadyStub(t), Transport: TCPListen, ReadyPattern: `READY ([0-9.]+:[0-9]+)`,
		WorkingDirectory: root,
		Launch:           func(string) (string, map[string]any) { return "launch", nil },
	}
	started, err := manager.Start(Launch{SessionID: "fake-project", Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(15 * time.Second)
	for {
		select {
		case state := <-states:
			if state.ID == started.ID && state.State == DebugTerminated {
				if !strings.Contains(state.Error, "endpoint") {
					t.Fatalf("unclear failure: %+v", state)
				}
				return
			}
		case <-deadline:
			t.Fatal("a silent debug adapter must end its session")
		}
	}
}

// neverReadyStub è uno script che non stampa mai l'endpoint DAP: .bat su Windows, sh altrove.
// Dorme poco più del tempo del test: la sessione deve morire di timeout, non con lui.
func neverReadyStub(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return writeStub(t, "never-ready.bat", "@echo off\r\nping -n 3 127.0.0.1 > nul\r\n")
	}
	return writeStub(t, "never-ready.sh", "#!/bin/sh\nsleep 2\n")
}

func writeStub(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}
