// Package flowintel is the Flow Intelligence engine: it discovers flows/subflows, the Java
// methods they invoke and the OSGi bundles they cross, and answers "where does this start",
// "what does it call", "who else breaks if I change it" with a confidence per link.
//
// It fills the existing Semantic Workspace Graph (internal/ide/graph); it is not a second
// graph engine. Framework-specific flow definitions are adapters: a declared
// `.adomnia/flows.json`, generic XML elements, or annotations on Java methods.
package flowintel

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ConfigFile is the declared-flow adapter: the escape hatch for any proprietary framework.
// It lives in the project and is read-only for the engine.
const ConfigFile = ".adomnia/flows.json"

// Config is `.adomnia/flows.json`.
type Config struct {
	Version int        `json:"version"`
	Flows   []FlowDecl `json:"flows"`
}

// FlowDecl declares one flow and what it calls. Method references are
// "package.Class#method" (or a bare method name when it is unambiguous in the workspace).
type FlowDecl struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	// Kind is "flow" (default) or "subflow".
	Kind string `json:"kind,omitempty"`
	// File/Line point at the definition when it lives in a source file.
	File     string     `json:"file,omitempty"`
	Line     int        `json:"line,omitempty"`
	Method   string     `json:"method,omitempty"`
	Subflows []string   `json:"subflows,omitempty"`
	Flows    []string   `json:"flowsTo,omitempty"`
	Calls    []Call     `json:"calls,omitempty"`
	External []External `json:"external,omitempty"`
}

// Call is one invocation declared by a flow.
type Call struct {
	Method string `json:"method,omitempty"`
	Class  string `json:"class,omitempty"`
	Name   string `json:"name,omitempty"`
	File   string `json:"file,omitempty"`
	Line   int    `json:"line,omitempty"`
}

// External is a SOAP/REST/database/queue call declared by a flow.
type External struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Detail string `json:"detail,omitempty"`
}

// LoadConfig reads the declared-flow adapter. A missing file is not an error.
func LoadConfig(root string) (Config, bool, error) {
	path := filepath.Join(root, filepath.FromSlash(ConfigFile))
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Config{}, false, nil
	}
	if err != nil {
		return Config{}, false, err
	}
	var config Config
	decoder := jsonv1.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		// Unknown fields are allowed: the format may grow.
		if err := json.Unmarshal(data, &config); err != nil {
			return Config{}, true, fmt.Errorf("%s: %w", ConfigFile, err)
		}
	}
	for index := range config.Flows {
		flow := &config.Flows[index]
		flow.ID = strings.TrimSpace(flow.ID)
		if flow.ID == "" {
			return Config{}, true, fmt.Errorf("%s: flow %d has no id", ConfigFile, index+1)
		}
		if flow.Kind == "" {
			flow.Kind = "flow"
		}
		flow.Kind = strings.ToLower(flow.Kind)
		if flow.Kind != "flow" && flow.Kind != "subflow" {
			return Config{}, true, fmt.Errorf("%s: flow %q has kind %q (use flow or subflow)", ConfigFile, flow.ID, flow.Kind)
		}
		if flow.Name == "" {
			flow.Name = flow.ID
		}
	}
	return config, true, nil
}
