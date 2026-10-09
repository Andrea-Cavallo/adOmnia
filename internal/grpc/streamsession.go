package grpc

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

// Interactive streams: /grpc/stream with "interactive": true keeps the send side open and
// announces a session id; /grpc/stream/send and /grpc/stream/close drive it while the
// NDJSON response keeps delivering what the server sends.

const interactiveStreamTimeout = 30 * time.Minute

type streamSession struct {
	mu     sync.Mutex
	stream grpc.ClientStream
	input  *desc.MessageDescriptor
	closed bool
}

var streamSessions sync.Map // id → *streamSession

func newStreamSessionID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// registerStreamSession returns the session locked: the caller sends the initial messages
// before any /send can interleave, then unlocks it.
func registerStreamSession(stream grpc.ClientStream, input *desc.MessageDescriptor) (string, *streamSession, func()) {
	id := newStreamSessionID()
	session := &streamSession{stream: stream, input: input}
	session.mu.Lock()
	streamSessions.Store(id, session)
	return id, session, func() { streamSessions.Delete(id) }
}

type streamControlRequest struct {
	ID      string          `json:"id"`
	Message json.RawMessage `json:"message,omitempty"`
}

func streamControl(w http.ResponseWriter, r *http.Request) (*streamSession, streamControlRequest, bool) {
	var req streamControlRequest
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return nil, req, false
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return nil, req, false
	}
	value, ok := streamSessions.Load(req.ID)
	if !ok {
		http.Error(w, "stream not open (it ended or was cancelled)", http.StatusNotFound)
		return nil, req, false
	}
	return value.(*streamSession), req, true
}

func writeStreamControl(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		st, _ := status.FromError(err)
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "status": st.Code().String(), "error": st.Message()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// grpcStreamSendHandler sends one message on an open interactive stream.
func grpcStreamSendHandler(w http.ResponseWriter, r *http.Request) {
	session, req, ok := streamControl(w, r)
	if !ok {
		return
	}
	message := dynamic.NewMessage(session.input)
	if len(req.Message) > 0 && string(req.Message) != "null" {
		if err := message.UnmarshalJSON(req.Message); err != nil {
			http.Error(w, "invalid message: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.closed {
		http.Error(w, "the send side is already closed", http.StatusConflict)
		return
	}
	writeStreamControl(w, session.stream.SendMsg(message))
}

// grpcStreamCloseHandler half-closes an interactive stream: the server sees EOF and can finish.
func grpcStreamCloseHandler(w http.ResponseWriter, r *http.Request) {
	session, _, ok := streamControl(w, r)
	if !ok {
		return
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.closed {
		writeStreamControl(w, nil)
		return
	}
	session.closed = true
	writeStreamControl(w, session.stream.CloseSend())
}
