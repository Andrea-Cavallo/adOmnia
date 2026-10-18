package securityintel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"adomnia/internal/netpolicy"
)

const (
	// osvBatchEndpoint è l'API batch di OSV: una richiesta per molti componenti.
	// È la ragione per cui un motore comune conviene: il costo di rete non cresce
	// con il numero di ecosistemi.
	osvBatchEndpoint = "https://api.osv.dev/v1/querybatch"
	// osvQueryEndpoint è l'API per un singolo pacchetto, usata per gli approfondimenti.
	osvQueryEndpoint = "https://api.osv.dev/v1/query"
	// goVulnEndpoint è la Go Vulnerability Database, in formato OSV.
	goVulnEndpoint = "https://vuln.go.dev/index/db.json"

	osvTimeout       = 45 * time.Second
	osvBatchMaxQuery = 1000
	osvMaxAdvisories = 500
)

// OSVSource interroga OSV (e, per l'ecosistema Go, la Go Vulnerability Database).
//
// OSV è il punto di unificazione fra ecosistemi: copre Maven, Go, npm, PyPI e Cargo
// con lo stesso schema, ed è la fonte che rende possibile un solo motore. I risultati
// sono normalizzati in Advisory e fusi con gli alias.
type OSVSource struct {
	// Endpoint permette di puntare a uno specchio aziendale. Con lo specchio, nessuna
	// richiesta esce dal perimetro dell'organizzazione.
	Endpoint string
	// GoEndpoint permette di puntare a una copia locale della Go Vulnerability Database.
	GoEndpoint string
	// HTTPClient è il client usato per le richieste. Se vuoto, il client della politica
	// di rete di adOmnia, che registra e blocca in modalità offline.
	HTTPClient *http.Client
	// Cache è il database locale degli advisory: con una cache calda, la scansione
	// funziona offline.
	Cache *AdvisoryCache
	// status è lo stato dell'ultima consultazione.
	status SourceStatus
}

// Name implementa Source.
func (o *OSVSource) Name() string { return "OSV" }

// Status implementa Source.
func (o *OSVSource) Status() SourceStatus {
	status := o.status
	status.Name = o.Name()
	if o.Endpoint != "" {
		status.Endpoint = o.Endpoint
	} else {
		status.Endpoint = osvBatchEndpoint
	}
	return status
}

// Query implementa Source. Interroga la cache locale prima e la rete solo per ciò che
// manca: in modalità offline la cache è l'unica fonte.
func (o *OSVSource) Query(ctx context.Context, components []Component) (map[string][]Advisory, error) {
	results := map[string][]Advisory{}
	pending := []Component{}
	for _, component := range components {
		if component.Name == "" || component.Version == "" {
			continue
		}
		if o.Cache != nil {
			if cached, found := o.Cache.Get(osvEcosystem(component.Ecosystem), component.Name, component.Version); found {
				results[component.Key()] = cached
				continue
			}
		}
		pending = append(pending, component)
	}
	if len(pending) == 0 {
		o.status = SourceStatus{Name: o.Name(), Offline: true}
		return results, nil
	}

	fetched, err := o.queryBatch(ctx, pending)
	if err != nil {
		o.status = SourceStatus{Name: o.Name(), Endpoint: o.Endpoint, Error: err.Error()}
		// La cache calda resta utilizzabile: una scansione degradata è meglio di nessuna.
		if len(results) > 0 {
			return results, nil
		}
		return nil, err
	}
	for key, advisories := range fetched {
		results[key] = advisories
		if o.Cache != nil {
			component := componentByKey(key, components)
			o.Cache.Put(osvEcosystem(component.Ecosystem), component.Name, component.Version, advisories)
		}
	}
	o.status = SourceStatus{Name: o.Name(), Offline: false}
	return results, nil
}

// osvQuery è una voce della richiesta batch di OSV.
type osvQuery struct {
	Package struct {
		Name      string `json:"name"`
		Ecosystem string `json:"ecosystem"`
	} `json:"package"`
	Version string `json:"version"`
}

// osvBatchRequest è il corpo di POST /v1/querybatch.
type osvBatchRequest struct {
	Queries []osvQuery `json:"queries"`
}

// osvBatchResponse è la risposta di POST /v1/querybatch.
type osvBatchResponse struct {
	Results []struct {
		Vulns []osvEntry `json:"vulns"`
	} `json:"results"`
}

// queryBatch interroga OSV in batch, suddividendo le richieste sotto il limite API.
func (o *OSVSource) queryBatch(ctx context.Context, components []Component) (map[string][]Advisory, error) {
	endpoint := o.Endpoint
	if endpoint == "" {
		endpoint = osvBatchEndpoint
	}
	client := o.HTTPClient
	if client == nil {
		client = netpolicy.Client("vulncheck", osvTimeout)
	}
	results := map[string][]Advisory{}
	for start := 0; start < len(components); start += osvBatchMaxQuery {
		end := start + osvBatchMaxQuery
		if end > len(components) {
			end = len(components)
		}
		batch := components[start:end]
		request := osvBatchRequest{Queries: make([]osvQuery, 0, len(batch))}
		for _, component := range batch {
			var query osvQuery
			query.Package.Name = component.Name
			query.Package.Ecosystem = osvEcosystem(component.Ecosystem)
			query.Version = component.Version
			request.Queries = append(request.Queries, query)
		}
		payload, err := json.Marshal(request)
		if err != nil {
			return nil, fmt.Errorf("encode OSV request: %w", err)
		}
		httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return nil, fmt.Errorf("OSV request: %w", err)
		}
		httpRequest.Header.Set("Content-Type", "application/json")
		response, err := client.Do(httpRequest)
		if err != nil {
			return nil, fmt.Errorf("OSV query: %w", err)
		}
		var decoded osvBatchResponse
		decodeErr := json.NewDecoder(response.Body).Decode(&decoded)
		response.Body.Close()
		if decodeErr != nil {
			return nil, fmt.Errorf("OSV response: %w", decodeErr)
		}
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("OSV query: HTTP %d", response.StatusCode)
		}
		for index, result := range decoded.Results {
			if index >= len(batch) {
				break
			}
			component := batch[index]
			advisories := make([]Advisory, 0, len(result.Vulns))
			for _, entry := range result.Vulns {
				advisory := normalizeOSVEntry(entry, component)
				if advisory.ID != "" {
					advisories = append(advisories, advisory)
				}
			}
			if len(advisories) > 0 {
				results[component.Key()] = advisories
			}
		}
	}
	return results, nil
}

// osvEcosystem traduce l'ecosistema del motore nel nome usato da OSV.
func osvEcosystem(ecosystem Ecosystem) string {
	return string(ecosystem)
}

// componentByKey ritrova il componente di una chiave, per agganciarlo alla cache.
func componentByKey(key string, components []Component) Component {
	for _, component := range components {
		if component.Key() == key {
			return component
		}
	}
	return Component{}
}

// osvEntry è la parte di una voce OSV che il motore interpreta. I campi seguiti da
// "Specific" sono estensioni delle singole banche dati e non fanno parte del formato.
type osvEntry struct {
	ID         string        `json:"id"`
	Aliases    []string      `json:"aliases"`
	Summary    string        `json:"summary"`
	Details    string        `json:"details"`
	Published  string        `json:"published"`
	Modified   string        `json:"modified"`
	Withdrawn  string        `json:"withdrawn"`
	Severity   []osvSeverity `json:"severity"`
	Affected   []osvAffected `json:"affected"`
	References []struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	} `json:"references"`
	DatabaseSpecific struct {
		Severity string `json:"severity"`
		URL      string `json:"url"`
	} `json:"database_specific"`
}

type osvSeverity struct {
	Type  string `json:"type"`
	Score string `json:"score"`
}

type osvAffected struct {
	Package struct {
		Name      string `json:"name"`
		Ecosystem string `json:"ecosystem"`
	} `json:"package"`
	Ranges []struct {
		Type   string `json:"type"`
		Events []struct {
			Introduced   string `json:"introduced"`
			Fixed        string `json:"fixed"`
			LastAffected string `json:"last_affected"`
			Limit        string `json:"limit"`
		} `json:"events"`
	} `json:"ranges"`
	Severity         []osvSeverity `json:"severity"`
	DatabaseSpecific struct {
		Severity string `json:"severity"`
	} `json:"database_specific"`
}

// normalizeOSVEntry traduce una voce OSV nell'Advisory del motore.
//
// Il punto delicato è la severità: OSV esprime i vettori CVSS come stringhe, non come
// punteggi. Il motore calcola il CVSS 3.1 dal vettore e prende dalla fonte il CVSS 4.0,
// che non viene ricalcolato.
func normalizeOSVEntry(entry osvEntry, component Component) Advisory {
	advisory := Advisory{
		ID:        entry.ID,
		Aliases:   entry.Aliases,
		Summary:   entry.Summary,
		Details:   entry.Details,
		Published: entry.Published,
		Modified:  entry.Modified,
		Withdrawn: entry.Withdrawn,
		Sources:   []string{"OSV"},
	}
	severity := Severity{}
	severityItems := append([]osvSeverity(nil), entry.Severity...)
	for _, affected := range entry.Affected {
		severityItems = append(severityItems, affected.Severity...)
	}
	for _, item := range severityItems {
		applyOSVSeverity(&severity, item)
	}
	for _, affected := range entry.Affected {
		if affected.DatabaseSpecific.Severity != "" {
			if class := ParseSeverityString(affected.DatabaseSpecific.Severity); class != "" && severityRank(class) > severityRank(severity.BaseSeverity) {
				severity.BaseSeverity = class
			}
		}
		// Le versioni affette si leggono solo dalle voci che riguardano il pacchetto in
		// esame: una voce OSV può descrivere più pacchetti, ognuno con i propri intervalli.
		if !affectedMatches(affected, component) {
			continue
		}
		for _, rng := range affected.Ranges {
			current := VersionRange{}
			for _, event := range rng.Events {
				switch {
				case event.Introduced != "":
					// Un nuovo "introduced" chiude l'intervallo precedente e ne apre uno.
					if current != (VersionRange{}) {
						advisory.Ranges = append(advisory.Ranges, current)
					}
					current = VersionRange{Introduced: event.Introduced}
				case event.Fixed != "":
					current.Fixed = event.Fixed
					advisory.FixedVersions = appendDistinctString(advisory.FixedVersions, event.Fixed)
					advisory.Ranges = append(advisory.Ranges, current)
					current = VersionRange{}
				case event.LastAffected != "":
					current.LastAffected = event.LastAffected
					advisory.Ranges = append(advisory.Ranges, current)
					current = VersionRange{}
				}
			}
			if current != (VersionRange{}) {
				advisory.Ranges = append(advisory.Ranges, current)
			}
		}
	}
	for _, rng := range advisory.Ranges {
		advisory.VulnerableRanges = appendDistinctString(advisory.VulnerableRanges, rng.String())
	}
	if entry.DatabaseSpecific.Severity != "" {
		if class := ParseSeverityString(entry.DatabaseSpecific.Severity); class != "" {
			severity.BaseSeverity = class
		}
	}
	for _, reference := range entry.References {
		if reference.URL != "" {
			advisory.References = appendDistinctString(advisory.References, reference.URL)
		}
	}
	severity.NormalizeSeverity()
	advisory.Severity = severity
	return advisory
}

// affectedMatches dice se una voce affected di OSV riguarda il componente in esame.
// Confronta sia il pacchetto sia l'ecosistema: una voce può descrivere lo stesso nome
// in due ecosistemi diversi con intervalli diversi.
func affectedMatches(affected osvAffected, component Component) bool {
	if affected.Package.Ecosystem != "" && component.Ecosystem != "" && affected.Package.Ecosystem != osvEcosystem(component.Ecosystem) {
		return false
	}
	if affected.Package.Name == "" {
		return true
	}
	return affected.Package.Name == component.Name
}

// applyOSVSeverity interpreta una coppia tipo/punteggio di OSV: il "score" di OSV è un
// vettore CVSS, ma alcune fonti ci mettono un numero già calcolato.
func applyOSVSeverity(severity *Severity, item osvSeverity) {
	score := strings.TrimSpace(item.Score)
	if score == "" {
		return
	}
	vector := ""
	if strings.HasPrefix(score, "CVSS:") {
		vector = score
	} else if numeric, ok := parseScore(score); ok {
		severity.CVSS31Score = numeric
		severity.ScoreSource = "osv"
		return
	}
	switch {
	case strings.HasPrefix(vector, "CVSS:4.0"):
		severity.CVSS40Vector = vector
	case strings.HasPrefix(vector, "CVSS:3"):
		severity.CVSS31Vector = vector
	}
}

// parseScore legge un punteggio numerico già calcolato da una fonte.
func parseScore(value string) (float64, bool) {
	var score float64
	_, err := fmt.Sscanf(value, "%g", &score)
	if err != nil {
		return 0, false
	}
	if score < 0 || score > 10 {
		return 0, false
	}
	return score, true
}

// appendDistinctString aggiunge un valore non vuoto e non già presente.
func appendDistinctString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
