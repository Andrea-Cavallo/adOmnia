package run

import (
	"net"
	"testing"
	"time"
)

func TestWaitPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	if err := WaitPort(port, time.Second, func() bool { return true }); err != nil {
		t.Fatalf("open port: %v", err)
	}
	_ = listener.Close()
	if err := WaitPort(port, 400*time.Millisecond, func() bool { return true }); err == nil {
		t.Fatal("closed port must time out")
	}
	if err := WaitPort(port, time.Second, func() bool { return false }); err == nil {
		t.Fatal("dead process must fail fast")
	}
}
