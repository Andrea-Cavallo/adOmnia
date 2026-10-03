// Package sdk contiene le primitive comuni ai toolchain dei linguaggi (Go SDK, JDK, rustup…):
// ambiente dei processi, risoluzione degli eseguibili, query informative ed estrazione degli
// archivi scaricati. Ciò che sa di un SDK concreto (GOROOT, JAVA_HOME…) vive nel suo adapter.
package sdk

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/netpolicy"
)

const (
	maxEnvironmentEntries = 128
	maxEnvironmentValue   = 32 * 1024
)

var environmentNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ValidEnvironmentName dice se key è un nome di variabile d'ambiente accettabile.
func ValidEnvironmentName(key string) bool {
	return environmentNamePattern.MatchString(key)
}

// ValidateEnvironment ripulisce i nomi e applica i limiti; restituisce sempre una mappa nuova.
func ValidateEnvironment(environment map[string]string) (map[string]string, error) {
	if len(environment) > maxEnvironmentEntries {
		return nil, fmt.Errorf("troppe variabili ambiente: limite %d", maxEnvironmentEntries)
	}
	clean := make(map[string]string, len(environment))
	for key, value := range environment {
		key = strings.TrimSpace(key)
		if !ValidEnvironmentName(key) {
			return nil, fmt.Errorf("nome variabile ambiente non valido: %s", key)
		}
		if len(value) > maxEnvironmentValue {
			return nil, fmt.Errorf("valore ambiente troppo grande per %s", key)
		}
		clean[key] = value
	}
	return clean, nil
}

// PersistableEnvironment toglie i valori con credenziali negli URL, che restano solo in memoria.
// Restituisce nil se non resta nulla, come la configurazione salvata finora.
func PersistableEnvironment(environment map[string]string) map[string]string {
	var clean map[string]string
	for key, value := range environment {
		if HasURLCredentials(value) {
			continue
		}
		if clean == nil {
			clean = make(map[string]string)
		}
		clean[key] = value
	}
	return clean
}

// HasURLCredentials dice se un valore (anche una lista separata da , | o spazi) contiene user:pass@.
func HasURLCredentials(value string) bool {
	for _, part := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '|' || r == ' ' }) {
		if parsed, err := url.Parse(part); err == nil && parsed.User != nil {
			return true
		}
	}
	return false
}

// RedactURLList maschera credenziali, query e frammenti negli URL di una lista separata da virgole.
func RedactURLList(value string) string {
	parts := strings.Split(value, ",")
	for index, part := range parts {
		parsed, err := url.Parse(strings.TrimSpace(part))
		if err == nil && parsed.Scheme != "" && parsed.Host != "" {
			if parsed.User != nil {
				parsed.User = url.User("••••")
			}
			parsed.RawQuery = ""
			parsed.Fragment = ""
			parts[index] = parsed.String()
		}
	}
	return strings.Join(parts, ",")
}

// CopyEnvironment restituisce una copia (mai nil).
func CopyEnvironment(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

// ProcessEnvironment unisce ambiente del sistema, configurazione del toolchain e override, poi
// applica proxy, CA e modo offline di adOmnia. Il chiamante può aggiungere i propri predefiniti
// (es. GOTOOLCHAIN) prima di trasformarla con EnvironmentList.
func ProcessEnvironment(configured, overrides map[string]string) (map[string]string, error) {
	if len(overrides) > maxEnvironmentEntries {
		return nil, fmt.Errorf("troppe variabili ambiente: limite %d", maxEnvironmentEntries)
	}
	merged := CopyEnvironment(configured)
	for key, value := range overrides {
		if !ValidEnvironmentName(key) {
			return nil, fmt.Errorf("nome variabile ambiente non valido: %s", key)
		}
		if len(value) > maxEnvironmentValue {
			return nil, fmt.Errorf("valore ambiente troppo grande per %s", key)
		}
		merged[key] = value
	}
	base := make(map[string]string)
	for _, item := range os.Environ() {
		if index := strings.IndexByte(item, '='); index > 0 {
			base[item[:index]] = item[index+1:]
		}
	}
	for key, value := range merged {
		base[key] = value
	}
	// Proxy e CA di adOmnia riempiono i vuoti; il modo offline di adOmnia vince sul progetto.
	netpolicy.ProcessEnvironment(base)
	return base, nil
}

// EnvironmentList trasforma l'ambiente in KEY=VALUE ordinati per nome (output stabile e testabile).
func EnvironmentList(environment map[string]string) []string {
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+environment[key])
	}
	return result
}

// WithDefaultEnvironment aggiunge le variabili di defaults non già presenti (confronto senza maiuscole):
// valgono solo se l'utente non le ha impostate.
func WithDefaultEnvironment(environment []string, defaults map[string]string) []string {
	present := make(map[string]bool, len(environment))
	for _, entry := range environment {
		name, _, _ := strings.Cut(entry, "=")
		present[strings.ToUpper(name)] = true
	}
	for name, value := range defaults {
		if !present[name] {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
}
