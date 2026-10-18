// Package standard compone il motore di Security Intelligence con tutti gli adapter e le fonti di adOmnia.
// Lo usano l'app (binding Wails) e il comando per la CI: un solo punto dove si aggiunge un ecosistema.
package standard

import (
	"adomnia/internal/securityintel"
	"adomnia/internal/securityintel/gomod"
	"adomnia/internal/securityintel/maven"
)

// Engine compone il motore. cacheDirectory è il database locale degli advisory (scansioni offline);
// endpoints sostituisce gli URL delle fonti ("osv", "epss", "kev") con specchi aziendali.
func Engine(cacheDirectory string, endpoints map[string]string) (*securityintel.Engine, *securityintel.AdvisoryCache) {
	cache := securityintel.NewAdvisoryCache(cacheDirectory)
	osv := &securityintel.OSVSource{Endpoint: endpoints["osv"], Cache: cache}
	enrichers := []securityintel.Enricher{
		&securityintel.EPSSSource{Endpoint: endpoints["epss"]},
		&securityintel.KEVSource{Endpoint: endpoints["kev"]},
	}
	adapters := []securityintel.EcosystemAdapter{maven.New(), gomod.New()}
	return securityintel.New(adapters, []securityintel.Source{osv}, enrichers, cache), cache
}
