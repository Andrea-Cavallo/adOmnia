//go:build !windows

package resources

import (
	"context"

	"github.com/shirou/gopsutil/v4/process"
)

// processTable legge padre e nome di tutti i processi una volta per campione. Children di gopsutil su
// Linux e macOS lancia `pgrep -P` per ogni nodo dell'albero.
func processTable() (map[int32]processInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), sampleTimeout)
	defer cancel()
	processes, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	table := make(map[int32]processInfo, len(processes))
	for _, p := range processes {
		parent, err := p.PpidWithContext(ctx)
		if err != nil {
			continue
		}
		name, _ := p.NameWithContext(ctx)
		table[p.Pid] = processInfo{parent: parent, name: name}
	}
	return table, nil
}
