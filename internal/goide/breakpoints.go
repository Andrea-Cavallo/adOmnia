package goide

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	maxBreakpointTextLength = 1000
	maxFunctionBreakpoints  = 100
	// panicFunction è la funzione del runtime che ogni panic attraversa, anche quelli poi recuperati.
	panicFunction = "runtime.gopanic"
)

// hitConditionPattern accetta le forme di Delve: "5", ">= 5", "% 2", "== 3"…
var hitConditionPattern = regexp.MustCompile(`^(>=|<=|==|!=|>|<|%)?\s*[0-9]+$`)

// Breakpoint è un breakpoint di riga con le opzioni di Delve: condizione, hit count e logpoint.
type Breakpoint struct {
	Line         int    `json:"line"`
	Condition    string `json:"condition,omitempty"`
	HitCondition string `json:"hitCondition,omitempty"`
	// LogMessage trasforma il breakpoint in logpoint: stampa il messaggio ({espressione}) senza fermarsi.
	LogMessage string `json:"logMessage,omitempty"`
	Disabled   bool   `json:"disabled,omitempty"`
}

// UnmarshalJSON legge anche il formato salvato fino alla v0.9.42, dove un breakpoint era solo il numero di riga.
func (b *Breakpoint) UnmarshalJSON(data []byte) error {
	var line int
	if err := json.Unmarshal(data, &line); err == nil {
		*b = Breakpoint{Line: line}
		return nil
	}
	type plain Breakpoint
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*b = Breakpoint(decoded)
	return nil
}

// BreakpointState è un breakpoint di riga con la verifica di Delve (la riga può essere spostata).
type BreakpointState struct {
	Line         int    `json:"line"`
	Condition    string `json:"condition,omitempty"`
	HitCondition string `json:"hitCondition,omitempty"`
	LogMessage   string `json:"logMessage,omitempty"`
	Disabled     bool   `json:"disabled,omitempty"`
	Verified     bool   `json:"verified"`
	Message      string `json:"message,omitempty"`
}

// FileBreakpoints è il payload di debug.breakpoints.
type FileBreakpoints struct {
	SessionID    SessionID         `json:"sessionId"`
	RelativePath string            `json:"relativePath"`
	Breakpoints  []BreakpointState `json:"breakpoints"`
}

// FunctionBreakpoint ferma il programma all'ingresso di una funzione (es. main.handler, (*Server).Serve).
type FunctionBreakpoint struct {
	Name         string `json:"name"`
	Condition    string `json:"condition,omitempty"`
	HitCondition string `json:"hitCondition,omitempty"`
	Disabled     bool   `json:"disabled,omitempty"`
}

// FunctionBreakpointSettings sono i breakpoint non legati a una riga, salvati per progetto.
type FunctionBreakpointSettings struct {
	Functions []FunctionBreakpoint `json:"functions"`
	// StopOnPanic ferma anche sui panic recuperati; quelli non recuperati fermano Delve comunque.
	StopOnPanic bool `json:"stopOnPanic"`
}

type FunctionBreakpointState struct {
	Name         string `json:"name"`
	Condition    string `json:"condition,omitempty"`
	HitCondition string `json:"hitCondition,omitempty"`
	Disabled     bool   `json:"disabled,omitempty"`
	Verified     bool   `json:"verified"`
	Message      string `json:"message,omitempty"`
}

// FunctionBreakpointsView è il payload di debug.functionBreakpoints.
type FunctionBreakpointsView struct {
	SessionID   SessionID                 `json:"sessionId"`
	Functions   []FunctionBreakpointState `json:"functions"`
	StopOnPanic bool                      `json:"stopOnPanic"`
	// PanicMessage spiega perché il panic breakpoint non è stato accettato da Delve.
	PanicMessage string `json:"panicMessage,omitempty"`
}

type runToCursor struct {
	path string
	line int
}

type dapBreakpointResult struct {
	Verified bool   `json:"verified"`
	Line     int    `json:"line"`
	Message  string `json:"message"`
}

// normalizeBreakpoints valida il testo, scarta le righe non valide e tiene un solo breakpoint per riga (l'ultimo).
func normalizeBreakpoints(breakpoints []Breakpoint) ([]Breakpoint, error) {
	byLine := make(map[int]Breakpoint, len(breakpoints))
	for _, breakpoint := range breakpoints {
		if breakpoint.Line <= 0 {
			continue
		}
		breakpoint.Condition = strings.TrimSpace(breakpoint.Condition)
		breakpoint.HitCondition = strings.TrimSpace(breakpoint.HitCondition)
		breakpoint.LogMessage = strings.TrimSpace(breakpoint.LogMessage)
		if err := validateBreakpointText(breakpoint.Condition, breakpoint.HitCondition, breakpoint.LogMessage); err != nil {
			return nil, fmt.Errorf("line %d: %w", breakpoint.Line, err)
		}
		byLine[breakpoint.Line] = breakpoint
	}
	result := make([]Breakpoint, 0, len(byLine))
	for _, breakpoint := range byLine {
		result = append(result, breakpoint)
	}
	sort.Slice(result, func(left, right int) bool { return result[left].Line < result[right].Line })
	return result, nil
}

func normalizeFunctionBreakpoints(settings FunctionBreakpointSettings) (FunctionBreakpointSettings, error) {
	seen := map[string]bool{}
	functions := make([]FunctionBreakpoint, 0, len(settings.Functions))
	for _, function := range settings.Functions {
		function.Name = strings.TrimSpace(function.Name)
		function.Condition = strings.TrimSpace(function.Condition)
		function.HitCondition = strings.TrimSpace(function.HitCondition)
		if function.Name == "" || seen[function.Name] {
			continue
		}
		if len(function.Name) > 300 || strings.ContainsAny(function.Name, "\r\n") {
			return FunctionBreakpointSettings{}, fmt.Errorf("function name not valid: %q", function.Name)
		}
		if err := validateBreakpointText(function.Condition, function.HitCondition, ""); err != nil {
			return FunctionBreakpointSettings{}, fmt.Errorf("%s: %w", function.Name, err)
		}
		seen[function.Name] = true
		functions = append(functions, function)
	}
	if len(functions) > maxFunctionBreakpoints {
		return FunctionBreakpointSettings{}, fmt.Errorf("too many function breakpoints (max %d)", maxFunctionBreakpoints)
	}
	return FunctionBreakpointSettings{Functions: functions, StopOnPanic: settings.StopOnPanic}, nil
}

func validateBreakpointText(condition, hitCondition, logMessage string) error {
	if len(condition) > maxBreakpointTextLength || len(logMessage) > maxBreakpointTextLength {
		return fmt.Errorf("condition and log message are limited to %d characters", maxBreakpointTextLength)
	}
	if hitCondition != "" && !hitConditionPattern.MatchString(hitCondition) {
		return fmt.Errorf("hit count %q not valid: use a number (stop at that hit) or >= N, == N, %% N", hitCondition)
	}
	return nil
}

func breakpointLines(breakpoints []Breakpoint) []int {
	lines := make([]int, 0, len(breakpoints))
	for _, breakpoint := range breakpoints {
		lines = append(lines, breakpoint.Line)
	}
	return lines
}

func unverifiedStates(breakpoints []Breakpoint) []BreakpointState {
	states := make([]BreakpointState, 0, len(breakpoints))
	for _, breakpoint := range breakpoints {
		states = append(states, breakpointState(breakpoint, false, ""))
	}
	return states
}

func breakpointState(breakpoint Breakpoint, verified bool, message string) BreakpointState {
	return BreakpointState{
		Line: breakpoint.Line, Condition: breakpoint.Condition, HitCondition: breakpoint.HitCondition,
		LogMessage: breakpoint.LogMessage, Disabled: breakpoint.Disabled, Verified: verified, Message: message,
	}
}

// dapSourceBreakpoints costruisce la richiesta setBreakpoints: solo i breakpoint attivi, più la riga di Run to Cursor.
// indexes[i] è la posizione in breakpoints della i-esima voce inviata (-1 per la riga temporanea).
func dapSourceBreakpoints(breakpoints []Breakpoint, runTo int) (requested []map[string]any, indexes []int) {
	for index, breakpoint := range breakpoints {
		if breakpoint.Disabled {
			continue
		}
		entry := map[string]any{"line": breakpoint.Line}
		if breakpoint.Condition != "" {
			entry["condition"] = breakpoint.Condition
		}
		if breakpoint.HitCondition != "" {
			entry["hitCondition"] = breakpoint.HitCondition
		}
		if breakpoint.LogMessage != "" {
			entry["logMessage"] = breakpoint.LogMessage
		}
		requested = append(requested, entry)
		indexes = append(indexes, index)
		// Una riga di Run to Cursor con già un breakpoint attivo e senza condizioni non serve.
		if breakpoint.Line == runTo && breakpoint.Condition == "" && breakpoint.HitCondition == "" && breakpoint.LogMessage == "" {
			runTo = 0
		}
	}
	if runTo > 0 {
		// Delve accetta un solo breakpoint per riga: quello condizionato lascia il posto alla fermata certa.
		for position, index := range indexes {
			if breakpoints[index].Line == runTo {
				requested = append(requested[:position], requested[position+1:]...)
				indexes = append(indexes[:position], indexes[position+1:]...)
				break
			}
		}
		requested = append(requested, map[string]any{"line": runTo})
		indexes = append(indexes, -1)
	}
	return requested, indexes
}

// dapFunctionBreakpoints costruisce la richiesta setFunctionBreakpoints (più runtime.gopanic se richiesto).
func dapFunctionBreakpoints(settings FunctionBreakpointSettings) (requested []map[string]any, indexes []int) {
	for index, function := range settings.Functions {
		if function.Disabled {
			continue
		}
		entry := map[string]any{"name": function.Name}
		if function.Condition != "" {
			entry["condition"] = function.Condition
		}
		if function.HitCondition != "" {
			entry["hitCondition"] = function.HitCondition
		}
		requested = append(requested, entry)
		indexes = append(indexes, index)
	}
	if settings.StopOnPanic {
		requested = append(requested, map[string]any{"name": panicFunction})
		indexes = append(indexes, -1)
	}
	return requested, indexes
}

func (m *DebugManager) breakpointsFor(sessionID SessionID) map[string][]Breakpoint {
	m.mu.Lock()
	defer m.mu.Unlock()
	copyOf := map[string][]Breakpoint{}
	for path, breakpoints := range m.breakpoints[sessionID] {
		copyOf[path] = append([]Breakpoint(nil), breakpoints...)
	}
	return copyOf
}

func (m *DebugManager) functionsFor(sessionID SessionID) FunctionBreakpointSettings {
	m.mu.Lock()
	defer m.mu.Unlock()
	settings := m.functions[sessionID]
	settings.Functions = append([]FunctionBreakpoint(nil), settings.Functions...)
	return settings
}

// SeedBreakpoints carica i breakpoint salvati se la sessione non ne ha ancora in memoria.
func (m *DebugManager) SeedBreakpoints(sessionID SessionID, byPath map[string][]Breakpoint, functions FunctionBreakpointSettings) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.functions[sessionID]; !ok {
		m.functions[sessionID] = functions
	}
	if m.breakpoints[sessionID] != nil {
		return
	}
	seeded := make(map[string][]Breakpoint, len(byPath))
	for path, breakpoints := range byPath {
		if normalized, err := normalizeBreakpoints(breakpoints); err == nil && len(normalized) > 0 {
			seeded[path] = normalized
		}
	}
	m.breakpoints[sessionID] = seeded
}

// SetBreakpoints sostituisce i breakpoint di un file; con un debug attivo li invia subito a Delve e ne pubblica la verifica.
func (m *DebugManager) SetBreakpoints(sessionID SessionID, root, path string, breakpoints []Breakpoint) []BreakpointState {
	m.mu.Lock()
	if m.breakpoints[sessionID] == nil {
		m.breakpoints[sessionID] = map[string][]Breakpoint{}
	}
	if len(breakpoints) == 0 {
		delete(m.breakpoints[sessionID], path)
	} else {
		m.breakpoints[sessionID][path] = breakpoints
	}
	m.mu.Unlock()
	states := unverifiedStates(breakpoints)
	for _, session := range m.list(sessionID) {
		if verified := m.sendBreakpoints(session, path, breakpoints); verified != nil {
			states = verified
		}
	}
	m.publish("debug.breakpoints", sessionID, relativeWithin(root, path), FileBreakpoints{SessionID: sessionID, RelativePath: filepath.ToSlash(relativeWithin(root, path)), Breakpoints: states})
	return states
}

// SetFunctionBreakpoints sostituisce i breakpoint di funzione e il panic breakpoint del progetto.
func (m *DebugManager) SetFunctionBreakpoints(sessionID SessionID, settings FunctionBreakpointSettings) FunctionBreakpointsView {
	m.mu.Lock()
	m.functions[sessionID] = settings
	m.mu.Unlock()
	view := unverifiedFunctionView(sessionID, settings)
	for _, session := range m.list(sessionID) {
		if verified := m.sendFunctionBreakpoints(session, settings); verified != nil {
			view = *verified
		}
	}
	m.publish("debug.functionBreakpoints", sessionID, "", view)
	return view
}

func unverifiedFunctionView(sessionID SessionID, settings FunctionBreakpointSettings) FunctionBreakpointsView {
	view := FunctionBreakpointsView{SessionID: sessionID, StopOnPanic: settings.StopOnPanic, Functions: make([]FunctionBreakpointState, 0, len(settings.Functions))}
	for _, function := range settings.Functions {
		view.Functions = append(view.Functions, functionState(function, false, ""))
	}
	return view
}

func functionState(function FunctionBreakpoint, verified bool, message string) FunctionBreakpointState {
	return FunctionBreakpointState{Name: function.Name, Condition: function.Condition, HitCondition: function.HitCondition, Disabled: function.Disabled, Verified: verified, Message: message}
}

func (m *DebugManager) sendBreakpoints(session *debugger, path string, breakpoints []Breakpoint) []BreakpointState {
	states, _ := m.sendBreakpointsReport(session, path, breakpoints)
	return states
}

// sendBreakpointsReport invia i breakpoint di un file e dice anche se Delve ha accettato la riga di Run to Cursor.
func (m *DebugManager) sendBreakpointsReport(session *debugger, path string, breakpoints []Breakpoint) ([]BreakpointState, bool) {
	session.mu.Lock()
	client := session.client
	runTo := 0
	if session.runTo != nil && session.runTo.path == path {
		runTo = session.runTo.line
	}
	session.mu.Unlock()
	if client == nil {
		return nil, false
	}
	requested, indexes := dapSourceBreakpoints(breakpoints, runTo)
	if requested == nil {
		requested = []map[string]any{}
	}
	var response struct {
		Breakpoints []dapBreakpointResult `json:"breakpoints"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancel()
	if err := client.Call(ctx, "setBreakpoints", map[string]any{"source": map[string]string{"path": path}, "breakpoints": requested}, &response); err != nil {
		return nil, false
	}
	states := unverifiedStates(breakpoints)
	runToVerified := false
	for position, result := range response.Breakpoints {
		if position >= len(indexes) {
			continue
		}
		if indexes[position] < 0 {
			runToVerified = result.Verified
			continue
		}
		state := &states[indexes[position]]
		state.Verified, state.Message = result.Verified, result.Message
		if result.Line > 0 {
			state.Line = result.Line
		}
	}
	// Una riga già coperta da un breakpoint attivo senza condizioni ferma comunque il programma.
	if runTo > 0 && !runToVerified {
		for _, state := range states {
			if state.Line == runTo && state.Verified && !state.Disabled && state.Condition == "" && state.HitCondition == "" && state.LogMessage == "" {
				runToVerified = true
			}
		}
	}
	return states, runToVerified
}

// sendFunctionBreakpoints invia i breakpoint di funzione; nil se il debugger non è ancora connesso.
func (m *DebugManager) sendFunctionBreakpoints(session *debugger, settings FunctionBreakpointSettings) *FunctionBreakpointsView {
	session.mu.Lock()
	client := session.client
	sessionID := session.info.SessionID
	session.mu.Unlock()
	if client == nil {
		return nil
	}
	requested, indexes := dapFunctionBreakpoints(settings)
	if requested == nil {
		requested = []map[string]any{}
	}
	var response struct {
		Breakpoints []dapBreakpointResult `json:"breakpoints"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), debugRequestTimeout)
	defer cancel()
	if err := client.Call(ctx, "setFunctionBreakpoints", map[string]any{"breakpoints": requested}, &response); err != nil {
		view := unverifiedFunctionView(sessionID, settings)
		for index := range view.Functions {
			view.Functions[index].Message = err.Error()
		}
		return &view
	}
	view := unverifiedFunctionView(sessionID, settings)
	for position, result := range response.Breakpoints {
		if position >= len(indexes) {
			continue
		}
		if indexes[position] < 0 {
			if !result.Verified {
				view.PanicMessage = result.Message
				if view.PanicMessage == "" {
					view.PanicMessage = "Delve did not accept the panic breakpoint"
				}
			}
			continue
		}
		state := &view.Functions[indexes[position]]
		state.Verified, state.Message = result.Verified, result.Message
	}
	return &view
}

func (m *DebugManager) publishFunctionBreakpoints(session *debugger, view *FunctionBreakpointsView) {
	if view != nil {
		m.publish("debug.functionBreakpoints", view.SessionID, "", *view)
	}
}

// resendFile rimanda a Delve i breakpoint di un file (es. per togliere la riga temporanea di Run to Cursor).
func (m *DebugManager) resendFile(session *debugger, path string) {
	_, sessionID := session.identity()
	m.sendBreakpoints(session, path, m.breakpointsFor(sessionID)[path])
}

// SessionOf restituisce il progetto a cui appartiene una sessione di debug.
func (m *DebugManager) SessionOf(id DebugSessionID) (SessionID, error) {
	session, err := m.get(id)
	if err != nil {
		return "", err
	}
	_, sessionID := session.identity()
	return sessionID, nil
}

// RunToCursor riprende l'esecuzione fino alla riga indicata con un breakpoint temporaneo, tolto alla prima fermata.
func (m *DebugManager) RunToCursor(id DebugSessionID, path string, line, threadID int) error {
	session, err := m.get(id)
	if err != nil {
		return err
	}
	if line <= 0 {
		return fmt.Errorf("line not valid")
	}
	session.mu.Lock()
	stopped := session.info.State == DebugStopped
	if stopped {
		session.runTo = &runToCursor{path: path, line: line}
	}
	session.mu.Unlock()
	if !stopped {
		return fmt.Errorf("Run to Cursor needs a paused program")
	}
	_, sessionID := session.identity()
	states, verified := m.sendBreakpointsReport(session, path, m.breakpointsFor(sessionID)[path])
	if states == nil {
		m.clearRunTo(session)
		return fmt.Errorf("the debugger is not connected")
	}
	if !verified {
		m.clearRunTo(session)
		m.resendFile(session, path)
		return fmt.Errorf("no executable code on line %d: Run to Cursor needs a line with a Go statement", line)
	}
	if err := m.Step(id, "continue", threadID); err != nil {
		m.clearRunTo(session)
		m.resendFile(session, path)
		return err
	}
	return nil
}

func (m *DebugManager) clearRunTo(session *debugger) {
	session.mu.Lock()
	session.runTo = nil
	session.mu.Unlock()
}
