package netpolicy

import (
	"sync"
	"time"
)

// Esiti di una connessione nel registro.
const (
	OutcomeOK      = "ok"
	OutcomeError   = "error"
	OutcomeBlocked = "blocked"
)

// Event è una connessione che adOmnia ha aperto (o bloccato) da sola. Niente query string,
// header o corpo: solo quanto serve a capire chi ha parlato con chi.
type Event struct {
	Time       time.Time `json:"time"`
	Category   string    `json:"category"`
	Method     string    `json:"method,omitempty"`
	Host       string    `json:"host"`
	Path       string    `json:"path,omitempty"`
	Status     int       `json:"status,omitempty"`
	Outcome    string    `json:"outcome"`
	Detail     string    `json:"detail,omitempty"`
	DurationMs int64     `json:"durationMs,omitempty"`
}

// ponytail: ring buffer in memoria, si perde alla chiusura; un log su disco solo se richiesto.
const activityLimit = 500

var (
	activityMu sync.Mutex
	activity   []Event
)

// Record annota una connessione; le più vecchie oltre il limite vengono scartate.
func Record(event Event) {
	if event.Time.IsZero() {
		event.Time = time.Now()
	}
	activityMu.Lock()
	defer activityMu.Unlock()
	activity = append(activity, event)
	if len(activity) > activityLimit {
		activity = append([]Event(nil), activity[len(activity)-activityLimit:]...)
	}
}

// Activity restituisce le connessioni annotate, dalla più recente.
func Activity() []Event {
	activityMu.Lock()
	defer activityMu.Unlock()
	result := make([]Event, len(activity))
	for index, event := range activity {
		result[len(activity)-1-index] = event
	}
	return result
}

// ClearActivity svuota il registro.
func ClearActivity() {
	activityMu.Lock()
	defer activityMu.Unlock()
	activity = nil
}
