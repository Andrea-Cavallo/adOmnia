package otlp

import (
	"context"
	"sync"
	"time"

	"adomnia/internal/nettools"
)

// The map refreshes every 2 s; netstat/tasklist run at most once per socketsTTL.
const socketsTTL = 5 * time.Second

var sockets struct {
	sync.Mutex
	at        time.Time
	conns     []Conn
	listeners []Listener
	ok        bool
}

// liveSockets returns the machine's established connections and listening ports (cached).
func liveSockets(ctx context.Context) ([]Conn, []Listener, bool) {
	sockets.Lock()
	defer sockets.Unlock()
	if time.Since(sockets.at) < socketsTTL {
		return sockets.conns, sockets.listeners, sockets.ok
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	sockets.at, sockets.ok = time.Now(), false
	established, err := nettools.ListEstablished(ctx)
	if err != nil {
		return nil, nil, false
	}
	listening, err := nettools.ListListeningPorts(ctx)
	if err != nil {
		return nil, nil, false
	}
	sockets.conns = make([]Conn, 0, len(established))
	for _, c := range established {
		sockets.conns = append(sockets.conns, Conn{PID: c.PID, RemotePort: c.RemotePort})
	}
	sockets.listeners = make([]Listener, 0, len(listening))
	for _, l := range listening {
		sockets.listeners = append(sockets.listeners, Listener{Port: l.Port, PID: l.PID})
	}
	sockets.ok = true
	return sockets.conns, sockets.listeners, true
}
