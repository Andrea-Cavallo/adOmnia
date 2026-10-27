package java

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// Monitoraggio delle JVM in esecuzione con gli strumenti del JDK (jcmd, jstat): nessun agente da installare e
// nessun processo a riposo; si lancia solo su richiesta dell'utente e per il tempo in cui guarda.

const jvmToolTimeout = 10 * time.Second

// JVMProcess è una JVM locale trovata da `jcmd -l`.
type JVMProcess struct {
	PID       int    `json:"pid"`
	MainClass string `json:"mainClass"`
	// Args sono gli argomenti dopo la classe (spesso il goal Maven o il jar).
	Args string `json:"args,omitempty"`
}

// JVMHeapSample è un campionamento di `jstat -gc`: memoria in KB e conteggi/tempi del GC.
type JVMHeapSample struct {
	// HeapUsedKB e HeapCapacityKB sommano giovane (survivor + eden) e vecchia generazione; il metaspace è escluso.
	HeapUsedKB     float64 `json:"heapUsedKb"`
	HeapCapacityKB float64 `json:"heapCapacityKb"`
	YoungUsedKB    float64 `json:"youngUsedKb"`
	OldUsedKB      float64 `json:"oldUsedKb"`
	YoungGCs       float64 `json:"youngGcs"`
	YoungGCSeconds float64 `json:"youngGcSeconds"`
	FullGCs        float64 `json:"fullGcs"`
	FullGCSeconds  float64 `json:"fullGcSeconds"`
	// UptimeSeconds è il Timestamp di jstat: da quanto tempo gira la JVM.
	UptimeSeconds float64 `json:"uptimeSeconds"`
}

var jcmdLine = regexp.MustCompile(`^(\d+)\s+(\S+)\s*(.*)$`)

// ParseJcmdList legge l'output di `jcmd -l`, escludendo jcmd stesso.
func ParseJcmdList(output string) []JVMProcess {
	var found []JVMProcess
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		match := jcmdLine.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil || strings.Contains(match[2], "jcmd.JCmd") {
			continue
		}
		pid, err := strconv.Atoi(match[1])
		if err != nil {
			continue
		}
		found = append(found, JVMProcess{PID: pid, MainClass: match[2], Args: strings.TrimSpace(match[3])})
	}
	return found
}

// ParseJstatGC legge `jstat -gc -t`: un'intestazione con i nomi delle colonne e una riga di valori.
func ParseJstatGC(output string) (JVMHeapSample, error) {
	var header, values []string
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if header == nil {
			header = fields
		} else {
			values = fields
		}
	}
	if header == nil || len(values) != len(header) {
		return JVMHeapSample{}, fmt.Errorf("unexpected jstat output")
	}
	column := map[string]float64{}
	for index, name := range header {
		if number, err := strconv.ParseFloat(strings.ReplaceAll(values[index], ",", "."), 64); err == nil {
			column[name] = number
		}
	}
	for _, name := range []string{"S0U", "S1U", "EU", "OU", "S0C", "S1C", "EC", "OC"} {
		if _, ok := column[name]; !ok {
			return JVMHeapSample{}, fmt.Errorf("jstat did not report %s", name)
		}
	}
	young := column["S0U"] + column["S1U"] + column["EU"]
	return JVMHeapSample{
		HeapUsedKB: young + column["OU"], HeapCapacityKB: column["S0C"] + column["S1C"] + column["EC"] + column["OC"],
		YoungUsedKB: young, OldUsedKB: column["OU"],
		YoungGCs: column["YGC"], YoungGCSeconds: column["YGCT"], FullGCs: column["FGC"], FullGCSeconds: column["FGCT"],
		UptimeSeconds: column["Timestamp"],
	}, nil
}

// jdkTool è il percorso di uno strumento del JDK: quello della home indicata, altrimenti quello del JDK trovato.
func jdkTool(javaHome, name string) (string, error) {
	if javaHome == "" {
		javaHome = DetectJDK().Home
	}
	if javaHome != "" {
		if path := filepath.Join(javaHome, "bin", sdk.ExecutableName(name)); isFile(path) {
			return path, nil
		}
	}
	if found, err := lookPath(name); err == nil {
		return found, nil
	}
	return "", fmt.Errorf("%s was not found: it ships with a JDK (not a JRE)", name)
}

func runJDKTool(javaHome, name string, arguments ...string) (string, error) {
	tool, err := jdkTool(javaHome, name)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), jvmToolTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, tool, arguments...)
	process.Configure(command, false)
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	err = command.Run()
	if ctx.Err() != nil {
		return "", fmt.Errorf("%s did not answer in %s", name, jvmToolTimeout)
	}
	if err != nil {
		return "", fmt.Errorf("%s failed: %s", name, strings.TrimSpace(output.String()))
	}
	return output.String(), nil
}

// ListJVMs elenca le JVM dell'utente con `jcmd -l`.
func ListJVMs(javaHome string) ([]JVMProcess, error) {
	output, err := runJDKTool(javaHome, "jcmd", "-l")
	if err != nil {
		return nil, err
	}
	return ParseJcmdList(output), nil
}

// SampleJVM legge lo stato del GC di una JVM con `jstat -gc -t`.
func SampleJVM(javaHome string, pid int) (JVMHeapSample, error) {
	if pid <= 0 {
		return JVMHeapSample{}, fmt.Errorf("invalid process id")
	}
	output, err := runJDKTool(javaHome, "jstat", "-gc", "-t", strconv.Itoa(pid))
	if err != nil {
		return JVMHeapSample{}, err
	}
	return ParseJstatGC(output)
}

// jfrRecordings sono le registrazioni avviate da adOmnia: nome JFR → file.
var jfrName = regexp.MustCompile(`^adomnia-[0-9]+$`)

// StartJFR avvia una registrazione JFR (`jcmd <pid> JFR.start`) e restituisce nome e file di destinazione.
func StartJFR(javaHome string, pid int) (name, file string, err error) {
	if pid <= 0 {
		return "", "", fmt.Errorf("invalid process id")
	}
	directory, err := os.MkdirTemp("", "adomnia-jfr-")
	if err != nil {
		return "", "", fmt.Errorf("temporary JFR folder unavailable: %w", err)
	}
	name = "adomnia-" + strconv.Itoa(pid)
	file = filepath.Join(directory, fmt.Sprintf("%s-%d.jfr", name, time.Now().Unix()))
	if _, err := runJDKTool(javaHome, "jcmd", strconv.Itoa(pid), "JFR.start", "name="+name, "filename="+file, "settings=profile"); err != nil {
		return "", "", err
	}
	return name, file, nil
}

// StopJFR ferma la registrazione e scrive il file indicato.
func StopJFR(javaHome string, pid int, name string) error {
	if pid <= 0 || !jfrName.MatchString(name) {
		return fmt.Errorf("invalid recording")
	}
	_, err := runJDKTool(javaHome, "jcmd", strconv.Itoa(pid), "JFR.stop", "name="+name)
	return err
}
