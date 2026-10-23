package securityintel

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"adomnia/internal/netpolicy"
)

const (
	// epssEndpoint espone la probabilità stimata di sfruttamento di FIRST.
	epssEndpoint = "https://api.first.org/data/v1/epss"
	// kevEndpoint è il catalogo CISA Known Exploited Vulnerabilities.
	kevEndpoint = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

	enrichTimeout = 30 * time.Second
	// epssBatchLimit è il numero massimo di CVE per richiesta EPSS.
	epssBatchLimit = 100
)

// EPSSSource arricchisce gli advisory con la probabilità stimata di sfruttamento
// entro 30 giorni (Exploit Prediction Scoring System, FIRST).
//
// La EPSS è una probabilità, non una gravità: un 6.8 con EPSS 70% è più urgente di un
// 9.8 con EPSS 0.2%. Il motore la tiene separata dal CVSS e la combina solo nel risk
// model, con regole leggibili.
type EPSSSource struct {
	// Endpoint permette di puntare a uno specchio aziendale.
	Endpoint   string
	HTTPClient *http.Client
	status     SourceStatus
}

// Name implementa Enricher.
func (e *EPSSSource) Name() string { return "EPSS" }

// Status implementa Enricher.
func (e *EPSSSource) Status() SourceStatus {
	status := e.status
	status.Name = e.Name()
	if e.Endpoint != "" {
		status.Endpoint = e.Endpoint
	} else {
		status.Endpoint = epssEndpoint
	}
	return status
}

// Enrich implementa Enricher. Interroga EPSS per i soli identificativi CVE.
func (e *EPSSSource) Enrich(ctx context.Context, advisories []Advisory) error {
	cves := advisoryCVEs(advisories)
	if len(cves) == 0 {
		e.status = SourceStatus{Name: e.Name(), Offline: true}
		return nil
	}
	endpoint := e.Endpoint
	if endpoint == "" {
		endpoint = epssEndpoint
	}
	client := e.HTTPClient
	if client == nil {
		client = netpolicy.Client("vulncheck", enrichTimeout)
	}
	scores := map[string]epssEntry{}
	for start := 0; start < len(cves); start += epssBatchLimit {
		end := start + epssBatchLimit
		if end > len(cves) {
			end = len(cves)
		}
		fetched, err := fetchEPSS(ctx, client, endpoint, cves[start:end])
		if err != nil {
			e.status = SourceStatus{Name: e.Name(), Endpoint: endpoint, Error: err.Error()}
			return err
		}
		for cve, entry := range fetched {
			scores[cve] = entry
		}
	}
	for index := range advisories {
		cve := advisories[index].CVE()
		if cve == "" {
			continue
		}
		entry, found := scores[cve]
		if !found {
			continue
		}
		advisories[index].Severity.EPSS = entry.EPSSValue()
		advisories[index].Severity.EPSSPercentile = entry.PercentileValue()
	}
	e.status = SourceStatus{Name: e.Name(), Endpoint: endpoint, Offline: false}
	return nil
}

// epssEntry è una riga della risposta EPSS. FIRST manda i valori come stringhe.
type epssEntry struct {
	CVE        string `json:"cve"`
	EPSS       string `json:"epss"`
	Percentile string `json:"percentile"`
	Date       string `json:"date"`
}

func (e epssEntry) EPSSValue() float64 {
	value, _ := parseFloat(e.EPSS)
	return value
}

func (e epssEntry) PercentileValue() float64 {
	value, _ := parseFloat(e.Percentile)
	return value
}

// fetchEPSS interroga l'API EPSS per un gruppo di CVE.
func fetchEPSS(ctx context.Context, client *http.Client, endpoint string, cves []string) (map[string]epssEntry, error) {
	requestURL, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("EPSS endpoint: %w", err)
	}
	query := requestURL.Query()
	query.Set("cve", strings.Join(cves, ","))
	requestURL.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("EPSS request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("EPSS query: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("EPSS query: HTTP %d", response.StatusCode)
	}
	var payload struct {
		Data []epssEntry `json:"data"`
	}
	if err := json.UnmarshalRead(response.Body, &payload); err != nil {
		return nil, fmt.Errorf("EPSS response: %w", err)
	}
	result := map[string]epssEntry{}
	for _, entry := range payload.Data {
		result[strings.ToUpper(entry.CVE)] = entry
	}
	return result, nil
}

// KEVSource arricchisce gli advisory con il catalogo CISA Known Exploited
// Vulnerabilities: l'unica evidenza che la vulnerabilità è sfruttata *adesso*, non
// stimata. Nel risk model prevale su qualunque punteggio.
type KEVSource struct {
	// Endpoint permette di puntare a una copia locale o aziendale del catalogo.
	Endpoint   string
	HTTPClient *http.Client
	// lastUpdated è la data di rilascio dell'ultimo catalogo scaricato.
	lastUpdated string
	status      SourceStatus
}

// Name implementa Enricher.
func (k *KEVSource) Name() string { return "CISA KEV" }

// Status implementa Enricher.
func (k *KEVSource) Status() SourceStatus {
	status := k.status
	status.Name = k.Name()
	if k.Endpoint != "" {
		status.Endpoint = k.Endpoint
	} else {
		status.Endpoint = kevEndpoint
	}
	return status
}

// Enrich implementa Enricher. Scarica il catalogo e marca gli advisory elencati.
func (k *KEVSource) Enrich(ctx context.Context, advisories []Advisory) error {
	if len(advisories) == 0 {
		k.status = SourceStatus{Name: k.Name(), Offline: true}
		return nil
	}
	endpoint := k.Endpoint
	if endpoint == "" {
		endpoint = kevEndpoint
	}
	client := k.HTTPClient
	if client == nil {
		client = netpolicy.Client("vulncheck", enrichTimeout)
	}
	catalog, released, err := fetchKEV(ctx, client, endpoint)
	if err != nil {
		k.status = SourceStatus{Name: k.Name(), Endpoint: endpoint, Error: err.Error()}
		return err
	}
	for index := range advisories {
		cve := advisories[index].CVE()
		if cve == "" {
			continue
		}
		entry, found := catalog[cve]
		if !found {
			continue
		}
		advisories[index].Severity.KEV = true
		advisories[index].Severity.KEVDueDate = entry.DueDate
		advisories[index].Severity.KEVRansomwareCampaign = strings.EqualFold(entry.KnownRansomwareCampaignUse, "Known")
	}
	k.lastUpdated = released
	k.status = SourceStatus{
		Name:        k.Name(),
		Endpoint:    endpoint,
		LastUpdated: released,
		Offline:     false,
	}
	return nil
}

// kevEntry è una voce del catalogo CISA KEV.
type kevEntry struct {
	CVEID                      string `json:"cveID"`
	VendorProject              string `json:"vendorProject"`
	Product                    string `json:"product"`
	VulnerabilityName          string `json:"vulnerabilityName"`
	DateAdded                  string `json:"dateAdded"`
	ShortDescription           string `json:"shortDescription"`
	RequiredAction             string `json:"requiredAction"`
	DueDate                    string `json:"dueDate"`
	KnownRansomwareCampaignUse string `json:"knownRansomwareCampaignUse"`
	Notes                      string `json:"notes"`
}

// fetchKEV scarica e indicizza il catalogo per identificativo CVE. Ritorna anche la
// data di rilascio del catalogo: serve a sapere quanto è recente la propria visione
// delle vulnerabilità sfruttate attivamente.
func fetchKEV(ctx context.Context, client *http.Client, endpoint string) (map[string]kevEntry, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", fmt.Errorf("KEV request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("KEV download: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("KEV download: HTTP %d", response.StatusCode)
	}
	var catalog struct {
		DateReleased    string     `json:"dateReleased"`
		Vulnerabilities []kevEntry `json:"vulnerabilities"`
	}
	if err := json.UnmarshalRead(response.Body, &catalog); err != nil {
		return nil, "", fmt.Errorf("KEV catalog: %w", err)
	}
	result := map[string]kevEntry{}
	for _, entry := range catalog.Vulnerabilities {
		result[strings.ToUpper(entry.CVEID)] = entry
	}
	return result, catalog.DateReleased, nil
}

// advisoryCVEs elenca i CVE distinti fra gli advisory, in ordine stabile.
func advisoryCVEs(advisories []Advisory) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, advisory := range advisories {
		if cve := advisory.CVE(); cve != "" && !seen[cve] {
			seen[cve] = true
			result = append(result, cve)
		}
	}
	return result
}

// parseFloat legge un numero decimale con separatore punto.
func parseFloat(value string) (float64, bool) {
	var result float64
	if _, err := fmt.Sscanf(strings.TrimSpace(value), "%g", &result); err != nil {
		return 0, false
	}
	return result, true
}
