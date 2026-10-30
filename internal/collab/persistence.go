package collab

import (
	"encoding/base64"
	"encoding/json/v2"
	"errors"
	"fmt"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
	"github.com/Andrea-Cavallo/adOmnia/internal/vault"
)

const (
	recoveryVersion      = 1
	recoverySessionKey   = "session"
	recoveryReplayKey    = "replay"
	recoveryInboxKey     = "inbox"
	recoveryDocumentKey  = "document:"
	recoveryBaselineKey  = "baseline:"
	maxRecoveryAge       = 24 * time.Hour
	maxRecoveryAuxiliary = 16 << 20
)

type storedResumeTicket struct {
	Token       string
	Participant Participant
	Expires     time.Time
}

type recoverySession struct {
	Version        int
	SavedAt        time.Time
	Mode           string
	SessionID      string
	Self           Participant
	Seq            uint64
	Address        string
	Fingerprint    string
	CertificatePEM string
	PrivateKeyPEM  string
	Participants   []Participant
	Documents      []string
	Project        *ProjectInfo
	ProjectRoot    string
	Resumes        []storedResumeTicket
	ResumeToken    string
	GuestInvite    parsedInvite
	LastSeq        uint64
	ReplayBytes    int
	ReplayFloor    uint64
	ReplayLatest   uint64
}

type storedDocument struct {
	ID      string
	Updates []string
	Bytes   int
}

type boltRecoveryStore struct{}

// recoveryStore è la persistenza dei checkpoint: bbolt cifrato in produzione, un finto store nei
// test. Un'interfaccia permette di contare le scritture (il coalescing dei documenti).
type recoveryStore interface {
	read(key string) (string, bool, error)
	write(key, value string) error
	saveJSON(key string, value any) error
	loadJSON(key string, target any) (bool, error)
	clear() error
}

func (boltRecoveryStore) read(key string) (string, bool, error) {
	data, err := storage.Get("collab", key)
	if err != nil || len(data) == 0 {
		return "", false, err
	}
	plain, err := vault.Open(string(data))
	if err != nil {
		return "", false, fmt.Errorf("apri recovery %s: %w", key, err)
	}
	return plain, true, nil
}

func (boltRecoveryStore) write(key, value string) error {
	sealed, _, err := vault.Seal(value)
	if err != nil {
		return fmt.Errorf("cifra recovery %s: %w", key, err)
	}
	return storage.Put("collab", key, []byte(sealed))
}

func (s boltRecoveryStore) saveJSON(key string, value any) error {
	data, err := jsonutil.Marshal(value)
	if err != nil {
		return fmt.Errorf("serializza recovery %s: %w", key, err)
	}
	return s.write(key, string(data))
}

func (s boltRecoveryStore) loadJSON(key string, target any) (bool, error) {
	plain, found, err := s.read(key)
	if err != nil || !found {
		return found, err
	}
	if err := json.Unmarshal([]byte(plain), target); err != nil {
		return true, fmt.Errorf("decodifica recovery %s: %w", key, err)
	}
	return true, nil
}

func (boltRecoveryStore) clear() error {
	keys, err := storage.List("collab", "")
	if err != nil {
		return err
	}
	for _, key := range keys {
		if err := storage.Delete("collab", key); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) snapshotLocked() recoverySession {
	s := recoverySession{
		Version:        recoveryVersion,
		SavedAt:        time.Now().UTC(),
		Mode:           m.mode,
		SessionID:      m.sessionID,
		Self:           m.self,
		Seq:            m.seq,
		Address:        m.address,
		Fingerprint:    m.fp,
		CertificatePEM: m.certPEM,
		PrivateKeyPEM:  m.keyPEM,
		Participants:   append([]Participant(nil), m.participants...),
		Documents:      m.documentIDsLocked(),
		Project:        m.projectInfo,
		ResumeToken:    m.resumeToken,
		LastSeq:        m.lastSeq,
		ReplayBytes:    m.replayBytes,
		ReplayFloor:    m.replayFloor,
		GuestInvite: parsedInvite{
			Address:     m.guestInvite.Address,
			Fingerprint: m.guestInvite.Fingerprint,
		},
	}
	if m.project != nil {
		s.ProjectRoot = m.project.root
	}
	if len(m.replay) > 0 {
		s.ReplayLatest = m.replay[len(m.replay)-1].Seq
	}
	for token, ticket := range m.resumes {
		s.Resumes = append(s.Resumes, storedResumeTicket{Token: token, Participant: ticket.participant, Expires: ticket.expires})
	}
	return s
}

func (m *Manager) reportRecovery(err error) {
	if err == nil {
		return
	}
	m.mu.Lock()
	m.recoveryError = "recovery non salvato: " + err.Error()
	m.mu.Unlock()
}

func (m *Manager) checkpointSession() {
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	m.mu.Lock()
	store, snapshot := m.store, m.snapshotLocked()
	m.mu.Unlock()
	if store == nil || snapshot.Mode == ModeIdle {
		return
	}
	m.reportRecovery(store.saveJSON(recoverySessionKey, snapshot))
}

func (m *Manager) checkpointReplay() {
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	m.mu.Lock()
	store := m.store
	replay := append([]Event(nil), m.replay...)
	m.mu.Unlock()
	if store != nil {
		m.reportRecovery(store.saveJSON(recoveryReplayKey, replay))
	}
}

func (m *Manager) checkpointDocument(id string) {
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	m.mu.Lock()
	store := m.store
	room := m.documents[id]
	var document *storedDocument
	if room != nil {
		document = &storedDocument{ID: id, Updates: append([]string(nil), room.updates...), Bytes: room.bytes}
	}
	m.mu.Unlock()
	if store == nil {
		return
	}
	if document == nil {
		m.reportRecovery(storage.Delete("collab", recoveryDocumentKey+id))
		return
	}
	m.reportRecovery(store.saveJSON(recoveryDocumentKey+id, document))
}

// documentCheckpointDelay raggruppa gli aggiornamenti di un documento. La cronologia Yjs è un blob
// che cresce: riscriverla (cifrata, con fsync su bbolt) a ogni aggiornamento significherebbe
// scrivere l'intero documento per ogni battuta. Le scritture "strutturali" della sessione restano
// immediate: cambiano di rado e sono piccole.
var documentCheckpointDelay = 400 * time.Millisecond

// afterFunc arma il timer del checkpoint; i test lo sostituiscono per non dipendere dalla velocità della macchina.
var afterFunc = time.AfterFunc

// scheduleDocumentCheckpoint accoda il salvataggio di un documento aggiornato: il timer scrive una
// sola volta tutti i documenti in attesa, quindi anche l'ultimo aggiornamento arriva a destinazione
// entro il ritardo.
func (m *Manager) scheduleDocumentCheckpoint(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.store == nil {
		return
	}
	if m.pendingDocs == nil {
		m.pendingDocs = map[string]bool{}
	}
	m.pendingDocs[id] = true
	if m.docFlush == nil {
		m.docFlush = afterFunc(documentCheckpointDelay, m.flushDocumentCheckpoints)
	}
}

// flushDocumentCheckpoints scrive i documenti in attesa (timer, chiusura o uscita).
func (m *Manager) flushDocumentCheckpoints() {
	m.mu.Lock()
	pending := m.pendingDocs
	m.pendingDocs = nil
	if m.docFlush != nil {
		m.docFlush.Stop()
		m.docFlush = nil
	}
	m.mu.Unlock()
	for id := range pending {
		m.checkpointDocument(id)
	}
}

// checkpointDocumentNow scrive subito un documento e lo toglie dagli aggiornamenti in attesa:
// apertura, chiusura ed eventi che devono essere durevoli prima di rispondere.
func (m *Manager) checkpointDocumentNow(id string) {
	m.mu.Lock()
	delete(m.pendingDocs, id)
	m.mu.Unlock()
	m.checkpointDocument(id)
}

// stopDocumentCheckpoints scarica gli aggiornamenti in attesa e ferma il timer: chiamarla sempre
// prima di scartare lo stato (Stop/reset).
func (m *Manager) stopDocumentCheckpoints() {
	m.flushDocumentCheckpoints()
}

func (m *Manager) clearRecovery() {
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	if m.store != nil {
		m.reportRecovery(m.store.clear())
	}
}

// SaveInbox preserves received, not-yet-accepted shares as an encrypted backend payload.
func (m *Manager) SaveInbox(data string) error {
	if len(data) > maxRecoveryAuxiliary {
		return errors.New("inbox troppo grande per il recovery")
	}
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	m.mu.Lock()
	active := m.mode == ModeHost || m.mode == ModeGuest
	m.mu.Unlock()
	if !active {
		return errors.New("nessuna sessione attiva per il recovery dell’inbox")
	}
	if m.store == nil {
		return nil
	}
	return m.store.write(recoveryInboxKey, data)
}

// Inbox returns the encrypted backend copy of the pending received shares.
func (m *Manager) Inbox() (string, error) {
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	if m.store == nil {
		return "[]", nil
	}
	data, found, err := m.store.read(recoveryInboxKey)
	if err != nil {
		return "", err
	}
	if !found {
		return "[]", nil
	}
	return data, nil
}

// SaveDocumentBaseline preserves a guest Yjs state, including unsent local updates.
func (m *Manager) SaveDocumentBaseline(id, data string) error {
	if !validDocumentID(id) {
		return errors.New("ID documento non valido")
	}
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(decoded) == 0 || len(decoded) > maxDocumentHistory {
		return errors.New("baseline documento non valida o troppo grande")
	}
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	m.mu.Lock()
	guest := m.mode == ModeGuest
	m.mu.Unlock()
	if !guest {
		return errors.New("la baseline può essere salvata solo in una sessione guest")
	}
	if m.store == nil {
		return nil
	}
	return m.store.write(recoveryBaselineKey+id, data)
}

// DocumentBaseline returns a guest Yjs state saved before a disconnect or restart.
func (m *Manager) DocumentBaseline(id string) (string, error) {
	if !validDocumentID(id) {
		return "", errors.New("ID documento non valido")
	}
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	if m.store == nil {
		return "", nil
	}
	data, found, err := m.store.read(recoveryBaselineKey + id)
	if err != nil || !found {
		return "", err
	}
	return data, nil
}

// DeleteDocumentBaseline removes a recovered guest state after explicit closure.
func (m *Manager) DeleteDocumentBaseline(id string) error {
	if !validDocumentID(id) {
		return errors.New("ID documento non valido")
	}
	m.checkpointMu.Lock()
	defer m.checkpointMu.Unlock()
	if m.store == nil {
		return nil
	}
	return storage.Delete("collab", recoveryBaselineKey+id)
}
