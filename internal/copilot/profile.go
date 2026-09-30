// Package copilot integra GitHub Copilot in Go Studio tramite il Copilot Language Server ufficiale.
//
// Regola non negoziabile: nessun componente assume che l'host sia github.com. Ogni operazione
// riceve un GitHubProfile, dal quale ricava host, URL e configurazione enterprise.
package copilot

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ProfileType distingue le tre famiglie di GitHub, che hanno capability diverse.
type ProfileType string

const (
	// ProfileDotCom è github.com.
	ProfileDotCom ProfileType = "github.com"
	// ProfileEnterpriseCloud è GitHub Enterprise Cloud con residenza dati (*.ghe.com).
	ProfileEnterpriseCloud ProfileType = "ghe.com"
	// ProfileEnterpriseServer è GitHub Enterprise Server on-premise (qualsiasi altro host).
	ProfileEnterpriseServer ProfileType = "ghes"
)

const (
	dotComHost            = "github.com"
	enterpriseCloudSuffix = ".ghe.com"
	maxProfileNameLength  = 64
)

// GitHubProfile è un account GitHub configurato. Non contiene mai token: le credenziali restano
// nell'archivio del Copilot Language Server, adOmnia salva solo host e nome.
type GitHubProfile struct {
	ID   string      `json:"id"`
	Name string      `json:"name"`
	Type ProfileType `json:"type"`
	Host string      `json:"host"`
}

// DefaultProfile è il profilo github.com proposto alla prima apertura.
func DefaultProfile() GitHubProfile {
	return GitHubProfile{ID: "personal", Name: "Personal", Type: ProfileDotCom, Host: dotComHost}
}

// DetectProfileType classifica un host già normalizzato.
func DetectProfileType(host string) ProfileType {
	switch {
	case host == dotComHost:
		return ProfileDotCom
	case strings.HasSuffix(host, enterpriseCloudSuffix):
		return ProfileEnterpriseCloud
	default:
		return ProfileEnterpriseServer
	}
}

// NormalizeHost accetta "company.ghe.com", "https://company.ghe.com/" o "github.com" e restituisce
// l'host in minuscolo, senza schema né percorso. Rifiuta credenziali, query e host non validi.
func NormalizeHost(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New("GitHub host is required")
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid GitHub host %q", raw)
	}
	if parsed.Scheme != "https" {
		return "", errors.New("GitHub host must use https")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" {
		return "", fmt.Errorf("use only the host name, for example company.ghe.com")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" || strings.ContainsAny(host, " _") || !strings.Contains(host, ".") && net.ParseIP(host) == nil && host != "localhost" {
		return "", fmt.Errorf("invalid GitHub host %q", raw)
	}
	if port := parsed.Port(); port != "" {
		host = net.JoinHostPort(host, port)
	}
	return host, nil
}

// BaseURL è l'URL web dell'istanza, es. https://company.ghe.com.
func (p GitHubProfile) BaseURL() string {
	return "https://" + p.Host
}

// Enterprise indica un'istanza diversa da github.com.
func (p GitHubProfile) Enterprise() bool {
	return p.Type != ProfileDotCom
}

// EnterpriseURI è il valore di github-enterprise.uri per il Language Server; vuoto per github.com.
func (p GitHubProfile) EnterpriseURI() string {
	if !p.Enterprise() {
		return ""
	}
	return p.BaseURL()
}

// Label descrive il profilo come nella status bar: "Work — company.ghe.com".
func (p GitHubProfile) Label() string {
	return p.Name + " — " + p.Host
}

// NewProfile valida nome e host e ricava il tipo dall'host.
func NewProfile(id, name, host string) (GitHubProfile, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return GitHubProfile{}, errors.New("profile name is required")
	}
	if len(name) > maxProfileNameLength {
		return GitHubProfile{}, fmt.Errorf("profile name is longer than %d characters", maxProfileNameLength)
	}
	normalized, err := NormalizeHost(host)
	if err != nil {
		return GitHubProfile{}, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return GitHubProfile{}, errors.New("profile id is required")
	}
	return GitHubProfile{ID: id, Name: name, Type: DetectProfileType(normalized), Host: normalized}, nil
}
