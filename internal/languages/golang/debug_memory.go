package golang

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	maxDebugMemory   = 1024
	debugMemoryChunk = 64 // Delve abbrevia gli array più lunghi nel risultato di evaluate
)

var (
	hexAddress   = regexp.MustCompile(`^0[xX][0-9a-fA-F]{1,16}$`)
	evaluatedHex = regexp.MustCompile(`0x[0-9a-fA-F]{1,16}`)
)

// DebugMemory è un blocco di memoria del processo in pausa.
type DebugMemory struct {
	Address string `json:"address"`
	Bytes   []int  `json:"bytes"`
	// Error spiega perché la lettura si è fermata prima di length byte (memoria non leggibile).
	Error string `json:"error,omitempty"`
}

// ReadMemory legge la memoria con evaluate `*(*[N]uint8)(addr)`: Delve via DAP non offre readMemory.
func (m *DebugExtensions) ReadMemory(id DebugSessionID, location string, length, frameID int) (DebugMemory, error) {
	location = strings.TrimSpace(location)
	if location == "" {
		return DebugMemory{}, fmt.Errorf("indica un indirizzo (0x…) o un'espressione come &buf[0]")
	}
	length = min(max(length, 1), maxDebugMemory)
	address := location
	if !hexAddress.MatchString(location) {
		result, err := m.Evaluate(id, "uintptr(unsafe.Pointer("+location+"))", frameID, "watch")
		if err != nil {
			return DebugMemory{}, err
		}
		address = evaluatedHex.FindString(result.Result)
		if address == "" {
			return DebugMemory{}, fmt.Errorf("%s non ha un indirizzo leggibile", location)
		}
	}
	start, err := strconv.ParseUint(address[2:], 16, 64)
	if err != nil {
		return DebugMemory{}, fmt.Errorf("indirizzo non valido: %s", address)
	}
	memory := DebugMemory{Address: fmt.Sprintf("0x%x", start), Bytes: []int{}}
	for offset := 0; offset < length; offset += debugMemoryChunk {
		size := min(debugMemoryChunk, length-offset)
		result, err := m.Evaluate(id, fmt.Sprintf("*(*[%d]uint8)(0x%x)", size, start+uint64(offset)), frameID, "watch")
		var chunk []int
		if err == nil {
			chunk, err = parseByteArray(result.Result, size)
		}
		if err != nil {
			memory.Error = fmt.Sprintf("memoria non leggibile a 0x%x: %v", start+uint64(offset), err)
			break
		}
		memory.Bytes = append(memory.Bytes, chunk...)
	}
	if len(memory.Bytes) == 0 && memory.Error != "" {
		return DebugMemory{}, fmt.Errorf("%s", memory.Error)
	}
	return memory, nil
}

// parseByteArray interpreta "[16]uint8 [1,0,255,...]" come restituito da Delve.
func parseByteArray(result string, size int) ([]int, error) {
	open := strings.LastIndex(result, "[")
	if open < 0 || !strings.HasSuffix(result, "]") {
		return nil, fmt.Errorf("%s", strings.TrimSpace(result))
	}
	fields := strings.Split(result[open+1:len(result)-1], ",")
	if len(fields) != size {
		return nil, fmt.Errorf("risposta incompleta: %d byte su %d", len(fields), size)
	}
	values := make([]int, 0, size)
	for _, field := range fields {
		value, err := strconv.Atoi(strings.TrimSpace(field))
		if err != nil || value < 0 || value > 255 {
			return nil, fmt.Errorf("byte non valido %q", field)
		}
		values = append(values, value)
	}
	return values, nil
}
