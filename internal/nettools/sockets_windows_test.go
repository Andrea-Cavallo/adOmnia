//go:build windows

package nettools

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestDecodeTCPOwnerTable(t *testing.T) {
	for _, family := range []uint32{windows.AF_INET, windows.AF_INET6} {
		size, localPort, remotePort, state, pid := 24, 8, 16, 0, 20
		if family == windows.AF_INET6 {
			size, localPort, remotePort, state, pid = 56, 20, 44, 48, 52
		}
		table := make([]byte, 4+size)
		binary.LittleEndian.PutUint32(table, 1)
		row := table[4:]
		binary.LittleEndian.PutUint32(row[state:], 5)
		binary.LittleEndian.PutUint32(row[pid:], 4242)
		binary.BigEndian.PutUint16(row[localPort:], 52144)
		binary.BigEndian.PutUint16(row[remotePort:], 5432)
		conns, _, err := decodeTCPOwnerTable(table, family, false)
		if err != nil || len(conns) != 1 || conns[0].PID != 4242 || conns[0].LocalPort != 52144 || conns[0].RemotePort != 5432 {
			t.Fatalf("family %d: %+v %v", family, conns, err)
		}
		binary.LittleEndian.PutUint32(row[state:], 0)
		_, ports, err := decodeTCPOwnerTable(table, family, true)
		if err != nil || len(ports) != 1 || ports[0].PID != 4242 || ports[0].Port != 52144 {
			t.Fatalf("listener family %d: %+v %v", family, ports, err)
		}
		if _, _, err := decodeTCPOwnerTable(table[:len(table)-1], family, false); err == nil {
			t.Fatal("accepted truncated row")
		}
	}
	if _, _, err := decodeTCPOwnerTable(nil, windows.AF_INET, false); err == nil {
		t.Fatal("accepted missing header")
	}
}

func TestTCPSocketsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := ListTCPSockets(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestTCPSocketsOwnListenerAndConnection(t *testing.T) {
	for _, network := range []string{"tcp4", "tcp6"} {
		t.Run(network, func(t *testing.T) {
			address := "127.0.0.1:0"
			if network == "tcp6" {
				address = "[::1]:0"
			}
			listener, err := net.Listen(network, address)
			if err != nil {
				if network == "tcp6" {
					t.Skipf("IPv6 unavailable: %v", err)
				}
				t.Fatal(err)
			}
			defer listener.Close()
			client, err := net.DialTimeout(network, listener.Addr().String(), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if err := listener.(*net.TCPListener).SetDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			server, err := listener.Accept()
			if err != nil {
				t.Fatal(err)
			}
			defer server.Close()
			port := listener.Addr().(*net.TCPAddr).Port
			deadline := time.Now().Add(3 * time.Second)
			for {
				conns, ports, err := ListTCPSockets(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				listening, connected := false, false
				for _, entry := range ports {
					listening = listening || (entry.PID == os.Getpid() && entry.Port == port)
				}
				for _, entry := range conns {
					connected = connected || (entry.PID == os.Getpid() && entry.RemotePort == port)
				}
				if listening && connected {
					return
				}
				if time.Now().After(deadline) {
					t.Fatalf("%s listener=%v established=%v port=%d", network, listening, connected, port)
				}
				time.Sleep(20 * time.Millisecond)
			}
		})
	}
}
