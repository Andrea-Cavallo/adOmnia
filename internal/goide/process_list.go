package goide

import (
	"bufio"
	"context"
	"encoding/csv"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	maxListedProcesses = 2000
	processListTimeout = 5 * time.Second
)

// ProcessInfo descrive un processo locale a cui il debugger può agganciarsi.
type ProcessInfo struct {
	PID     int    `json:"pid"`
	Name    string `json:"name"`
	Command string `json:"command,omitempty"`
}

// ListProcesses elenca i processi della macchina per "Attach to Process": solo lettura, nessun effetto.
func (s *Service) ListProcesses() ([]ProcessInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), processListTimeout)
	defer cancel()
	var processes []ProcessInfo
	var err error
	if runtime.GOOS == "windows" {
		processes, err = listWindowsProcesses(ctx)
	} else {
		processes, err = listUnixProcesses(ctx)
	}
	if err != nil {
		return nil, err
	}
	own := os.Getpid()
	result := make([]ProcessInfo, 0, len(processes))
	for _, process := range processes {
		if process.PID > 0 && process.PID != own {
			result = append(result, process)
		}
	}
	sort.Slice(result, func(left, right int) bool { return result[left].PID > result[right].PID })
	if len(result) > maxListedProcesses {
		result = result[:maxListedProcesses]
	}
	return result, nil
}

func listUnixProcesses(ctx context.Context) ([]ProcessInfo, error) {
	command := exec.CommandContext(ctx, "ps", "-Ao", "pid=,comm=,args=")
	configureProcess(command, false)
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	processes := make([]ProcessInfo, 0, 256)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		name := fields[1]
		if slash := strings.LastIndex(name, "/"); slash >= 0 {
			name = name[slash+1:]
		}
		processes = append(processes, ProcessInfo{PID: pid, Name: name, Command: strings.Join(fields[2:], " ")})
	}
	return processes, scanner.Err()
}

func listWindowsProcesses(ctx context.Context) ([]ProcessInfo, error) {
	command := exec.CommandContext(ctx, "tasklist", "/FO", "CSV", "/NH")
	configureProcess(command, false)
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	records, err := csv.NewReader(strings.NewReader(string(output))).ReadAll()
	if err != nil {
		return nil, err
	}
	processes := make([]ProcessInfo, 0, len(records))
	for _, record := range records {
		if len(record) < 2 {
			continue
		}
		if pid, err := strconv.Atoi(record[1]); err == nil {
			processes = append(processes, ProcessInfo{PID: pid, Name: record[0]})
		}
	}
	return processes, nil
}
