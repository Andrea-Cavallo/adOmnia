package devsession

import (
	"encoding/binary"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

func pgMessage(kind byte, body string) []byte {
	out := []byte{kind, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(out[1:], uint32(len(body)+4))
	return append(out, body...)
}

func TestPostgresProxyReadsQueriesAndRefusesTLS(t *testing.T) {
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()
	received := make(chan []byte, 1)
	go func() {
		conn, err := upstream.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		data, _ := io.ReadAll(conn)
		received <- data
	}()
	var mu sync.Mutex
	var statements []string
	proxy, err := StartSQLProxy("postgres", upstream.Addr().String(), 0, func(sql string) {
		mu.Lock()
		statements = append(statements, sql)
		mu.Unlock()
	})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	client, err := net.Dial("tcp", proxy.Listen)
	if err != nil {
		t.Fatal(err)
	}
	ssl := make([]byte, 8)
	binary.BigEndian.PutUint32(ssl, 8)
	binary.BigEndian.PutUint32(ssl[4:], pgSSLRequest)
	_, _ = client.Write(ssl)
	answer := make([]byte, 1)
	if _, err := io.ReadFull(client, answer); err != nil || answer[0] != 'N' {
		t.Fatalf("SSLRequest must be refused, got %q %v", answer, err)
	}
	startup := make([]byte, 8)
	binary.BigEndian.PutUint32(startup, uint32(8+len("user\x00app\x00\x00")))
	binary.BigEndian.PutUint32(startup[4:], 196608)
	startup = append(startup, "user\x00app\x00\x00"...)
	_, _ = client.Write(startup)
	_, _ = client.Write(pgMessage('Q', "SELECT 1\x00"))
	_, _ = client.Write(pgMessage('P', "s1\x00UPDATE users SET name = $1 WHERE id = $2\x00\x00\x00"))
	_ = client.Close()

	select {
	case data := <-received:
		if len(data) != len(startup)+len(pgMessage('Q', "SELECT 1\x00"))+len(pgMessage('P', "s1\x00UPDATE users SET name = $1 WHERE id = $2\x00\x00\x00")) {
			t.Fatalf("bytes not forwarded unchanged: %d", len(data))
		}
	case <-time.After(3 * time.Second):
		t.Fatal("upstream received nothing")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(statements) != 2 || statements[0] != "SELECT 1" || statements[1] != "UPDATE users SET name = $1 WHERE id = $2" {
		t.Fatalf("unexpected statements %q", statements)
	}
}

func mysqlPacket(seq byte, payload []byte) []byte {
	n := len(payload)
	return append([]byte{byte(n), byte(n >> 8), byte(n >> 16), seq}, payload...)
}

func TestMySQLProxyClearsSSLAndReadsCommands(t *testing.T) {
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()
	greeting := append([]byte{10}, "8.0.36\x00"...)
	greeting = append(greeting, 1, 0, 0, 0)    // connection id
	greeting = append(greeting, "abcdefgh"...) // auth data part 1
	greeting = append(greeting, 0)             // filler
	greeting = append(greeting, 0xff, 0xff)    // capabilities incl. CLIENT_SSL
	go func() {
		conn, err := upstream.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = conn.Write(mysqlPacket(0, greeting))
		_, _ = io.ReadAll(conn)
	}()
	statements := make(chan string, 4)
	proxy, err := StartSQLProxy("mysql", upstream.Addr().String(), 0, func(sql string) { statements <- sql })
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	client, err := net.Dial("tcp", proxy.Listen)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	header := make([]byte, 4)
	if _, err := io.ReadFull(client, header); err != nil {
		t.Fatal(err)
	}
	payload := make([]byte, int(header[0]))
	if _, err := io.ReadFull(client, payload); err != nil {
		t.Fatal(err)
	}
	flags := binary.LittleEndian.Uint16(payload[len(payload)-2:])
	if flags&mysqlClientSSL != 0 {
		t.Fatalf("CLIENT_SSL must be cleared, flags=%x", flags)
	}
	_, _ = client.Write(mysqlPacket(1, []byte("handshake-response")))
	_, _ = client.Write(mysqlPacket(0, append([]byte{mysqlComQuery}, "SELECT * FROM users"...)))
	select {
	case sql := <-statements:
		if sql != "SELECT * FROM users" {
			t.Fatalf("unexpected statement %q", sql)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no statement recorded")
	}
}

func TestSQLProxyRejectsUnknownKinds(t *testing.T) {
	if _, err := StartSQLProxy("oracle", "localhost:1521", 0, nil); err == nil {
		t.Fatal("expected an error")
	}
	if _, err := StartSQLProxy("postgres", "nohostport", 0, nil); err == nil {
		t.Fatal("expected an error")
	}
}
