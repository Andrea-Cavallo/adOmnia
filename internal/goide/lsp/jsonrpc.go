// Package lsp implementa il sottoinsieme del Language Server Protocol usato da Go Studio:
// framing JSON-RPC su stdio, tipi del protocollo e conversioni di posizione UTF-16.
package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

const (
	// MaxMessageBytes limita la dimensione di un singolo messaggio per proteggere la memoria.
	MaxMessageBytes = 64 * 1024 * 1024
	contentLength   = "Content-Length"
	codeCancelled   = -32800
	codeNoMethod    = -32601
)

// ErrClosed indica che la connessione con il language server è terminata.
var ErrClosed = errors.New("language server non disponibile")

// ResponseError è l'errore tipizzato restituito dal server.
type ResponseError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *ResponseError) Error() string {
	return fmt.Sprintf("errore language server %d: %s", e.Code, e.Message)
}

type wireMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *ResponseError  `json:"error,omitempty"`
}

type response struct {
	result json.RawMessage
	err    error
}

// Handler riceve notifiche e richieste avviate dal server.
type Handler interface {
	// HandleNotification elabora una notifica server → client.
	HandleNotification(method string, params json.RawMessage)
	// HandleRequest risponde a una richiesta server → client; ErrMethodNotFound se non supportata.
	HandleRequest(ctx context.Context, method string, params json.RawMessage) (any, error)
}

// ErrMethodNotFound segnala al server che il client non implementa il metodo richiesto.
var ErrMethodNotFound = errors.New("metodo non supportato")

// Conn è una connessione JSON-RPC 2.0 con framing LSP su uno stream bidirezionale.
type Conn struct {
	reader  *bufio.Reader
	writer  io.Writer
	writeMu sync.Mutex
	handler Handler
	nextID  atomic.Int64
	mu      sync.Mutex
	pending map[int64]chan response
	closed  bool
	done    chan struct{}
	err     error
}

// NewConn crea la connessione; Run deve essere avviato per leggere i messaggi.
func NewConn(stream io.Reader, writer io.Writer, handler Handler) *Conn {
	return &Conn{
		reader:  bufio.NewReaderSize(stream, 64*1024),
		writer:  writer,
		handler: handler,
		pending: make(map[int64]chan response),
		done:    make(chan struct{}),
	}
}

// Done si chiude quando la lettura termina.
func (c *Conn) Done() <-chan struct{} { return c.done }

// Err restituisce l'errore che ha terminato la connessione, se presente.
func (c *Conn) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
}

// Run legge i messaggi fino a EOF o errore, poi sblocca tutte le richieste pendenti.
func (c *Conn) Run() {
	var readErr error
	for {
		payload, err := readFrame(c.reader)
		if err != nil {
			readErr = err
			break
		}
		var message wireMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		c.dispatch(message)
	}
	c.shutdown(readErr)
}

// Call invia una richiesta e attende la risposta; se ctx termina invia $/cancelRequest.
func (c *Conn) Call(ctx context.Context, method string, params, result any) error {
	id := c.nextID.Add(1)
	reply := make(chan response, 1)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return ErrClosed
	}
	c.pending[id] = reply
	c.mu.Unlock()
	if err := c.write(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		c.forget(id)
		return err
	}
	select {
	case answer := <-reply:
		if answer.err != nil {
			return answer.err
		}
		if result == nil || len(answer.result) == 0 || string(answer.result) == "null" {
			return nil
		}
		if err := json.Unmarshal(answer.result, result); err != nil {
			return fmt.Errorf("risposta %s non valida: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		c.forget(id)
		_ = c.Notify("$/cancelRequest", map[string]any{"id": id})
		return ctx.Err()
	}
}

// Notify invia una notifica senza attendere risposta.
func (c *Conn) Notify(method string, params any) error {
	return c.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func (c *Conn) forget(id int64) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

func (c *Conn) dispatch(message wireMessage) {
	switch {
	case message.Method != "" && len(message.ID) > 0:
		go c.answer(message)
	case message.Method != "":
		if c.handler != nil {
			c.handler.HandleNotification(message.Method, message.Params)
		}
	case len(message.ID) > 0:
		c.resolve(message)
	}
}

func (c *Conn) resolve(message wireMessage) {
	id, err := strconv.ParseInt(strings.Trim(string(message.ID), `"`), 10, 64)
	if err != nil {
		return
	}
	c.mu.Lock()
	reply := c.pending[id]
	delete(c.pending, id)
	c.mu.Unlock()
	if reply == nil {
		return
	}
	if message.Error != nil {
		reply <- response{err: message.Error}
		return
	}
	reply <- response{result: message.Result}
}

func (c *Conn) answer(message wireMessage) {
	var result any
	err := ErrMethodNotFound
	if c.handler != nil {
		result, err = c.handler.HandleRequest(context.Background(), message.Method, message.Params)
	}
	reply := map[string]any{"jsonrpc": "2.0", "id": message.ID}
	switch {
	case errors.Is(err, ErrMethodNotFound):
		reply["error"] = ResponseError{Code: codeNoMethod, Message: "method not found: " + message.Method}
	case err != nil:
		reply["error"] = ResponseError{Code: -32603, Message: err.Error()}
	default:
		reply["result"] = result
	}
	_ = c.write(reply)
}

func (c *Conn) write(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("serializzazione messaggio LSP fallita: %w", err)
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := fmt.Fprintf(c.writer, "%s: %d\r\n\r\n", contentLength, len(data)); err != nil {
		return ErrClosed
	}
	if _, err := c.writer.Write(data); err != nil {
		return ErrClosed
	}
	return nil
}

func (c *Conn) shutdown(cause error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	if cause != nil && !errors.Is(cause, io.EOF) {
		c.err = cause
	}
	pending := c.pending
	c.pending = map[int64]chan response{}
	c.mu.Unlock()
	for _, reply := range pending {
		reply <- response{err: ErrClosed}
	}
	close(c.done)
}

// IsCancelled indica se l'errore corrisponde a una richiesta annullata dal client o dal server.
func IsCancelled(err error) bool {
	var responseErr *ResponseError
	if errors.As(err, &responseErr) {
		return responseErr.Code == codeCancelled
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func readFrame(reader *bufio.Reader) ([]byte, error) {
	length := -1
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		name, value, ok := strings.Cut(line, ":")
		if ok && strings.EqualFold(strings.TrimSpace(name), contentLength) {
			parsed, err := strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("header Content-Length non valido")
			}
			length = parsed
		}
	}
	if length < 0 || length > MaxMessageBytes {
		return nil, fmt.Errorf("messaggio LSP senza lunghezza valida")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, err
	}
	return payload, nil
}
