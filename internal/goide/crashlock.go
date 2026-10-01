package goide

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	runtimeLockFile   = "runtime.lock"
	heartbeatInterval = 10 * time.Second
	// Un lock senza heartbeat da più di tre intervalli appartiene a un processo morto o bloccato.
	staleHeartbeatAfter = 3 * heartbeatInterval
)

// CrashStatus dice se l'avvio precedente di adOmnia si è chiuso in modo anomalo.
type CrashStatus struct {
	PreviousCrashed bool      `json:"previousCrashed"`
	LastHeartbeat   time.Time `json:"lastHeartbeat,omitempty"`
	StartedAt       time.Time `json:"startedAt,omitempty"`
}

type runtimeLockInfo struct {
	// Instance è casuale per ogni avvio: un PID riutilizzato dal sistema non può sembrare la stessa istanza.
	Instance  string    `json:"instance"`
	PID       int       `json:"pid"`
	StartedAt time.Time `json:"startedAt"`
	Heartbeat time.Time `json:"heartbeat"`
}

// RuntimeLock segna che adOmnia è in esecuzione; una chiusura pulita lo rimuove.
type RuntimeLock struct {
	path    string
	info    runtimeLockInfo
	stop    chan struct{}
	release sync.Once
	mu      sync.Mutex
}

// AcquireRuntimeLock legge il lock lasciato dall'avvio precedente e scrive quello nuovo.
// Il crash si deduce dall'heartbeat fermo, non dal PID: un PID può essere riassegnato a un altro processo.
func AcquireRuntimeLock(directory string, now func() time.Time) (*RuntimeLock, CrashStatus, error) {
	if now == nil {
		now = time.Now
	}
	path := filepath.Join(directory, runtimeLockFile)
	status := CrashStatus{}
	if data, err := os.ReadFile(path); err == nil {
		var previous runtimeLockInfo
		if json.Unmarshal(data, &previous) == nil && !previous.Heartbeat.IsZero() && now().Sub(previous.Heartbeat) > staleHeartbeatAfter {
			status = CrashStatus{PreviousCrashed: true, LastHeartbeat: previous.Heartbeat, StartedAt: previous.StartedAt}
		} else if json.Unmarshal(data, &previous) != nil {
			// Un lock illeggibile è a sua volta il segno di una chiusura durante la scrittura.
			status = CrashStatus{PreviousCrashed: true}
		}
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, status, fmt.Errorf("cartella del runtime lock non disponibile: %w", err)
	}
	instance := make([]byte, 12)
	if _, err := rand.Read(instance); err != nil {
		return nil, status, err
	}
	started := now().UTC()
	lock := &RuntimeLock{path: path, info: runtimeLockInfo{Instance: hex.EncodeToString(instance), PID: os.Getpid(), StartedAt: started, Heartbeat: started}, stop: make(chan struct{})}
	if err := lock.write(); err != nil {
		return nil, status, err
	}
	go lock.beat(now)
	return lock, status, nil
}

func (l *RuntimeLock) write() error {
	l.mu.Lock()
	data, err := json.Marshal(l.info)
	l.mu.Unlock()
	if err != nil {
		return err
	}
	return atomicWriteFile(l.path, data, 0o600)
}

func (l *RuntimeLock) beat(now func() time.Time) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-ticker.C:
			l.mu.Lock()
			l.info.Heartbeat = now().UTC()
			l.mu.Unlock()
			_ = l.write()
		}
	}
}

// Release segna la chiusura pulita: il lock sparisce e il prossimo avvio non vede un crash.
func (l *RuntimeLock) Release() {
	if l == nil {
		return
	}
	l.release.Do(func() {
		close(l.stop)
		_ = os.Remove(l.path)
	})
}

// SetCrashStatus registra l'esito del controllo all'avvio.
func (s *Service) SetCrashStatus(status CrashStatus) {
	s.crashMu.Lock()
	s.crash = status
	s.crashMu.Unlock()
}

// CrashRecoveryStatus dice alla UI se proporre il ripristino dopo un crash.
func (s *Service) CrashRecoveryStatus() CrashStatus {
	s.crashMu.Lock()
	defer s.crashMu.Unlock()
	return s.crash
}

// AcknowledgeCrash chiude la proposta di ripristino: l'utente ha scelto cosa recuperare.
func (s *Service) AcknowledgeCrash() {
	s.SetCrashStatus(CrashStatus{})
}
