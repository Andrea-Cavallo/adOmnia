package goide

import (
	"fmt"
	"testing"

	"github.com/google/pprof/profile"
)

// Una location con più righe è una catena di inlining: Line[0] è la funzione più interna.
// Il chiamante inlineato deve comparire nel flame graph e nel cumulativo, come in go tool pprof.
func TestProfileExpandsInlinedFrames(t *testing.T) {
	leaf := &profile.Function{ID: 1, Name: "example.com/app.parse"}
	inlinedCaller := &profile.Function{ID: 2, Name: "example.com/app.handle"}
	root := &profile.Function{ID: 3, Name: "main.main"}
	inlined := &profile.Location{ID: 1, Line: []profile.Line{{Function: leaf, Line: 10}, {Function: inlinedCaller, Line: 20}}}
	mainLoc := &profile.Location{ID: 2, Line: []profile.Line{{Function: root, Line: 5}}}
	report := buildProfileReport("/proj", "/proj/cpu.pprof", &profile.Profile{
		SampleType: []*profile.ValueType{{Type: "cpu", Unit: "nanoseconds"}},
		Sample:     []*profile.Sample{{Location: []*profile.Location{inlined, mainLoc}, Value: []int64{100}}},
	})

	cum := map[string]int64{}
	for _, node := range report.TopCum {
		cum[node.Function.Name] = node.Cum[0]
	}
	if cum["example.com/app.handle"] != 100 {
		t.Fatalf("il chiamante inlineato deve pesare nel cumulativo: %v", cum)
	}
	path := []string{}
	for node := report.Flame; node != nil && len(node.Children) > 0; node = node.Children[0] {
		path = append(path, node.Children[0].Function.Name)
	}
	if fmt.Sprint(path) != "[main.main example.com/app.handle example.com/app.parse]" {
		t.Fatalf("flame graph senza il frame inlineato: %v", path)
	}
	foundEdge := false
	for _, edge := range report.Edges {
		if edge.Caller.Name == "example.com/app.handle" && edge.Callee.Name == "example.com/app.parse" {
			foundEdge = true
		}
	}
	if !foundEdge {
		t.Fatalf("manca l'arco handle → parse: %+v", report.Edges)
	}
}

// Due copie della stessa funzione (ID diversi, es. inlining in punti diversi) nello stesso stack
// non devono contare il campione due volte nel cumulativo.
func TestProfileCumulativeCountsEachFunctionOncePerSample(t *testing.T) {
	first := &profile.Function{ID: 1, Name: "example.com/app.walk"}
	second := &profile.Function{ID: 2, Name: "example.com/app.walk"}
	a := &profile.Location{ID: 1, Line: []profile.Line{{Function: first, Line: 1}}}
	b := &profile.Location{ID: 2, Line: []profile.Line{{Function: second, Line: 2}}}
	report := buildProfileReport("/proj", "/proj/cpu.pprof", &profile.Profile{
		SampleType: []*profile.ValueType{{Type: "cpu", Unit: "nanoseconds"}},
		Sample:     []*profile.Sample{{Location: []*profile.Location{a, b}, Value: []int64{7}}},
	})
	for _, node := range report.TopCum {
		if node.Function.Name == "example.com/app.walk" && node.Cum[0] != 7 {
			t.Fatalf("cumulativo contato più volte: %d", node.Cum[0])
		}
	}
}

// Il Top è limitato, ma ogni tipo di campione (alloc_space, inuse_space…) deve avere i suoi primi.
func TestProfileTopKeepsTheLeadersOfEverySampleType(t *testing.T) {
	samples := []*profile.Sample{}
	for index := 0; index < maxProfileTop+50; index++ {
		fn := &profile.Function{ID: uint64(index + 1), Name: fmt.Sprintf("example.com/app.f%d", index)}
		loc := &profile.Location{ID: uint64(index + 1), Line: []profile.Line{{Function: fn, Line: 1}}}
		// alloc_space è alto solo per l'ultima funzione, inuse_space (l'ultimo tipo) cresce con l'indice.
		alloc := int64(1)
		if index == 0 {
			alloc = 1 << 40
		}
		samples = append(samples, &profile.Sample{Location: []*profile.Location{loc}, Value: []int64{alloc, int64(index + 1)}})
	}
	report := buildProfileReport("/proj", "/proj/mem.pprof", &profile.Profile{
		SampleType: []*profile.ValueType{{Type: "alloc_space", Unit: "bytes"}, {Type: "inuse_space", Unit: "bytes"}},
		Sample:     samples,
	})
	found := false
	for _, node := range report.TopFlat {
		if node.Function.Name == "example.com/app.f0" {
			found = true
		}
	}
	if !found {
		t.Fatal("la funzione che alloca di più è stata tagliata dal Top perché si ordinava solo per inuse_space")
	}
}
