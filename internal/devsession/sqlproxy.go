package devsession

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
)

// SQLProxy is an opt-in, loopback-only TCP proxy between a service and its
// database. It forwards every byte unchanged and reads the statements the
// client sends (Postgres simple/extended query, MySQL COM_QUERY/PREPARE).
// Credentials in the startup/auth packets are never parsed or stored.
//
// TLS is refused on the service side (SSLRequest → 'N', MySQL CLIENT_SSL bit
// cleared) so statements stay readable; services that require TLS to the
// database fail to connect through the proxy and must use it without TLS.
type SQLProxy struct {
	Kind     string `json:"kind"`
	Target   string `json:"target"`
	Listen   string `json:"listen"`
	listener net.Listener
	record   func(Statement)
	wg       sync.WaitGroup
	mu       sync.Mutex
	conns    map[net.Conn]struct{}
	closed   bool
}

// StartSQLProxy listens on 127.0.0.1 (port 0 = any free port).
func StartSQLProxy(kind, target string, port int, record func(Statement)) (*SQLProxy, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != "postgres" && kind != "mysql" {
		return nil, fmt.Errorf("SQL capture supports postgres and mysql, not %q", kind)
	}
	if _, _, err := net.SplitHostPort(target); err != nil {
		return nil, fmt.Errorf("database address must be host:port: %w", err)
	}
	if port < 0 || port > 65535 {
		return nil, fmt.Errorf("invalid port %d", port)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", fmt.Sprint(port)))
	if err != nil {
		return nil, err
	}
	proxy := &SQLProxy{Kind: kind, Target: target, Listen: listener.Addr().String(), listener: listener, record: record, conns: map[net.Conn]struct{}{}}
	proxy.wg.Add(1)
	go proxy.accept()
	return proxy, nil
}

func (p *SQLProxy) accept() {
	defer p.wg.Done()
	for {
		client, err := p.listener.Accept()
		if err != nil {
			return
		}
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			p.serve(client)
		}()
	}
}

// track registers a connection; false (and the connection closed) once the proxy is closing.
func (p *SQLProxy) track(conn net.Conn, add bool) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !add {
		delete(p.conns, conn)
		return true
	}
	if p.closed {
		_ = conn.Close()
		return false
	}
	p.conns[conn] = struct{}{}
	return true
}

func (p *SQLProxy) serve(client net.Conn) {
	if !p.track(client, true) {
		return
	}
	server, err := net.DialTimeout("tcp", p.Target, 5*time.Second)
	if err != nil {
		_ = client.Close()
		p.track(client, false)
		return
	}
	if !p.track(server, true) {
		_ = client.Close()
		p.track(client, false)
		return
	}
	defer func() {
		_ = client.Close()
		_ = server.Close()
		p.track(client, false)
		p.track(server, false)
	}()
	// Il tracker accoppia ogni istruzione alla sua risposta: durata, righe, errori, transazioni.
	tracker := newStatementTracker(p.record)
	done := make(chan struct{}, 2)
	go func() {
		if p.Kind == "postgres" {
			_ = pgClientToServer(client, server, tracker)
		} else {
			_ = mysqlClientToServer(client, server, tracker)
		}
		done <- struct{}{}
	}()
	go func() {
		if p.Kind == "mysql" {
			_ = mysqlServerToClient(server, client, tracker)
		} else {
			_ = pgServerToClient(server, client, tracker)
		}
		done <- struct{}{}
	}()
	<-done
	tracker.flush()
}

// Close stops listening and drops open connections.
func (p *SQLProxy) Close() {
	_ = p.listener.Close()
	p.mu.Lock()
	p.closed = true
	for conn := range p.conns {
		_ = conn.Close()
	}
	p.mu.Unlock()
	p.wg.Wait()
}

const (
	pgSSLRequest    = 80877103
	pgGSSENCRequest = 80877104
	maxSQLMessage   = 64 << 20
)

// pgClientToServer forwards the Postgres frontend stream and reads Query, Parse, Bind and Execute.
func pgClientToServer(client io.ReadWriter, server io.Writer, tracker *statementTracker) error {
	reader := bufio.NewReader(client)
	// Startup phase: untyped messages (length + code), possibly several
	// encryption requests before the real startup packet.
	for {
		header := make([]byte, 8)
		if _, err := io.ReadFull(reader, header); err != nil {
			return err
		}
		length := binary.BigEndian.Uint32(header[:4])
		code := binary.BigEndian.Uint32(header[4:])
		if length == 8 && (code == pgSSLRequest || code == pgGSSENCRequest) {
			if _, err := client.Write([]byte{'N'}); err != nil {
				return err
			}
			continue
		}
		if length < 8 || length > maxSQLMessage {
			return errors.New("invalid postgres startup packet")
		}
		rest := make([]byte, length-8)
		if _, err := io.ReadFull(reader, rest); err != nil {
			return err
		}
		if _, err := server.Write(append(header, rest...)); err != nil {
			return err
		}
		break
	}
	for {
		header := make([]byte, 5)
		if _, err := io.ReadFull(reader, header); err != nil {
			return err
		}
		length := binary.BigEndian.Uint32(header[1:])
		if length < 4 || length > maxSQLMessage {
			return errors.New("invalid postgres message")
		}
		body := make([]byte, length-4)
		if _, err := io.ReadFull(reader, body); err != nil {
			return err
		}
		tracker.pgClientMessage(header[0], body)
		if _, err := server.Write(append(header, body...)); err != nil {
			return err
		}
	}
}

// pgServerToClient forwards the backend stream and reads completions, errors and transaction state.
func pgServerToClient(server io.Reader, client io.Writer, tracker *statementTracker) error {
	reader := bufio.NewReader(server)
	for {
		header := make([]byte, 5)
		if _, err := io.ReadFull(reader, header); err != nil {
			return err
		}
		length := binary.BigEndian.Uint32(header[1:])
		if length < 4 || length > maxSQLMessage {
			return errors.New("invalid postgres message")
		}
		body := make([]byte, length-4)
		if _, err := io.ReadFull(reader, body); err != nil {
			return err
		}
		tracker.pgServerMessage(header[0], body)
		if _, err := client.Write(append(header, body...)); err != nil {
			return err
		}
	}
}

func cString(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

const (
	mysqlClientSSL      = 0x0800
	mysqlComQuery       = 0x03
	mysqlComStmtPrepare = 0x16
)

func readMySQLPacket(reader io.Reader) ([]byte, []byte, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return nil, nil, err
	}
	length := int(header[0]) | int(header[1])<<8 | int(header[2])<<16
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, nil, err
	}
	return header, payload, nil
}

// mysqlServerToClient clears CLIENT_SSL in the server greeting, then follows the responses.
func mysqlServerToClient(server io.Reader, client io.Writer, tracker *statementTracker) error {
	reader := bufio.NewReader(server)
	header, payload, err := readMySQLPacket(reader)
	if err != nil {
		return err
	}
	if len(payload) > 0 && payload[0] == 10 { // protocol v10 greeting
		if nul := strings.IndexByte(string(payload[1:]), 0); nul >= 0 {
			// version\0, connection id (4), auth data (8), filler (1), capabilities (2)
			offset := 1 + nul + 1 + 4 + 8 + 1
			if offset+2 <= len(payload) {
				flags := binary.LittleEndian.Uint16(payload[offset:])
				binary.LittleEndian.PutUint16(payload[offset:], flags&^mysqlClientSSL)
				capabilities := uint32(flags &^ mysqlClientSSL)
				// charset (1) and status (2), then the upper capability bytes.
				if upper := offset + 2 + 3; upper+2 <= len(payload) {
					capabilities |= uint32(binary.LittleEndian.Uint16(payload[upper:])) << 16
				}
				tracker.mysqlCapabilities(capabilities, 0)
			}
		}
	}
	if _, err := client.Write(append(header, payload...)); err != nil {
		return err
	}
	responses := &mysqlResponses{tracker: tracker}
	for {
		header, payload, err := readMySQLPacket(reader)
		if err != nil {
			return err
		}
		// Prima del primo comando del client i pacchetti sono dell'autenticazione.
		if tracker.commandsStarted() {
			responses.packet(payload)
		}
		if _, err := client.Write(append(header, payload...)); err != nil {
			return err
		}
	}
}

// mysqlClientToServer forwards client packets and reads commands (sequence 0).
func mysqlClientToServer(client io.Reader, server io.Writer, tracker *statementTracker) error {
	reader := bufio.NewReader(client)
	for {
		header, payload, err := readMySQLPacket(reader)
		if err != nil {
			return err
		}
		switch {
		case header[3] == 1 && !tracker.commandsStarted() && len(payload) >= 4:
			tracker.mysqlCapabilities(0, binary.LittleEndian.Uint32(payload[:4]))
		case header[3] == 0:
			tracker.startCommands()
			tracker.mysqlCommand(payload)
		}
		if _, err := server.Write(append(header, payload...)); err != nil {
			return err
		}
	}
}
