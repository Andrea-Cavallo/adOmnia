package collab

import (
	"encoding/base64"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// countingStore conta le scritture dei documenti per verificare il coalescing.
type countingStore struct {
	recoveryStore
	documents atomic.Int64
}

func (s *countingStore) saveJSON(key string, value any) error {
	if err := s.recoveryStore.saveJSON(key, value); err != nil {
		return err
	}
	if strings.HasPrefix(key, recoveryDocumentKey) {
		s.documents.Add(1)
	}
	return nil
}

type checkpointWriteProbe struct {
	recoveryStore
	save func() error
}

func (s checkpointWriteProbe) saveJSON(string, any) error { return s.save() }

func TestCountingStoreWaitsForSuccessfulWrite(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	counter := &countingStore{recoveryStore: checkpointWriteProbe{save: func() error {
		close(started)
		<-release
		return nil
	}}}
	done := make(chan error, 1)
	go func() { done <- counter.saveJSON(recoveryDocumentKey+"test", nil) }()
	<-started
	before := counter.count()
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if before != 0 || counter.count() != 1 {
		t.Fatalf("write counts: pending=%d completed=%d", before, counter.count())
	}

	wantErr := errors.New("write failed")
	counter.recoveryStore = checkpointWriteProbe{save: func() error { return wantErr }}
	if err := counter.saveJSON(recoveryDocumentKey+"test", nil); !errors.Is(err, wantErr) {
		t.Fatalf("write error = %v, want %v", err, wantErr)
	}
	if counter.count() != 1 {
		t.Fatalf("failed write was counted: %d", counter.count())
	}
}

// count legge il contatore: il timer di flush scrive da un'altra goroutine.
func (s *countingStore) count() int64 { return s.documents.Load() }

// Un aggiornamento Yjs non deve riscrivere (cifrata, con fsync) l'intera cronologia del documento:
// le scritture sono raggruppate, e l'ultimo aggiornamento arriva comunque a destinazione entro il
// ritardo. RS/A5: il recovery resta coerente senza pesare sull'editor.
//
// The timer is captured instead of waiting in real time: with a real 40 ms delay a slow CI runner fired
// the flush mid-burst (the intended behavior) and the test failed.
func TestDocumentCheckpointsAreCoalesced(t *testing.T) {
	openRecoveryStorage(t)
	var armed []func()
	originalAfterFunc := afterFunc
	afterFunc = func(_ time.Duration, flush func()) *time.Timer {
		armed = append(armed, flush)
		return time.NewTimer(time.Hour)
	}
	t.Cleanup(func() { afterFunc = originalAfterFunc })

	host := NewPersistentManager(nil)
	counter := &countingStore{recoveryStore: host.store}
	host.store = counter
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	id := "project:main.go"
	if err := host.OpenDocument(id, base64.StdEncoding.EncodeToString([]byte("start"))); err != nil {
		t.Fatal(err)
	}
	opened := counter.count()
	if opened != 1 {
		t.Fatalf("l'apertura deve scrivere subito il documento: %d scritture", opened)
	}

	// Ten updates in a row: one timer, and no write until it fires.
	for index := range 10 {
		update := base64.StdEncoding.EncodeToString([]byte{byte(index)})
		if err := host.Document(DocumentMessage{ID: id, Action: "update", Data: update}); err != nil {
			t.Fatal(err)
		}
	}
	if counter.count() != opened {
		t.Fatalf("gli aggiornamenti non sono accodati: %d scritture", counter.count())
	}
	if len(armed) != 1 {
		t.Fatalf("a burst must arm one timer, armed %d", len(armed))
	}

	armed[0]()
	if counter.count() != opened+1 {
		t.Fatalf("the timer must write once when it fires: %d writes", counter.count()-opened)
	}
	var stored storedDocument
	if found, err := counter.loadJSON(recoveryDocumentKey+id, &stored); err != nil || !found {
		t.Fatalf("documento non salvato: found=%v err=%v", found, err)
	}
	if len(stored.Updates) != 11 {
		t.Fatalf("l'ultimo aggiornamento non è stato salvato: %d aggiornamenti", len(stored.Updates))
	}
}

// L'uscita dell'app deve scrivere subito gli aggiornamenti ancora in attesa: chiudere prima del
// timer non deve perdere l'ultima modifica.
func TestShutdownFlushesPendingDocumentUpdates(t *testing.T) {
	openRecoveryStorage(t)
	original := documentCheckpointDelay
	documentCheckpointDelay = time.Hour
	t.Cleanup(func() { documentCheckpointDelay = original })

	host := NewPersistentManager(nil)
	counter := &countingStore{recoveryStore: host.store}
	host.store = counter
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	id := "project:main.go"
	if err := host.OpenDocument(id, base64.StdEncoding.EncodeToString([]byte("start"))); err != nil {
		t.Fatal(err)
	}
	if err := host.Document(DocumentMessage{ID: id, Action: "update", Data: base64.StdEncoding.EncodeToString([]byte("late"))}); err != nil {
		t.Fatal(err)
	}
	host.Shutdown()

	var stored storedDocument
	if found, err := counter.loadJSON(recoveryDocumentKey+id, &stored); err != nil || !found {
		t.Fatalf("documento non salvato: found=%v err=%v", found, err)
	}
	if len(stored.Updates) != 2 {
		t.Fatalf("l'aggiornamento in attesa è andato perso: %d aggiornamenti", len(stored.Updates))
	}
}

// La chiusura del documento cancella subito la copia salvata, senza attendere il timer.
func TestClosingADocumentDropsItsStoredCopyImmediately(t *testing.T) {
	openRecoveryStorage(t)
	original := documentCheckpointDelay
	documentCheckpointDelay = time.Hour
	t.Cleanup(func() { documentCheckpointDelay = original })

	host := NewPersistentManager(nil)
	if _, err := host.Host("127.0.0.1", 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	id := "project:main.go"
	if err := host.OpenDocument(id, base64.StdEncoding.EncodeToString([]byte("start"))); err != nil {
		t.Fatal(err)
	}
	if err := host.Document(DocumentMessage{ID: id, Action: "update", Data: base64.StdEncoding.EncodeToString([]byte("edit"))}); err != nil {
		t.Fatal(err)
	}
	if err := host.Document(DocumentMessage{ID: id, Action: "close"}); err != nil {
		t.Fatal(err)
	}
	var stored storedDocument
	found, err := host.store.loadJSON(recoveryDocumentKey+id, &stored)
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatalf("un documento chiuso resta nel recovery: %+v", stored)
	}
}
