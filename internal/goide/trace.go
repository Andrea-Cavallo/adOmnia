package goide

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/exp/trace"
)

// Go trace: legge i file `trace.out` scritti da `go test -trace` e ne estrae una timeline
// per goroutine, l'attività dello scheduler, GC, syscall, attese su rete e sincronizzazione,
// i goroutine di lunga durata e gli eventi runtime. Nessun processo viene avviato.

const (
	maxTraceGoroutines = 300
	maxTraceSpans      = 2000
	maxTraceProcs      = 128
	maxTraceProcSpans  = 2000
	maxTraceEvents     = 2000
	maxTraceSize       = 512 << 20
)

// TraceFrame è un frame di stack navigabile verso il sorgente.
type TraceFrame struct {
	Function string `json:"function"`
	File     string `json:"file,omitempty"`
	Relative string `json:"relative,omitempty"`
	Line     int    `json:"line,omitempty"`
}

// TraceSpan è un intervallo in cui una risorsa è in uno stato (running, runnable, waiting, syscall).
type TraceSpan struct {
	State  string       `json:"state"`
	Reason string       `json:"reason,omitempty"`
	Start  int64        `json:"start"`
	End    int64        `json:"end"`
	Stack  []TraceFrame `json:"stack,omitempty"`
}

// TraceGoroutine raccoglie la timeline di una goroutine e i tempi per stato.
type TraceGoroutine struct {
	ID         int64        `json:"id"`
	Start      int64        `json:"start"`
	End        int64        `json:"end"`
	Alive      bool         `json:"alive"`
	StartStack []TraceFrame `json:"startStack,omitempty"`
	Spans      []TraceSpan  `json:"spans"`
	Running    int64        `json:"running"`
	Runnable   int64        `json:"runnable"`
	Waiting    int64        `json:"waiting"`
	Syscall    int64        `json:"syscall"`
}

// TraceProc è l'attività di un P dello scheduler: i suoi intervalli di esecuzione.
type TraceProc struct {
	ID      int64       `json:"id"`
	Running int64       `json:"running"`
	Spans   []TraceSpan `json:"spans"`
}

// TraceRange è un intervallo globale (GC, stop-the-world o una regione utente).
type TraceRange struct {
	Kind      string       `json:"kind"`
	Name      string       `json:"name"`
	Start     int64        `json:"start"`
	End       int64        `json:"end"`
	Goroutine int64        `json:"goroutine,omitempty"`
	Stack     []TraceFrame `json:"stack,omitempty"`
}

// TraceEvent è un evento puntuale della timeline (log, task, regione, metrica).
type TraceEvent struct {
	Time      int64        `json:"time"`
	Category  string       `json:"category"`
	Label     string       `json:"label"`
	Goroutine int64        `json:"goroutine,omitempty"`
	Stack     []TraceFrame `json:"stack,omitempty"`
}

// TraceStats riassume la durata totale per categoria.
type TraceStats struct {
	Goroutines  int   `json:"goroutines"`
	Events      int   `json:"events"`
	Running     int64 `json:"running"`
	Runnable    int64 `json:"runnable"`
	Waiting     int64 `json:"waiting"`
	Syscall     int64 `json:"syscall"`
	GC          int64 `json:"gc"`
	GCWait      int64 `json:"gcWait"`
	NetworkWait int64 `json:"networkWait"`
	SyncWait    int64 `json:"syncWait"`
}

// TraceReport è la traccia interpretata, pronta per il viewer del Performance Studio.
type TraceReport struct {
	Path          string           `json:"path"`
	Name          string           `json:"name"`
	DurationNanos int64            `json:"durationNanos"`
	Goroutines    []TraceGoroutine `json:"goroutines"`
	Procs         []TraceProc      `json:"procs"`
	GC            []TraceRange     `json:"gc"`
	Events        []TraceEvent     `json:"events"`
	Stats         TraceStats       `json:"stats"`
	Truncated     bool             `json:"truncated,omitempty"`
}

// ListTraceFiles cerca i file di esecuzione trace (`trace.out`, `*.trace`) dentro il progetto.
func (s *Service) ListTraceFiles(sessionID string) ([]ProfileFile, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	root := session.Project.RealPath
	files := make([]ProfileFile, 0)
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if path != root && (name == ".git" || name == "node_modules" || name == ".adomnia") {
				return filepath.SkipDir
			}
			if strings.Count(relativeWithin(root, path), "/") >= profileScanDepth {
				return filepath.SkipDir
			}
			return nil
		}
		base := strings.ToLower(entry.Name())
		if base != "trace.out" && !strings.HasSuffix(base, ".trace") {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() == 0 || info.Size() > maxTraceSize {
			return nil
		}
		files = append(files, ProfileFile{
			Path:     path,
			Relative: relativeWithin(root, path),
			Name:     entry.Name(),
			Kind:     "trace",
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
		})
		if len(files) >= maxProfileFiles {
			return fs.SkipAll
		}
		return nil
	})
	sort.SliceStable(files, func(i, j int) bool { return files[i].Modified > files[j].Modified })
	return files, nil
}

// LoadTrace interpreta un file trace del progetto in una timeline per il viewer.
func (s *Service) LoadTrace(sessionID, relativePath string) (TraceReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return TraceReport{}, err
	}
	root := session.Project.RealPath
	candidate := filepath.FromSlash(strings.TrimSpace(relativePath))
	if candidate == "" {
		return TraceReport{}, fmt.Errorf("nessuna traccia selezionata")
	}
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	candidate = filepath.Clean(candidate)
	if err := ensureWithinRoot(root, candidate); err != nil {
		return TraceReport{}, fmt.Errorf("traccia fuori dal progetto: %w", err)
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return TraceReport{}, fmt.Errorf("traccia non trovata: %s", relativePath)
	}
	if info.IsDir() || info.Size() == 0 || info.Size() > maxTraceSize {
		return TraceReport{}, fmt.Errorf("traccia non valida o troppo grande (max 512 MB)")
	}
	file, err := os.Open(candidate)
	if err != nil {
		return TraceReport{}, fmt.Errorf("apertura della traccia fallita: %w", err)
	}
	defer file.Close()
	reader, err := trace.NewReader(file)
	if err != nil {
		return TraceReport{}, fmt.Errorf("traccia Go non valida: %w", err)
	}
	report, err := buildTraceReport(root, candidate, reader)
	if err != nil {
		return TraceReport{}, err
	}
	return report, nil
}

type traceGoroutineState struct {
	state  string
	reason string
	start  int64
	stack  []TraceFrame
}

type traceOpenRange struct {
	name      string
	kind      string
	start     int64
	goroutine int64
	stack     []TraceFrame
}

// buildTraceReport consuma gli eventi della traccia e costruisce le timeline.
func buildTraceReport(root, path string, reader *trace.Reader) (TraceReport, error) {
	report := TraceReport{
		Path:       path,
		Name:       filepath.Base(path),
		Goroutines: []TraceGoroutine{},
		Procs:      []TraceProc{},
		GC:         []TraceRange{},
		Events:     []TraceEvent{},
	}
	goroutines := map[int64]*TraceGoroutine{}
	goroutineState := map[int64]*traceGoroutineState{}
	destroyed := map[int64]bool{}
	procs := map[int64]*TraceProc{}
	procState := map[int64]*traceGoroutineState{}
	var openRanges []traceOpenRange

	var first, last int64
	var haveTime bool
	mark := func(t int64) {
		if !haveTime {
			first, last, haveTime = t, t, true
			return
		}
		if t < first {
			first = t
		}
		if t > last {
			last = t
		}
	}

	for {
		event, err := reader.ReadEvent()
		if err == io.EOF {
			break
		}
		if err != nil {
			return TraceReport{}, fmt.Errorf("lettura della traccia fallita: %w", err)
		}
		t := int64(event.Time())
		mark(t)

		switch event.Kind() {
		case trace.EventStateTransition:
			transition := event.StateTransition()
			switch transition.Resource.Kind {
			case trace.ResourceGoroutine:
				id := int64(transition.Resource.Goroutine())
				from, to := transition.Goroutine()
				if to == trace.GoUndetermined {
					continue
				}
				state := goroutineStateName(to)
				if state == "" {
					if to == trace.GoNotExist {
						if goroutine, ok := goroutines[id]; ok {
							if current := goroutineState[id]; current != nil {
								appendGoroutineSpan(goroutine, current, t)
								goroutineState[id] = nil
							}
							goroutine.End = t
						}
						destroyed[id] = true
					}
					continue
				}
				goroutine, ok := goroutines[id]
				if !ok {
					goroutine = &TraceGoroutine{ID: id, Start: t, Alive: true}
					goroutines[id] = goroutine
				}
				if from == trace.GoUndetermined || (from == trace.GoNotExist && to == trace.GoRunnable) {
					goroutine.Start = t
					if len(goroutine.StartStack) == 0 {
						goroutine.StartStack = traceFrames(transition.Stack, root)
					}
				}
				if current := goroutineState[id]; current != nil {
					appendGoroutineSpan(goroutine, current, t)
				}
				next := &traceGoroutineState{state: state, reason: transition.Reason, start: t}
				if state == "waiting" || state == "syscall" {
					next.stack = traceFrames(event.Stack(), root)
				}
				goroutineState[id] = next

			case trace.ResourceProc:
				id := int64(transition.Resource.Proc())
				_, to := transition.Proc()
				proc, ok := procs[id]
				if !ok {
					proc = &TraceProc{ID: id}
					procs[id] = proc
				}
				if to == trace.ProcRunning {
					if procState[id] == nil {
						procState[id] = &traceGoroutineState{state: "running", start: t}
					}
				} else if current := procState[id]; current != nil {
					appendProcSpan(proc, current, t)
					procState[id] = nil
				}
			}

		case trace.EventRangeBegin:
			r := event.Range()
			openRanges = append(openRanges, traceOpenRange{
				name: r.Name, kind: traceRangeKind(r.Name), start: t, goroutine: int64(event.Goroutine()), stack: traceFrames(event.Stack(), root),
			})

		case trace.EventRangeActive:
			r := event.Range()
			report.Events = appendTraceEvent(report.Events, TraceEvent{Time: t, Category: "region", Label: r.Name + " (active)", Goroutine: int64(event.Goroutine()), Stack: traceFrames(event.Stack(), root)})

		case trace.EventRangeEnd:
			r := event.Range()
			for i := len(openRanges) - 1; i >= 0; i-- {
				if openRanges[i].name != r.Name {
					continue
				}
				opened := openRanges[i]
				openRanges = append(openRanges[:i], openRanges[i+1:]...)
				if opened.kind == "gc" || opened.kind == "stw" {
					report.GC = append(report.GC, TraceRange{Kind: opened.kind, Name: opened.name, Start: opened.start, End: t, Goroutine: opened.goroutine, Stack: opened.stack})
				} else {
					report.Events = appendTraceEvent(report.Events, TraceEvent{Time: t, Category: "region", Label: opened.name, Goroutine: opened.goroutine, Stack: opened.stack})
				}
				break
			}

		case trace.EventLog:
			log := event.Log()
			label := strings.TrimSpace(strings.Trim(strings.Join([]string{log.Category, log.Message}, ": "), ": "))
			report.Events = appendTraceEvent(report.Events, TraceEvent{Time: t, Category: "log", Label: label, Goroutine: int64(event.Goroutine()), Stack: traceFrames(event.Stack(), root)})

		case trace.EventTaskBegin:
			task := event.Task()
			report.Events = appendTraceEvent(report.Events, TraceEvent{Time: t, Category: "task", Label: task.Type, Goroutine: int64(event.Goroutine())})
		}
	}

	report.DurationNanos = last - first
	for _, goroutine := range goroutines {
		if current := goroutineState[goroutine.ID]; current != nil {
			appendGoroutineSpan(goroutine, current, last)
		}
		if goroutine.Alive && goroutine.End == 0 {
			goroutine.End = last
		}
	}
	for _, proc := range procs {
		if current := procState[proc.ID]; current != nil {
			appendProcSpan(proc, current, last)
		}
	}
	for _, opened := range openRanges {
		if opened.kind == "gc" || opened.kind == "stw" {
			report.GC = append(report.GC, TraceRange{Kind: opened.kind, Name: opened.name, Start: opened.start, End: last, Goroutine: opened.goroutine, Stack: opened.stack})
		}
	}

	// Statistiche: le goroutine chiuse al termine non sono "alive".
	for _, goroutine := range goroutines {
		if goroutine.End != last || goroutineState[goroutine.ID] != nil {
			goroutine.Alive = goroutineState[goroutine.ID] != nil
		} else {
			goroutine.Alive = false
		}
	}

	report.Goroutines = summarizeGoroutines(goroutines)
	report.Procs = summarizeProcs(procs)
	sort.SliceStable(report.GC, func(i, j int) bool { return report.GC[i].Start < report.GC[j].Start })
	sort.SliceStable(report.Events, func(i, j int) bool { return report.Events[i].Time < report.Events[j].Time })
	report.Stats.Goroutines = len(goroutines)
	report.Stats.Events = len(report.Events)
	for _, goroutine := range report.Goroutines {
		report.Stats.Running += goroutine.Running
		report.Stats.Runnable += goroutine.Runnable
		report.Stats.Waiting += goroutine.Waiting
		report.Stats.Syscall += goroutine.Syscall
		for _, span := range goroutine.Spans {
			duration := span.End - span.Start
			if span.State == "waiting" {
				if isNetworkReason(span.Reason) {
					report.Stats.NetworkWait += duration
				}
				if isSyncReason(span.Reason) {
					report.Stats.SyncWait += duration
				}
				if isGCReason(span.Reason) {
					report.Stats.GCWait += duration
				}
			}
		}
	}
	for _, span := range report.GC {
		if span.Kind == "gc" {
			report.Stats.GC += span.End - span.Start
		}
	}
	return report, nil
}

func goroutineStateName(state trace.GoState) string {
	switch state {
	case trace.GoRunning:
		return "running"
	case trace.GoRunnable:
		return "runnable"
	case trace.GoWaiting:
		return "waiting"
	case trace.GoSyscall:
		return "syscall"
	default:
		return ""
	}
}

func appendGoroutineSpan(goroutine *TraceGoroutine, current *traceGoroutineState, end int64) {
	if current == nil || end < current.start {
		return
	}
	duration := end - current.start
	if len(goroutine.Spans) < maxTraceSpans {
		goroutine.Spans = append(goroutine.Spans, TraceSpan{State: current.state, Reason: current.reason, Start: current.start, End: end, Stack: current.stack})
	}
	switch current.state {
	case "running":
		goroutine.Running += duration
	case "runnable":
		goroutine.Runnable += duration
	case "waiting":
		goroutine.Waiting += duration
	case "syscall":
		goroutine.Syscall += duration
	}
}

func appendProcSpan(proc *TraceProc, current *traceGoroutineState, end int64) {
	if current == nil || end < current.start {
		return
	}
	proc.Running += end - current.start
	if len(proc.Spans) < maxTraceProcSpans {
		proc.Spans = append(proc.Spans, TraceSpan{State: "running", Start: current.start, End: end})
	}
}

func appendTraceEvent(events []TraceEvent, event TraceEvent) []TraceEvent {
	if len(events) >= maxTraceEvents {
		return events
	}
	return append(events, event)
}

func summarizeGoroutines(source map[int64]*TraceGoroutine) []TraceGoroutine {
	goroutines := make([]TraceGoroutine, 0, len(source))
	for _, goroutine := range source {
		goroutines = append(goroutines, *goroutine)
	}
	sort.SliceStable(goroutines, func(i, j int) bool {
		left := goroutines[i].Running + goroutines[i].Waiting + goroutines[i].Syscall
		right := goroutines[j].Running + goroutines[j].Waiting + goroutines[j].Syscall
		return left > right
	})
	if len(goroutines) > maxTraceGoroutines {
		goroutines = goroutines[:maxTraceGoroutines]
	}
	for index := range goroutines {
		sort.SliceStable(goroutines[index].Spans, func(i, j int) bool { return goroutines[index].Spans[i].Start < goroutines[index].Spans[j].Start })
	}
	return goroutines
}

func summarizeProcs(source map[int64]*TraceProc) []TraceProc {
	procs := make([]TraceProc, 0, len(source))
	for _, proc := range source {
		procs = append(procs, *proc)
	}
	sort.SliceStable(procs, func(i, j int) bool { return procs[i].ID < procs[j].ID })
	if len(procs) > maxTraceProcs {
		procs = procs[:maxTraceProcs]
	}
	for index := range procs {
		sort.SliceStable(procs[index].Spans, func(i, j int) bool { return procs[index].Spans[i].Start < procs[index].Spans[j].Start })
	}
	return procs
}

func traceFrames(stack trace.Stack, root string) []TraceFrame {
	frames := []TraceFrame{}
	for frame := range stack.Frames() {
		frames = append(frames, TraceFrame{
			Function: frame.Func,
			File:     frame.File,
			Relative: relativeWithin(root, frame.File),
			Line:     int(frame.Line),
		})
		if len(frames) >= 64 {
			break
		}
	}
	return frames
}

func traceRangeKind(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "stw"):
		return "stw"
	case strings.Contains(lower, "gc"):
		return "gc"
	default:
		return "user"
	}
}

func isNetworkReason(reason string) bool {
	lower := strings.ToLower(reason)
	return strings.Contains(lower, "network") || strings.Contains(lower, "poll")
}

func isSyncReason(reason string) bool {
	lower := strings.ToLower(reason)
	for _, marker := range []string{"chan", "sync", "select", "mutex", "semacquire", "waitgroup"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func isGCReason(reason string) bool {
	return strings.Contains(strings.ToLower(reason), "gc")
}
