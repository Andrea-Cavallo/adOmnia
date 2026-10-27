package securityintel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// DefaultCacheTTL è la durata di validità di una voce del database locale. Passato
// questo tempo la voce va aggiornata se c'è rete; in sua assenza resta utilizzabile,
// perché una scansione con dati un po' vecchi è meglio di nessuna scansione.
const DefaultCacheTTL = 7 * 24 * time.Hour

// cacheFileName è il file del database locale. Un solo file JSON portabile: il
// database va ispezionabile, esportabile e sostituibile a mano, come vuole il
// local-first di adOmnia.
const cacheFileName = "advisories.json"

// cacheEntry è una voce del database locale, con la data in cui è stata aggiornata.
type cacheEntry struct {
	Ecosystem  string     `json:"ecosystem"`
	Package    string     `json:"package"`
	Version    string     `json:"version"`
	Advisories []Advisory `json:"advisories"`
	FetchedAt  string     `json:"fetchedAt"`
}

// AdvisoryCache è il database locale degli advisory.
//
// Risolve due problemi insieme: evita di ripetere le stesse richieste a ogni scansione
// e permette l'analisi offline quando la rete non c'è o non è permessa. Non memorizza
// mai nulla di relativo al progetto: solo coordinate e advisory pubblici.
type AdvisoryCache struct {
	// Dir è la cartella del database locale. Se vuota, la cache è disabilitata.
	Dir string
	// TTL è la validità di una voce. Zero usa DefaultCacheTTL.
	TTL time.Duration
	// MaxEntries limita la dimensione in memoria del database.
	MaxEntries int

	mu      sync.RWMutex
	entries map[string]cacheEntry
	loaded  bool
	// stale indica che il database su disco non è stato leggibile o scrivibile.
	stale bool
}

// NewAdvisoryCache crea una cache nella cartella indicata.
func NewAdvisoryCache(dir string) *AdvisoryCache {
	return &AdvisoryCache{Dir: dir, TTL: DefaultCacheTTL, MaxEntries: 50_000}
}

// Get ritorna gli advisory memorizzati per un componente. Il secondo valore dice se
// la voce esiste ed è ancora valida.
func (c *AdvisoryCache) Get(ecosystem, name, version string) ([]Advisory, bool) {
	if c == nil || c.Dir == "" {
		return nil, false
	}
	c.load()
	key := cacheKey(ecosystem, name, version)
	c.mu.RLock()
	entry, found := c.entries[key]
	c.mu.RUnlock()
	if !found {
		return nil, false
	}
	if c.expired(entry) {
		return nil, false
	}
	return entry.Advisories, true
}

// Put memorizza gli advisory di un componente e aggiorna il database su disco.
func (c *AdvisoryCache) Put(ecosystem, name, version string, advisories []Advisory) {
	if c == nil || c.Dir == "" {
		return
	}
	c.load()
	key := cacheKey(ecosystem, name, version)
	c.mu.Lock()
	if c.entries == nil {
		c.entries = map[string]cacheEntry{}
	}
	if len(c.entries) >= c.MaxEntries {
		c.evictOldestLocked()
	}
	c.entries[key] = cacheEntry{
		Ecosystem:  ecosystem,
		Package:    name,
		Version:    version,
		Advisories: advisories,
		FetchedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	c.mu.Unlock()
	c.save()
}

// ExpiredFor dice se la voce di un componente è scaduta, quindi da aggiornare.
func (c *AdvisoryCache) ExpiredFor(ecosystem, name, version string) bool {
	if c == nil || c.Dir == "" {
		return true
	}
	c.load()
	c.mu.RLock()
	entry, found := c.entries[cacheKey(ecosystem, name, version)]
	c.mu.RUnlock()
	return !found || c.expired(entry)
}

// Count è il numero di voci memorizzate.
func (c *AdvisoryCache) Count() int {
	if c == nil {
		return 0
	}
	c.load()
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}

// LastUpdated è la data più recente fra le voci memorizzate: è la data del database
// locale che la dashboard mostra per far capire quanto sono freschi i risultati.
func (c *AdvisoryCache) LastUpdated() string {
	if c == nil {
		return ""
	}
	c.load()
	c.mu.RLock()
	defer c.mu.RUnlock()
	newest := ""
	for _, entry := range c.entries {
		if entry.FetchedAt > newest {
			newest = entry.FetchedAt
		}
	}
	return newest
}

// expired dice se una voce ha superato il TTL. Una voce scaduta è comunque
// utilizzabile quando la rete non risponde: lo decide il chiamante, non la cache.
func (c *AdvisoryCache) expired(entry cacheEntry) bool {
	ttl := c.TTL
	if ttl <= 0 {
		ttl = DefaultCacheTTL
	}
	fetched, err := time.Parse(time.RFC3339, entry.FetchedAt)
	if err != nil {
		return true
	}
	return time.Since(fetched) > ttl
}

// load legge il database da disco una sola volta.
func (c *AdvisoryCache) load() {
	c.mu.RLock()
	ready := c.loaded
	c.mu.RUnlock()
	if ready {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.loaded {
		return
	}
	c.loaded = true
	c.entries = map[string]cacheEntry{}
	data, err := os.ReadFile(c.path())
	if err != nil {
		return // nessun database locale: la cache parte vuota
	}
	var stored map[string]cacheEntry
	if err := json.Unmarshal(data, &stored); err != nil {
		c.stale = true
		return // database corrotto: si riparte vuoto invece di fallire la scansione
	}
	for key, entry := range stored {
		c.entries[key] = entry
	}
}

// save scrive il database su disco. Un errore di scrittura non deve fermare la
// scansione: degrada in "nessun caching", non in "nessun risultato".
func (c *AdvisoryCache) save() {
	if c.Dir == "" {
		return
	}
	c.mu.RLock()
	snapshot := make(map[string]cacheEntry, len(c.entries))
	for key, entry := range c.entries {
		snapshot[key] = entry
	}
	c.mu.RUnlock()
	data, err := jsonutil.Marshal(snapshot, jsontext.WithIndent("  "))
	if err != nil {
		return
	}
	if err := os.MkdirAll(c.Dir, 0o755); err != nil {
		c.mu.Lock()
		c.stale = true
		c.mu.Unlock()
		return
	}
	if err := os.WriteFile(c.path(), data, 0o644); err != nil {
		c.mu.Lock()
		c.stale = true
		c.mu.Unlock()
	}
}

// evictOldestLocked libera spazio eliminando le voci più vecchie. Deve essere chiamata
// con il lock di scrittura già preso.
func (c *AdvisoryCache) evictOldestLocked() {
	oldest := ""
	for key, entry := range c.entries {
		if oldest == "" || entry.FetchedAt < c.entries[oldest].FetchedAt {
			oldest = key
		}
	}
	if oldest != "" {
		delete(c.entries, oldest)
	}
}

// path è il file del database locale.
func (c *AdvisoryCache) path() string {
	return filepath.Join(c.Dir, cacheFileName)
}

// cacheKey è l'identità di una voce del database. L'hash rende la chiave indipendente
// da separatori e maiuscole dei nomi dei pacchetti.
func cacheKey(ecosystem, name, version string) string {
	sum := sha256.Sum256([]byte(ecosystem + "\x00" + name + "\x00" + version))
	return hex.EncodeToString(sum[:16])
}
