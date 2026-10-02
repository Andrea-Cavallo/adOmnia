package goide

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/google/pprof/profile"
)

// Performance Studio: legge i profili pprof scritti da `go test -cpuprofile/-memprofile/...`
// e li trasforma in un report navigabile (top, flame graph, call graph, costo per riga).
// Nessun processo viene avviato e nessun file esce dal progetto.

const (
	// Un profilo di un monorepo può essere grande: si tagliano le liste per non saturare l'IPC.
	maxProfileTop    = 500
	maxProfileFlame  = 20000
	maxProfileEdges  = 20000
	maxProfileLines  = 4000
	maxProfileFiles  = 200
	maxProfileSize   = 512 << 20 // 512 MB: oltre, non è un profilo ragionevole
	profileScanDepth = 8
)

// ProfileSampleType è una grandezza campionata dal profilo (cpu/nanoseconds, inuse_space/bytes…).
type ProfileSampleType struct {
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// ProfileFunction è una funzione del profilo, già pronta per la UI e per il salto al sorgente.
type ProfileFunction struct {
	Name     string `json:"name"`
	Short    string `json:"short"`
	Package  string `json:"package"`
	File     string `json:"file,omitempty"`
	Relative string `json:"relative,omitempty"`
	Line     int    `json:"line,omitempty"`
	Runtime  bool   `json:"runtime,omitempty"`
}

// ProfileNode è una riga della vista Top: valore piatto (flat) e cumulativo (cum) per ogni sample type.
type ProfileNode struct {
	Function ProfileFunction `json:"function"`
	Flat     []int64         `json:"flat"`
	Cum      []int64         `json:"cum"`
}

// ProfileFlame è il nodo di un flame graph o di una vista icicle; Value è allineato ai sample type.
type ProfileFlame struct {
	Function ProfileFunction `json:"function"`
	Value    []int64         `json:"value"`
	Children []*ProfileFlame `json:"children,omitempty"`
}

// ProfileEdge è un arco del call graph (Caller chiama Callee) con il valore aggregato.
type ProfileEdge struct {
	Caller ProfileFunction `json:"caller"`
	Callee ProfileFunction `json:"callee"`
	Value  []int64         `json:"value"`
}

// ProfileLine è il costo per riga di sorgente, per la heatmap nel codice.
type ProfileLine struct {
	File     string  `json:"file"`
	Relative string  `json:"relative,omitempty"`
	Line     int     `json:"line"`
	Value    []int64 `json:"value"`
}

// ProfileReport è il profilo interpretato, pronto per le viste del Performance Studio.
type ProfileReport struct {
	Path          string              `json:"path"`
	Name          string              `json:"name"`
	Kind          string              `json:"kind"`
	DurationNanos int64               `json:"durationNanos"`
	PeriodType    ProfileSampleType   `json:"periodType"`
	Period        int64               `json:"period"`
	Time          string              `json:"time"`
	SampleTypes   []ProfileSampleType `json:"sampleTypes"`
	Totals        []int64             `json:"totals"`
	Samples       int                 `json:"samples"`
	TopFlat       []ProfileNode       `json:"topFlat"`
	TopCum        []ProfileNode       `json:"topCum"`
	Flame         *ProfileFlame       `json:"flame"`
	Edges         []ProfileEdge       `json:"edges"`
	Lines         []ProfileLine       `json:"lines"`
	Truncated     bool                `json:"truncated,omitempty"`
}

// ProfileFile è un profilo trovato nel progetto, candidato da aprire nel Performance Studio.
type ProfileFile struct {
	Path     string `json:"path"`
	Relative string `json:"relative"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

// ListProfileFiles cerca i profili pprof (*.pprof) dentro il progetto, ignorando .git e node_modules.
func (s *Service) ListProfileFiles(sessionID string) ([]ProfileFile, error) {
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
		if !strings.EqualFold(filepath.Ext(path), ".pprof") {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() == 0 || info.Size() > maxProfileSize {
			return nil
		}
		files = append(files, ProfileFile{
			Path:     path,
			Relative: relativeWithin(root, path),
			Name:     entry.Name(),
			Kind:     profileKind(entry.Name()),
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

// LoadProfile interpreta un file pprof del progetto. relativePath può essere relativo o assoluto,
// ma deve restare dentro il progetto.
func (s *Service) LoadProfile(sessionID, relativePath string) (ProfileReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ProfileReport{}, err
	}
	root := session.Project.RealPath
	candidate := filepath.FromSlash(strings.TrimSpace(relativePath))
	if candidate == "" {
		return ProfileReport{}, fmt.Errorf("nessun profilo selezionato")
	}
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	candidate = filepath.Clean(candidate)
	if err := ensureWithinRoot(root, candidate); err != nil {
		return ProfileReport{}, fmt.Errorf("profilo fuori dal progetto: %w", err)
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return ProfileReport{}, fmt.Errorf("profilo non trovato: %s", relativePath)
	}
	if info.IsDir() || info.Size() == 0 || info.Size() > maxProfileSize {
		return ProfileReport{}, fmt.Errorf("profilo non valido o troppo grande (max 512 MB)")
	}
	data, err := os.ReadFile(candidate)
	if err != nil {
		return ProfileReport{}, fmt.Errorf("lettura del profilo fallita: %w", err)
	}
	parsed, err := profile.ParseData(data)
	if err != nil {
		return ProfileReport{}, fmt.Errorf("profilo pprof non valido: %w", err)
	}
	return buildProfileReport(root, candidate, parsed), nil
}

func profileKind(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "cpu"):
		return "cpu"
	case strings.Contains(lower, "heap"):
		return "heap"
	case strings.Contains(lower, "mem"):
		return "heap"
	case strings.Contains(lower, "block"):
		return "block"
	case strings.Contains(lower, "mutex"):
		return "mutex"
	case strings.Contains(lower, "goroutine"):
		return "goroutine"
	case strings.Contains(lower, "threadcreate"):
		return "threadcreate"
	default:
		return "profile"
	}
}

type functionAgg struct {
	function ProfileFunction
	flat     []int64
	cum      []int64
}

// buildProfileReport aggrega campioni e stack in liste e alberi pronti per la UI.
func buildProfileReport(root, path string, p *profile.Profile) ProfileReport {
	report := ProfileReport{
		Path:          path,
		Name:          filepath.Base(path),
		Kind:          profileKind(filepath.Base(path)),
		DurationNanos: p.DurationNanos,
		Period:        p.Period,
		SampleTypes:   make([]ProfileSampleType, len(p.SampleType)),
		Totals:        make([]int64, len(p.SampleType)),
		Samples:       len(p.Sample),
		TopFlat:       []ProfileNode{},
		TopCum:        []ProfileNode{},
		Edges:         []ProfileEdge{},
		Lines:         []ProfileLine{},
	}
	if p.PeriodType != nil {
		report.PeriodType = ProfileSampleType{Name: p.PeriodType.Type, Unit: p.PeriodType.Unit}
	}
	if p.TimeNanos > 0 {
		report.Time = time.Unix(0, p.TimeNanos).UTC().Format(time.RFC3339)
	}
	for i, st := range p.SampleType {
		report.SampleTypes[i] = ProfileSampleType{Name: st.Type, Unit: st.Unit}
	}
	width := len(p.SampleType)

	flat := map[string]*functionAgg{}
	cum := map[string]*functionAgg{}
	cumSeen := map[string]bool{}
	edgeAgg := map[[2]string]*ProfileEdge{}
	lineAgg := map[string]*ProfileLine{}
	rootFlame := &ProfileFlame{Value: make([]int64, width)}
	flameChildren := map[*ProfileFlame]map[string]*ProfileFlame{rootFlame: {}}
	flameCount := 0
	described := map[*profile.Function]ProfileFunction{}

	type frame struct {
		fn   ProfileFunction
		line int
	}
	for _, sample := range p.Sample {
		value := make([]int64, width)
		copy(value, sample.Value)
		for i := range value {
			report.Totals[i] += value[i]
		}
		// Una location con più righe è una catena di inlining (Line[0] la più interna): come go tool
		// pprof, ogni riga è un frame. stack[0] è la foglia, l'ultimo elemento la radice.
		stack := make([]frame, 0, len(sample.Location))
		for _, loc := range sample.Location {
			for _, line := range loc.Line {
				if line.Function == nil {
					continue
				}
				fn, ok := described[line.Function]
				if !ok {
					fn = describeProfileFunction(line.Function, root)
					described[line.Function] = fn
				}
				stack = append(stack, frame{fn: fn, line: int(line.Line)})
			}
		}
		if len(stack) == 0 {
			continue
		}
		// flat: il campione pesa sulla foglia.
		aggregate(flat, stack[0].fn, value, true)
		// cum: ogni funzione (per nome, così ricorsione e copie inlineate contano una volta) paga una volta.
		clear(cumSeen)
		for _, item := range stack {
			if cumSeen[item.fn.Name] {
				continue
			}
			cumSeen[item.fn.Name] = true
			aggregate(cum, item.fn, value, false)
		}
		// edge: callee = stack[i], caller = stack[i+1].
		for i := 0; i+1 < len(stack); i++ {
			key := [2]string{stack[i+1].fn.Name, stack[i].fn.Name}
			edge, exists := edgeAgg[key]
			if !exists {
				if len(edgeAgg) >= maxProfileEdges {
					report.Truncated = true
					continue
				}
				edge = &ProfileEdge{Caller: stack[i+1].fn, Callee: stack[i].fn, Value: make([]int64, width)}
				edgeAgg[key] = edge
			}
			addValue(edge.Value, value)
		}
		// line: costo per riga della foglia.
		leaf := stack[0]
		lineKey := leaf.fn.File + ":" + fmt.Sprint(leaf.line)
		entry, exists := lineAgg[lineKey]
		if !exists {
			if len(lineAgg) >= maxProfileLines {
				report.Truncated = true
			} else {
				entry = &ProfileLine{File: leaf.fn.File, Relative: leaf.fn.Relative, Line: leaf.line, Value: make([]int64, width)}
				lineAgg[lineKey] = entry
			}
		}
		if entry != nil {
			addValue(entry.Value, value)
		}
		// flame: dalla radice (ultimo frame) alla foglia (primo frame).
		node := rootFlame
		for i := len(stack) - 1; i >= 0; i-- {
			children := flameChildren[node]
			child, exists := children[stack[i].fn.Name]
			if !exists {
				if flameCount >= maxProfileFlame {
					report.Truncated = true
					break
				}
				child = &ProfileFlame{Function: stack[i].fn, Value: make([]int64, width)}
				children[stack[i].fn.Name] = child
				flameChildren[child] = map[string]*ProfileFlame{}
				flameCount++
			}
			addValue(child.Value, value)
			node = child
		}
	}

	report.TopFlat = topNodes(flat, true)
	report.TopCum = topNodes(cum, false)
	report.Edges = sortEdges(edgeAgg)
	report.Lines = sortLines(lineAgg)
	report.Flame = sortFlame(rootFlame, flameChildren)
	return report
}

func aggregate(target map[string]*functionAgg, fn ProfileFunction, value []int64, flat bool) {
	// L'aggregazione è per nome: funzioni inlineate condividono il nome ma hanno ID diversi.
	entry, exists := target[fn.Name]
	if !exists {
		entry = &functionAgg{function: fn, flat: make([]int64, len(value)), cum: make([]int64, len(value))}
		target[fn.Name] = entry
	}
	if flat {
		addValue(entry.flat, value)
	} else {
		addValue(entry.cum, value)
	}
}

// topNodes restituisce i nodi più pesanti. Il limite vale per ogni tipo di campione: l'unione dei
// primi maxProfileTop di ciascuno, così cambiare tipo (alloc_space, inuse_space…) non perde i leader.
func topNodes(source map[string]*functionAgg, flat bool) []ProfileNode {
	nodes := make([]ProfileNode, 0, len(source))
	for _, entry := range source {
		nodes = append(nodes, ProfileNode{Function: entry.function, Flat: entry.flat, Cum: entry.cum})
	}
	valueAt := func(node ProfileNode, index int) int64 {
		values := node.Cum
		if flat {
			values = node.Flat
		}
		if index < len(values) {
			return values[index]
		}
		return 0
	}
	if len(nodes) > maxProfileTop {
		width := 0
		if len(nodes) > 0 {
			width = len(nodes[0].Flat)
		}
		keep := map[string]bool{}
		for index := 0; index < width; index++ {
			sort.SliceStable(nodes, func(i, j int) bool { return valueAt(nodes[i], index) > valueAt(nodes[j], index) })
			for _, node := range nodes[:maxProfileTop] {
				keep[node.Function.Name] = true
			}
		}
		kept := nodes[:0]
		for _, node := range nodes {
			if keep[node.Function.Name] {
				kept = append(kept, node)
			}
		}
		nodes = kept
	}
	sort.SliceStable(nodes, func(i, j int) bool {
		return primaryValue(nodes[i], flat) > primaryValue(nodes[j], flat)
	})
	return nodes
}

func primaryValue(node ProfileNode, flat bool) int64 {
	values := node.Cum
	if flat {
		values = node.Flat
	}
	if len(values) == 0 {
		return 0
	}
	return values[len(values)-1]
}

func sortEdges(source map[[2]string]*ProfileEdge) []ProfileEdge {
	edges := make([]ProfileEdge, 0, len(source))
	for _, edge := range source {
		edges = append(edges, *edge)
	}
	sort.SliceStable(edges, func(i, j int) bool {
		return lastValue(edges[i].Value) > lastValue(edges[j].Value)
	})
	return edges
}

func sortLines(source map[string]*ProfileLine) []ProfileLine {
	lines := make([]ProfileLine, 0, len(source))
	for _, line := range source {
		lines = append(lines, *line)
	}
	sort.SliceStable(lines, func(i, j int) bool {
		return lastValue(lines[i].Value) > lastValue(lines[j].Value)
	})
	return lines
}

func sortFlame(node *ProfileFlame, children map[*ProfileFlame]map[string]*ProfileFlame) *ProfileFlame {
	if node == nil {
		return nil
	}
	childMap := children[node]
	if len(childMap) > 0 {
		node.Children = make([]*ProfileFlame, 0, len(childMap))
		for _, child := range childMap {
			node.Children = append(node.Children, sortFlame(child, children))
		}
		sort.SliceStable(node.Children, func(i, j int) bool {
			return lastValue(node.Children[i].Value) > lastValue(node.Children[j].Value)
		})
	}
	return node
}

func addValue(target, value []int64) {
	for i := range target {
		if i < len(value) {
			target[i] += value[i]
		}
	}
}

func lastValue(value []int64) int64 {
	if len(value) == 0 {
		return 0
	}
	return value[len(value)-1]
}

// describeProfileFunction normalizza nome, package e percorso per la UI.
func describeProfileFunction(fn *profile.Function, root string) ProfileFunction {
	name := fn.Name
	if name == "" {
		name = fn.SystemName
	}
	tail, prefix := name, ""
	if index := strings.LastIndex(name, "/"); index >= 0 {
		prefix, tail = name[:index+1], name[index+1:]
	}
	pkg, short := prefix, tail
	if index := strings.Index(tail, "."); index >= 0 {
		pkg, short = prefix+tail[:index], tail[index+1:]
	}
	result := ProfileFunction{
		Name:     name,
		Short:    short,
		Package:  pkg,
		File:     fn.Filename,
		Relative: relativeWithin(root, fn.Filename),
		Line:     int(fn.StartLine),
		Runtime:  isRuntimeProfileFunction(fn),
	}
	return result
}

func isRuntimeProfileFunction(fn *profile.Function) bool {
	if strings.HasPrefix(fn.Name, "runtime.") {
		return true
	}
	goRoot := runtime.GOROOT()
	if goRoot == "" || fn.Filename == "" {
		return false
	}
	cleanRoot := filepath.Clean(goRoot)
	cleanFile := filepath.Clean(fn.Filename)
	return cleanFile == cleanRoot || strings.HasPrefix(cleanFile, cleanRoot+string(filepath.Separator))
}
