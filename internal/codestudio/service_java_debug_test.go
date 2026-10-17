package codestudio

import (
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestValidJavaClassName(t *testing.T) {
	for name, want := range map[string]bool{
		"it.acme.App": true, "App": true, "it.acme.Outer$Inner": true,
		"": false, "it..App": false, "1bad.App": false, "a b": false, "it.acme.App;rm": false, "-Dx=y": false,
	} {
		if got := validJavaClassName(name); got != want {
			t.Errorf("validJavaClassName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestListenWatcherSeesTheOpenPortOrTheMarker(t *testing.T) {
	port, err := freeLocalPort()
	if err != nil {
		t.Fatal(err)
	}
	waiting := newListenWatcher()
	if err := waiting.wait(port, 400*time.Millisecond); err == nil {
		t.Fatal("a closed port must not release the debugger")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := newListenWatcher().wait(port, 2*time.Second); err != nil {
		t.Fatalf("an occupied port means the JVM listens: %v", err)
	}
	marker := newListenWatcher()
	marker.tap("stdout", []byte("Listening for trans"))
	marker.tap("stdout", []byte("port dt_socket at address: 5005"))
	if err := marker.wait(1, time.Second); err != nil {
		t.Fatalf("marker split across chunks: %v", err)
	}
	ended := newListenWatcher()
	ended.finish()
	free, _ := freeLocalPort()
	if err := ended.wait(free, time.Second); err == nil || !strings.Contains(err.Error(), "ended before") {
		t.Fatalf("a build that ends first must say so, got %v", err)
	}
}
