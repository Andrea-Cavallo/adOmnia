package ws

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/gorilla/websocket"
)

const (
	wsHandshakeTimeout = 15 * time.Second
	// maxRejectionBody is how much of a refused handshake's body the error quotes.
	maxRejectionBody = 300
)

// droppedHint explains an abrupt close: the usual causes, in the order worth checking.
const droppedHint = "check the proxy in Settings → Network (a corporate proxy or firewall drops direct connections), " +
	"the scheme (wss:// for TLS) and the headers or subprotocol the server requires"

// wsDialer opens a handshake with the same network settings as an HTTP request: adOmnia's
// proxy (else the system's HTTPS_PROXY/HTTP_PROXY) and the corporate CA. It offers
// permessage-deflate like browsers and Postman do; the server decides whether to use it.
func wsDialer(subprotocols []string) (*websocket.Dialer, error) {
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	if err := netpolicy.Apply(transport); err != nil {
		return nil, fmt.Errorf("network settings: %w", err)
	}
	return &websocket.Dialer{
		HandshakeTimeout:  wsHandshakeTimeout,
		Subprotocols:      subprotocols,
		Proxy:             transport.Proxy,
		TLSClientConfig:   transport.TLSClientConfig,
		EnableCompression: true,
	}, nil
}

// handshakeError is the message for a failed connect: the server's own answer when it refused
// the upgrade, a hint when the connection was dropped mid-handshake.
func handshakeError(err error, response *http.Response) string {
	if response != nil && errors.Is(err, websocket.ErrBadHandshake) {
		return fmt.Sprintf("the server refused the WebSocket upgrade: %s%s", response.Status, rejectionBody(response))
	}
	if droppedConnection(err) {
		return fmt.Sprintf("%v: the connection was closed during the handshake; %s", err, droppedHint)
	}
	return err.Error()
}

// readError is the message for a connection that ended while it was open.
func readError(err error) string {
	if websocket.IsCloseError(err, websocket.CloseAbnormalClosure) || droppedConnection(err) {
		return fmt.Sprintf("%v: the server (or a proxy between) closed the connection without a close frame; %s", err, droppedHint)
	}
	return err.Error()
}

func droppedConnection(err error) bool {
	return errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) || strings.Contains(err.Error(), "unexpected EOF")
}

func rejectionBody(response *http.Response) string {
	if response.Body == nil {
		return ""
	}
	defer func() { _ = response.Body.Close() }() // read-only: the handshake already failed
	body, err := io.ReadAll(io.LimitReader(response.Body, maxRejectionBody))
	text := strings.TrimSpace(string(body))
	if err != nil || text == "" {
		return ""
	}
	return ": " + text
}
