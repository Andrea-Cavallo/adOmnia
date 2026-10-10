package nettools

import (
	"context"
	"net"
	"os"
	"testing"
)

func TestParseEstablished(t *testing.T) {
	win := "  TCP    127.0.0.1:52144        127.0.0.1:5432         ESTABLISHED     4242\n  TCP    [::1]:52150            [::1]:8080             ESTABLISHED     4242\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900\n"
	if got := parseEstablishedNetstatWindows(win); len(got) != 2 || got[0].RemotePort != 5432 || got[1].RemoteHost != "::1" || got[1].PID != 4242 {
		t.Fatalf("windows: %+v", got)
	}
	ss := "0      0      127.0.0.1:52144   127.0.0.1:5432   users:((\"api\",pid=4242,fd=7))\n"
	if got := parseEstablishedSS(ss); len(got) != 1 || got[0].PID != 4242 || got[0].LocalPort != 52144 {
		t.Fatalf("ss: %+v", got)
	}
	netstat := "tcp        0      0 127.0.0.1:52144         127.0.0.1:5432          ESTABLISHED 4242/api\n"
	if got := parseEstablishedNetstatLinux(netstat); len(got) != 1 || got[0].PID != 4242 {
		t.Fatalf("netstat: %+v", got)
	}
	lsof := "api 4242 me 7u IPv4 0xabc 0t0 TCP 127.0.0.1:52144->127.0.0.1:5432 (ESTABLISHED)\n"
	if got := parseEstablishedLsof(lsof); len(got) != 1 || got[0].RemotePort != 5432 || got[0].PID != 4242 {
		t.Fatalf("lsof: %+v", got)
	}
}

// The real tool sees a connection this test opens to itself.
func TestListEstablishedSeesOwnConnection(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		if conn, err := listener.Accept(); err == nil {
			defer conn.Close()
			select {}
		}
	}()
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conns, err := ListEstablished(context.Background())
	if err != nil {
		t.Skipf("no connection tool: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	for _, c := range conns {
		if c.RemotePort == port && c.PID == os.Getpid() {
			return
		}
	}
	t.Fatalf("own connection to :%d not found among %d", port, len(conns))
}
