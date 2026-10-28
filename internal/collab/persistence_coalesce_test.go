package collab

import (
	"encoding/base64"
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
	if strings.HasPrefix(key, recoveryDocumentKey) {
		s.documents.Add(1)
	}
	return s.recoveryStore.saveJSON(key, value)
}

// count legge il contatore: il timer di flush scrive da un'altra goroutine.
func (s *countingStore) count() int64 { return s.documents.Load() }

// Un aggiornamento Yjs non deve riscrivere (cifrata, con fsync) l'intera cronologia del documento:
// le scritture sono raggruppate, e l'ultimo aggiornamento arriva comunque a destinazione entro il
// ritardo. RS/A5: il recovery resta coerente senza pesare sull'editor.
func TestDocumentCheckpointsAreCoalesced(t *testing.T) {
	openRecoveryStorage(t)
	original := documentCheckpointDelay
	documentCheckpointDelay = 40 * time.Millisecond
	t.Cleanup(func() { documentCheckpointDelay = original })

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

	// Dieci aggiornamenti ravvicinati: una sola scrittura dopo il ritardo, non dieci.
	for index := range 10 {
		update := base64.StdEncoding.EncodeToString([]byte{byte(index)})
		if err := host.Document(DocumentMessage{ID: id, Action: "update", Data: update}); err != nil {
			t.Fatal(err)
		}
	}
	if counter.count() != opened {
		t.Fatalf("gli aggiornamenti non sono accodati: %d scritture", counter.count())
	}
	waitFor(t, func() bool { return counter.count() == opened+1 })

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

// waitFor attende una condizione con un limite: i test del coalescing dipendono dal timer.
func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condizione non raggiunta entro il limite")
}
