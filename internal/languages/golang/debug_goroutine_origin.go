package golang

import (
	"fmt"
	"strconv"
	"strings"
)

// GoroutineCreation è l'istruzione `go` che ha creato una goroutine e la goroutine che l'ha eseguita.
type GoroutineCreation struct {
	// Location è la riga dell'istruzione go; nil per le goroutine create dal runtime (es. main).
	Location *DebugFrame `json:"location,omitempty"`
	// SourceLine è il testo di Location.
	SourceLine string `json:"sourceLine,omitempty"`
	// ParentID è la goroutine che ha eseguito l'istruzione go (Go 1.21+); 0 se non nota.
	ParentID int `json:"parentId,omitempty"`
}

// GoroutineCreation legge dal runtime il punto di creazione della goroutine del thread indicato:
// runtime.curg.gopc (indirizzo di ritorno dopo la chiamata a newproc) risolto sulla riga sorgente
// dell'istruzione che lo precede, cioè l'istruzione go. Delve non lo espone via DAP, il runtime sì.
func (m *DebugExtensions) GoroutineCreation(id DebugSessionID, threadID int) (GoroutineCreation, error) {
	frames, err := m.StackTraceLimit(id, threadID, 1)
	if err != nil {
		return GoroutineCreation{}, err
	}
	if len(frames) == 0 {
		return GoroutineCreation{}, fmt.Errorf("la goroutine non ha frame da cui leggere il runtime")
	}
	frameID := frames[0].ID
	gopc, err := m.evaluateUint(id, "runtime.curg.gopc", frameID)
	if err != nil {
		return GoroutineCreation{}, fmt.Errorf("punto di creazione non leggibile: %w", err)
	}
	result := GoroutineCreation{}
	if parent, err := m.evaluateUint(id, "runtime.curg.parentGoid", frameID); err == nil {
		result.ParentID = int(parent)
	}
	if gopc == 0 {
		return result, nil
	}
	location, err := m.callSiteBefore(id, gopc)
	if err != nil {
		return GoroutineCreation{}, err
	}
	result.Location = location
	if location != nil && location.Path != "" {
		result.SourceLine = strings.TrimSpace(newSourceLineCache().line(location.Path, location.Line))
	}
	return result, nil
}

// callSiteBefore risolve un indirizzo di ritorno sulla riga della CALL che lo precede, come fa il
// runtime con pc-1: è la riga dell'istruzione go o defer che ha chiamato newproc/deferproc.
func (m *DebugExtensions) callSiteBefore(id DebugSessionID, returnPC uint64) (*DebugFrame, error) {
	address := fmt.Sprintf("0x%x", returnPC)
	instructions, err := m.Disassemble(id, address, 1, 0)
	if err != nil {
		return nil, err
	}
	var location *DebugFrame
	for _, instruction := range instructions {
		if strings.EqualFold(instruction.Address, address) || instruction.Line == 0 {
			continue
		}
		location = &DebugFrame{Name: instruction.Symbol, Path: instruction.Path, RelativePath: instruction.RelativePath, Line: instruction.Line, Column: 1, InstructionPointer: instruction.Address}
	}
	return location, nil
}

func (m *DebugExtensions) evaluateUint(id DebugSessionID, expression string, frameID int) (uint64, error) {
	value, err := m.Evaluate(id, expression, frameID, "watch")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(value.Result)
	if len(fields) == 0 {
		return 0, fmt.Errorf("valore vuoto per %s", expression)
	}
	return strconv.ParseUint(strings.TrimSuffix(fields[0], ","), 0, 64)
}

// DebugGoroutineCreation restituisce l'istruzione go che ha creato la goroutine del thread indicato.
