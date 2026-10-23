// Package startup osserva l'avvio di un servizio: righe di output con il loro istante, prima porta
// in ascolto, prime connessioni verso database e broker, prontezza HTTP. È indipendente dal linguaggio.
package startup

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"sort"
	"strconv"
	"sync"
	"time"

	"adomnia/internal/nettools"
)

// Event è un momento dell'avvio, in millisecondi dall'avvio del processo.
type Event struct {
	AtMs   float64 `json:"atMs"`
	Kind   string  `json:"kind"` // output | listen | connect | ready | exit | timeout
	Detail string  `json:"detail"`
}

// Timeline è l'avvio osservato.
type Timeline struct {
	Events  []Event  `json:"events"`
	Lines   []string `json:"-"` // output grezzo, per i parser del linguaggio
	ReadyMs float64  `json:"readyMs"`
	Ready   bool     `json:"ready"`
	Port    int      `json:"port,omitzero"`
}

// Options: Health è un path HTTP ("/healthz") da attendere oltre alla porta; Timeout il limite.
type Options struct {
	Health  string
	Timeout time.Duration
	Poll    time.Duration
}

// Porte note dei servizi a cui un'applicazione si collega all'avvio.
var knownPorts = map[int]string{
	5432: "PostgreSQL", 3306: "MySQL", 1433: "SQL Server", 1521: "Oracle", 6379: "Redis", 27017: "MongoDB",
	9092: "Kafka", 59092: "Kafka", 4222: "NATS", 5672: "RabbitMQ", 9042: "Cassandra", 9200: "Elasticsearch",
	11211: "Memcached", 2379: "etcd", 8500: "Consul",
}

// Kind dà un nome alla porta remota di una connessione ("PostgreSQL :5432").
func Kind(port int) string {
	if name, ok := knownPorts[port]; ok {
		return fmt.Sprintf("%s :%d", name, port)
	}
	return ":" + strconv.Itoa(port)
}

// Observe avvia command e lo osserva finché è pronto, termina o scade il tempo; poi lo ferma con stop.
func Observe(ctx context.Context, command *exec.Cmd, options Options, stop func(*exec.Cmd)) (Timeline, error) {
	running, err := Start(ctx, command, options)
	if err != nil {
		return Timeline{}, err
	}
	stop(command)
	return running.Finish(5 * time.Second), nil
}

// Running è un processo avviato da Start, ancora osservato (output ed eventi continuano).
type Running struct {
	Command  *exec.Cmd
	Started  time.Time
	Exited   chan struct{}
	mu       *sync.Mutex
	timeline *Timeline
	readDone chan struct{}
}

// Add registra un evento all'istante attuale.
func (r *Running) Add(kind, detail string) {
	r.mu.Lock()
	r.timeline.Events = append(r.timeline.Events, Event{AtMs: float64(time.Since(r.Started).Microseconds()) / 1000, Kind: kind, Detail: detail})
	r.mu.Unlock()
}

// Since: millisecondi dall'avvio.
func (r *Running) Since() float64 { return float64(time.Since(r.Started).Microseconds()) / 1000 }

// Port è la porta in ascolto vista all'avvio (0 se nessuna).
func (r *Running) Port() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.timeline.Port
}

// Snapshot è la timeline fin qui, senza attendere nulla.
func (r *Running) Snapshot() Timeline {
	r.mu.Lock()
	defer r.mu.Unlock()
	copied := *r.timeline
	copied.Events = append([]Event(nil), r.timeline.Events...)
	return copied
}

// Finish attende l'uscita (al massimo wait) e la fine dell'output, e restituisce la timeline ordinata.
func (r *Running) Finish(wait time.Duration) Timeline {
	select {
	case <-r.Exited:
	case <-time.After(wait):
	}
	select {
	case <-r.readDone:
	case <-time.After(2 * time.Second):
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	sort.SliceStable(r.timeline.Events, func(i, j int) bool { return r.timeline.Events[i].AtMs < r.timeline.Events[j].AtMs })
	return *r.timeline
}

// Start avvia command e attende che sia pronto (o termini, o scada il tempo); il processo resta vivo.
func Start(ctx context.Context, command *exec.Cmd, options Options) (*Running, error) {
	if options.Timeout <= 0 {
		options.Timeout = 30 * time.Second
	}
	if options.Poll <= 0 {
		options.Poll = 100 * time.Millisecond
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	command.Stderr = command.Stdout
	var mu sync.Mutex
	timeline := Timeline{}
	start := time.Now()
	since := func() float64 { return float64(time.Since(start).Microseconds()) / 1000 }
	add := func(kind, detail string) {
		mu.Lock()
		timeline.Events = append(timeline.Events, Event{AtMs: since(), Kind: kind, Detail: detail})
		mu.Unlock()
	}
	if err := command.Start(); err != nil {
		return nil, err
	}
	pid := command.Process.Pid
	exited := make(chan struct{})
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			timeline.Lines = append(timeline.Lines, line)
			mu.Unlock()
			add("output", line)
		}
		_, _ = io.Copy(io.Discard, stdout)
	}()
	go func() {
		_ = command.Wait()
		close(exited)
	}()
	deadline := time.NewTimer(options.Timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(options.Poll)
	defer ticker.Stop()
	seenRemote := map[int]bool{}
	client := &http.Client{Timeout: time.Second}
loop:
	for {
		select {
		case <-ctx.Done():
			add("timeout", "cancelled")
			break loop
		case <-exited:
			add("exit", "the process exited before it was ready")
			break loop
		case <-deadline.C:
			add("timeout", fmt.Sprintf("not ready after %s", options.Timeout))
			break loop
		case <-ticker.C:
			poll, cancel := context.WithTimeout(ctx, 3*time.Second)
			if conns, err := nettools.ListEstablished(poll); err == nil {
				for _, conn := range conns {
					if conn.PID == pid && !seenRemote[conn.RemotePort] {
						seenRemote[conn.RemotePort] = true
						add("connect", Kind(conn.RemotePort))
					}
				}
			}
			if timeline.Port == 0 {
				if ports, err := nettools.ListListeningPorts(poll); err == nil {
					for _, port := range ports {
						if port.PID == pid {
							timeline.Port = port.Port
							add("listen", ":"+strconv.Itoa(port.Port))
							break
						}
					}
				}
			}
			cancel()
			if timeline.Port != 0 {
				if options.Health == "" {
					timeline.Ready, timeline.ReadyMs = true, since()
					add("ready", "port open")
					break loop
				}
				response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d%s", timeline.Port, options.Health))
				if err == nil {
					_ = response.Body.Close()
					if response.StatusCode < 500 {
						timeline.Ready, timeline.ReadyMs = true, since()
						add("ready", fmt.Sprintf("%s answered %d", options.Health, response.StatusCode))
						break loop
					}
				}
			}
		}
	}
	return &Running{Command: command, Started: start, Exited: exited, mu: &mu, timeline: &timeline, readDone: readDone}, nil
}
