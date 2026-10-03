// Package dap implementa il lato client del Debug Adapter Protocol usato da Delve (dlv dap).
package dap

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
)

const maxFrameBytes = 32 * 1024 * 1024

// ErrClosed indica che la connessione con il debug adapter è chiusa.
var ErrClosed = errors.New("connessione DAP chiusa")

// Event è un evento del debug adapter (stopped, output, terminated…).
type Event struct {
	Event string          `json:"event"`
	Body  json.RawMessage `json:"body"`
}

type message struct {
	Seq       int    `json:"seq"`
	Type      string `json:"type"`
	Command   string `json:"command,omitempty"`
	Arguments any    `json:"arguments,omitempty"`
}

type rawMessage struct {
	Seq        int             `json:"seq"`
	Type       string          `json:"type"`
	Command    string          `json:"command"`
	RequestSeq int             `json:"request_seq"`
	Success    bool            `json:"success"`
	Message    string          `json:"message"`
	Body       json.RawMessage `json:"body"`
	Event      string          `json:"event"`
}

// ResponseError è una risposta DAP con success=false.
type ResponseError struct {
	Command string
	Message string
}

func (e *ResponseError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("%s non riuscito", e.Command)
	}
	return e.Message
}

// Client parla con un debug adapter su uno stream (TCP per dlv dap).
type Client struct {
	writer  io.Writer
	writeMu sync.Mutex
	mu      sync.Mutex
	seq     int
	pending map[int]chan rawMessage
	events  chan Event
	done    chan struct{}
	err     error
	once    sync.Once
}

// NewClient avvia la lettura dello stream; gli eventi arrivano in ordine sul canale Events.
func NewClient(stream io.ReadWriter) *Client {
	client := &Client{writer: stream, pending: make(map[int]chan rawMessage), events: make(chan Event, 1024), done: make(chan struct{})}
	go client.read(bufio.NewReader(stream))
	return client
}

// Events restituisce il canale degli eventi, chiuso alla chiusura della connessione.
func (c *Client) Events() <-chan Event { return c.events }

// Done si chiude quando la connessione termina.
func (c *Client) Done() <-chan struct{} { return c.done }

// Call invia una richiesta e decodifica il body della risposta in result (se non nil).
func (c *Client) Call(ctx context.Context, command string, arguments, result any) error {
	c.mu.Lock()
	if c.pending == nil {
		c.mu.Unlock()
		return ErrClosed
	}
	c.seq++
	seq := c.seq
	reply := make(chan rawMessage, 1)
	c.pending[seq] = reply
	c.mu.Unlock()
	if err := c.write(message{Seq: seq, Type: "request", Command: command, Arguments: arguments}); err != nil {
		c.forget(seq)
		return err
	}
	select {
	case response := <-reply:
		if !response.Success {
			return &ResponseError{Command: command, Message: errorDetail(response)}
		}
		if result != nil && len(response.Body) > 0 {
			return json.Unmarshal(response.Body, result)
		}
		return nil
	case <-ctx.Done():
		c.forget(seq)
		return ctx.Err()
	case <-c.done:
		return ErrClosed
	}
}

// errorDetail preferisce il messaggio dettagliato di body.error (es. "could not find symbol") a quello generico.
func errorDetail(response rawMessage) string {
	var body struct {
		Error *struct {
			Format string `json:"format"`
		} `json:"error"`
	}
	if json.Unmarshal(response.Body, &body) == nil && body.Error != nil && strings.TrimSpace(body.Error.Format) != "" {
		return strings.TrimSpace(body.Error.Format)
	}
	return response.Message
}

func (c *Client) forget(seq int) {
	c.mu.Lock()
	if c.pending != nil {
		delete(c.pending, seq)
	}
	c.mu.Unlock()
}

// response è una risposta del client: success va sempre serializzato, anche quando è false.
type response struct {
	Seq        int    `json:"seq"`
	Type       string `json:"type"`
	RequestSeq int    `json:"request_seq"`
	Command    string `json:"command"`
	Success    bool   `json:"success"`
	Message    string `json:"message,omitempty"`
}

func (c *Client) write(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := fmt.Fprintf(c.writer, "Content-Length: %d\r\n\r\n", len(data)); err != nil {
		return err
	}
	_, err = c.writer.Write(data)
	return err
}

func (c *Client) read(reader *bufio.Reader) {
	defer c.shutdown()
	for {
		frame, err := readFrame(reader)
		if err != nil {
			c.mu.Lock()
			c.err = err
			c.mu.Unlock()
			return
		}
		var incoming rawMessage
		if json.Unmarshal(frame, &incoming) != nil {
			continue
		}
		switch incoming.Type {
		case "response":
			c.mu.Lock()
			reply := c.pending[incoming.RequestSeq]
			delete(c.pending, incoming.RequestSeq)
			c.mu.Unlock()
			if reply != nil {
				reply <- incoming
			}
		case "event":
			select {
			case c.events <- Event{Event: incoming.Event, Body: incoming.Body}:
			case <-c.done:
				return
			}
		case "request":
			// Richieste inverse (es. runInTerminal) non supportate: si risponde con un errore esplicito,
			// in un goroutine separato, così la lettura non si blocca se l'adapter sta scrivendo.
			reply := response{Type: "response", RequestSeq: incoming.Seq, Command: incoming.Command, Success: false, Message: "non supportato da adOmnia"}
			go func() { _ = c.write(reply) }()
		}
	}
}

func (c *Client) shutdown() {
	c.once.Do(func() {
		c.mu.Lock()
		c.pending = nil
		c.mu.Unlock()
		close(c.done)
		close(c.events)
	})
}

// Err restituisce il motivo della chiusura, se la lettura si è interrotta per un errore.
func (c *Client) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
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
		if ok && strings.EqualFold(strings.TrimSpace(name), "Content-Length") {
			length, err = strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("Content-Length non valido: %w", err)
			}
		}
	}
	if length < 0 || length > maxFrameBytes {
		return nil, fmt.Errorf("frame DAP non valido (%d byte)", length)
	}
	frame := make([]byte, length)
	_, err := io.ReadFull(reader, frame)
	return frame, err
}
