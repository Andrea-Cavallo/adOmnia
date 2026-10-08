package collab

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	maxMessageBytes   = 10 << 20 // come il body limit del sidecar
	maxParticipants   = 16
	maxMessagesPerSec = 20
	sendQueue         = 64
	pingEvery         = 20 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 10 * time.Second
	handshakeTimeout  = 10 * time.Second
)

// peer è una connessione WebSocket: un solo writer goroutine, coda limitata.
type peer struct {
	conn        *websocket.Conn
	send        chan Event
	once        sync.Once
	done        chan struct{}
	participant Participant

	windowStart time.Time
	windowCount int
}

func newPeer(conn *websocket.Conn) *peer {
	conn.SetReadLimit(maxMessageBytes)
	return &peer{conn: conn, send: make(chan Event, sendQueue), done: make(chan struct{})}
}

// enqueue non blocca mai: se la coda è piena il peer è troppo lento e viene chiuso (backpressure).
func (p *peer) enqueue(e Event) bool {
	select {
	case <-p.done:
		return false
	default:
	}
	select {
	case p.send <- e:
		return true
	default:
		p.close()
		return false
	}
}

func (p *peer) close() {
	p.once.Do(func() { close(p.done) })
}

// writeLoop è l'unico punto che scrive sul socket; chiude il socket all'uscita.
func (p *peer) writeLoop() {
	ticker := time.NewTicker(pingEvery)
	defer func() {
		ticker.Stop()
		_ = p.conn.Close()
	}()
	for {
		select {
		case e := <-p.send:
			_ = p.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := p.conn.WriteJSON(e); err != nil {
				p.close()
				return
			}
		case <-ticker.C:
			if err := p.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeTimeout)); err != nil {
				p.close()
				return
			}
		case <-p.done:
			// svuota ciò che è già in coda (es. l'evento "closed") prima di chiudere
			for {
				select {
				case e := <-p.send:
					_ = p.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
					_ = p.conn.WriteJSON(e)
				default:
					_ = p.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
					return
				}
			}
		}
	}
}

// read legge il prossimo evento applicando deadline e limite di frequenza.
func (p *peer) read() (Event, error) {
	var e Event
	_ = p.conn.SetReadDeadline(time.Now().Add(readTimeout))
	if err := p.conn.ReadJSON(&e); err != nil {
		return e, err
	}
	now := time.Now()
	if now.Sub(p.windowStart) > time.Second {
		p.windowStart, p.windowCount = now, 0
	}
	p.windowCount++
	if p.windowCount > maxMessagesPerSec {
		return e, errRateLimited
	}
	return e, nil
}

func (p *peer) keepAlive() {
	p.conn.SetPongHandler(func(string) error {
		return p.conn.SetReadDeadline(time.Now().Add(readTimeout))
	})
}
