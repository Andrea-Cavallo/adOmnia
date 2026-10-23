package eclipsepde

import (
	"adomnia/internal/jsonutil"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
)

// The legacy bridge (spec sections 8 and 11: "LegacyJavaBridge"): authoritative
// PDE/Equinox state is computed by the compatible Kepler-era tools running in an
// isolated Java process; Go orchestrates, caches and presents results. Errors or
// crashes of the Java side must never block adOmnia (process isolation).
//
// Protocol: newline-delimited JSON over the child process stdin/stdout, one
// request per line, one response per line, ids correlate concurrent calls.
// This file defines the wire format only; launching and supervising the child
// belongs to the process layer, which also enforces project authorization.

// BridgeMethod identifies a bridge operation.
type BridgeMethod string

const (
	// BridgeResolve runs the authoritative PDE/Equinox resolution for a set of
	// workspace bundles against a target platform.
	BridgeResolve BridgeMethod = "resolve"
	// BridgeClasspath returns the PDE compile classpath PDE itself would build.
	BridgeClasspath BridgeMethod = "classpath"
	// BridgePing checks the bridge is alive and reports its tool versions.
	BridgePing BridgeMethod = "ping"
)

// BridgeRequest is one request line written to the bridge stdin.
type BridgeRequest struct {
	ID     string            `json:"id"`
	Method BridgeMethod      `json:"method"`
	Params jsonv1.RawMessage `json:"params,omitempty"`
}

// BridgeResponse is one response line read from the bridge stdout.
type BridgeResponse struct {
	ID string `json:"id"`
	// Result carries the method payload on success.
	Result jsonv1.RawMessage `json:"result,omitempty"`
	// Error is a human-readable failure; non-empty means the call failed.
	Error string `json:"error,omitempty"`
}

// ResolveParams are the parameters of BridgeResolve: the workspace bundles as
// manifests and the target platform location, so the Java side sees the same
// inputs the local diagnostic resolver saw.
type ResolveParams struct {
	// Workspace is the text of each workspace bundle MANIFEST.MF, keyed by
	// project name: the bridge re-parses them with PDE's own model.
	Workspace map[string]string `json:"workspace"`
	// TargetPath is the active target platform directory.
	TargetPath string `json:"targetPath"`
	// ExecutionEnvironment is the expected EE, e.g. "JavaSE-1.6".
	ExecutionEnvironment string `json:"executionEnvironment,omitempty"`
}

// ResolveResult is the normalized outcome of BridgeResolve: PDE resolved state
// per bundle, with wiring details the local resolver cannot reproduce.
type ResolveResult struct {
	Bundles []ResolvedBundle `json:"bundles"`
	// ToolVersions reports the versions of the PDE/Equinox tools in use.
	ToolVersions map[string]string `json:"toolVersions,omitempty"`
}

// ResolvedBundle is one bundle's authoritative state.
type ResolvedBundle struct {
	SymbolicName string `json:"symbolicName"`
	Version      string `json:"version"`
	// State is "RESOLVED", "UNRESOLVED", "INSTALLED" or "STOPPED" (OSGi states).
	State string `json:"state"`
	// Wiring lists the resolved imports and requires of the bundle.
	Wiring []Wire `json:"wiring,omitempty"`
	// Problems are the PDE markers for this bundle, as text.
	Problems []string `json:"problems,omitempty"`
}

// Wire is one resolved dependency edge as PDE computed it.
type Wire struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	// Provider is the symbolic name of the bundle actually providing it.
	Provider string `json:"provider"`
	// ProviderVersion is the version of the provider.
	ProviderVersion string `json:"providerVersion"`
}

// ClasspathParams are the parameters of BridgeClasspath.
type ClasspathParams struct {
	Project    string            `json:"project"`
	Workspace  map[string]string `json:"workspace"`
	TargetPath string            `json:"targetPath"`
}

// ClasspathResult is the PDE compile classpath for one project.
type ClasspathResult struct {
	// Elements are absolute paths or workspace project names, in PDE order.
	Elements []string `json:"elements"`
}

// PingResult reports the bridge identity for diagnostics ("which PDE is this?").
type PingResult struct {
	PdeVersion     string `json:"pdeVersion"`
	EquinoxVersion string `json:"equinoxVersion"`
	JavaVersion    string `json:"javaVersion"`
}

// EncodeBridgeRequest marshals a request as one protocol line (without the
// trailing newline, which the transport adds).
func EncodeBridgeRequest(id string, method BridgeMethod, params any) ([]byte, error) {
	var raw jsonv1.RawMessage
	if params != nil {
		encoded, err := jsonutil.Marshal(params)
		if err != nil {
			return nil, err
		}
		raw = encoded
	}
	return jsonutil.Marshal(BridgeRequest{ID: id, Method: method, Params: raw})
}

// DecodeBridgeResponse parses one protocol line and returns the correlated
// result. The result is decoded into out when out is non-nil.
func DecodeBridgeResponse(line []byte, expectID string, out any) error {
	var response BridgeResponse
	if err := json.Unmarshal(line, &response); err != nil {
		return fmt.Errorf("malformed bridge response: %w", err)
	}
	if response.ID != expectID {
		return fmt.Errorf("bridge response id %q does not match request %q", response.ID, expectID)
	}
	if response.Error != "" {
		return fmt.Errorf("bridge error: %s", response.Error)
	}
	if out != nil && len(response.Result) > 0 {
		if err := json.Unmarshal(response.Result, out); err != nil {
			return fmt.Errorf("malformed bridge result: %w", err)
		}
	}
	return nil
}
