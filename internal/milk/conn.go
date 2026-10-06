package milk

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
)

// maxMessageBytes limita un singolo messaggio JSON-RPC per proteggere la memoria.
const maxMessageBytes = 32 * 1024 * 1024

// ErrClosed indica che la connessione con il processo milk è terminata.
var ErrClosed = errors.New("milk process is not available")

// ErrMethodNotFound segnala a milk che il client non implementa il metodo richiesto.
var ErrMethodNotFound = errors.New("method not supported")

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("milk error %d: %s", e.Code, e.Message) }

type wireMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type response struct {
	result json.RawMessage
	err    error
}

// Handler riceve notifiche e richieste avviate da milk (session/update,
// session/request_permission, …).
type Handler interface {
	HandleNotification(method string, params json.RawMessage)
	HandleRequest(ctx context.Context, method string, params json.RawMessage) (any, error)
}

// Conn è una connessione JSON-RPC 2.0 newline-delimited (ACP) su uno stream bidirezionale.
type Conn struct {
	reader  *bufio.Reader
	writer  io.Writer
	writeMu sync.Mutex
	handler Handler
	nextID  atomic.Int64
	mu      sync.Mutex
	pending map[string]chan response
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
		pending: make(map[string]chan response),
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

// Run legge una linea JSON-RPC alla volta fino a EOF o errore.
func (c *Conn) Run() {
	var readErr error
	scanner := bufio.NewScanner(c.reader)
	scanner.Buffer(make([]byte, 64*1024), maxMessageBytes)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var message wireMessage
		if err := json.Unmarshal(line, &message); err != nil {
			continue
		}
		c.dispatch(message)
	}
	if err := scanner.Err(); err != nil {
		readErr = err
	}
	c.shutdown(readErr)
}

// Call invia una richiesta e attende la risposta. Gli id sono stringhe JSON,
// come li usa milk (StdioConn.Request), così la correlazione resta byte-per-byte.
func (c *Conn) Call(ctx context.Context, method string, params, result any) error {
	idJSON, _ := json.Marshal(fmt.Sprintf("%d", c.nextID.Add(1)))
	key := string(idJSON)
	reply := make(chan response, 1)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return ErrClosed
	}
	c.pending[key] = reply
	c.mu.Unlock()
	if err := c.write(map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(idJSON), "method": method, "params": params}); err != nil {
		c.forget(key)
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
			return fmt.Errorf("invalid %s response: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		c.forget(key)
		return ctx.Err()
	}
}

// Notify invia una notifica senza attendere risposta.
func (c *Conn) Notify(method string, params any) error {
	return c.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func (c *Conn) forget(key string) {
	c.mu.Lock()
	delete(c.pending, key)
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
	key := string(message.ID)
	c.mu.Lock()
	reply := c.pending[key]
	delete(c.pending, key)
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
	reply := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(message.ID)}
	switch {
	case errors.Is(err, ErrMethodNotFound):
		reply["error"] = rpcError{Code: -32601, Message: "method not found: " + message.Method}
	case err != nil:
		reply["error"] = rpcError{Code: -32603, Message: err.Error()}
	default:
		reply["result"] = result
	}
	_ = c.write(reply)
}

func (c *Conn) write(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("serialize JSON-RPC message: %w", err)
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := c.writer.Write(data); err != nil {
		return ErrClosed
	}
	if _, err := c.writer.Write([]byte("\n")); err != nil {
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
	c.pending = map[string]chan response{}
	c.mu.Unlock()
	for _, reply := range pending {
		reply <- response{err: ErrClosed}
	}
	close(c.done)
}
