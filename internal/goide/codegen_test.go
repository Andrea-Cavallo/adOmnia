package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const codegenSource = `package shop

import "time"

// Order è un ordine.
type Order struct {
	ID       string
	customer string
	total    float64
	type_    int
	created  time.Time
}

func (o *Order) Total() float64 { return o.total }

func (o Order) Describe(prefix string) string { return prefix + o.ID }

func Discount(price float64, percent int, code string) float64 {
	return price - price*float64(percent)/100
}

func Sum(values ...int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}
`

func lineContaining(t *testing.T, text, needle string) int {
	t.Helper()
	for index, line := range strings.Split(text, "\n") {
		if strings.Contains(line, needle) {
			return index + 1
		}
	}
	t.Fatalf("%q not found", needle)
	return 0
}

func TestGenerateGoCodeCompiles(t *testing.T) {
	goBinary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go non installato")
	}
	source := codegenSource
	orderLine := func() int { return lineContaining(t, source, "type Order struct") + 2 }
	for _, kind := range []string{"constructor", "getters", "setters", "interface"} {
		result, err := GenerateGoCode(CodeGenRequest{Kind: kind, Text: source, Line: orderLine()})
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		// Il file originale resta identico: il codice generato si inserisce subito dopo la struct.
		structEnd := strings.Index(source, "\n}\n") + 2
		if !strings.HasPrefix(result.Text, source[:structEnd]) || !strings.HasSuffix(result.Text, source[structEnd:]) {
			t.Fatalf("%s must only insert code after the struct", kind)
		}
		source = result.Text
	}
	for _, expected := range []string{"func NewOrder(id string, customer string, total float64, type_ int, created time.Time) *Order", "func (o *Order) Customer() string", "func (o *Order) SetCustomer(customer string)", "Describe(prefix string) string"} {
		if !strings.Contains(source, expected) {
			t.Fatalf("missing %q in:\n%s", expected, source)
		}
	}
	if strings.Contains(source, "func (o *Order) Total() float64 {\n\treturn o.total") {
		t.Fatal("an existing method must not be generated twice")
	}

	testText := ""
	for _, step := range []struct{ kind, needle string }{
		{"benchmark", "func Discount("}, {"fuzz", "func Discount("}, {"benchmark", "func Sum("}, {"benchmark", "func (o Order) Describe("},
	} {
		result, err := GenerateGoCode(CodeGenRequest{Kind: step.kind, Text: source, Line: lineContaining(t, source, step.needle), TestText: testText})
		if err != nil {
			t.Fatalf("%s on %s: %v", step.kind, step.needle, err)
		}
		testText = result.TestText
	}
	if _, err := GenerateGoCode(CodeGenRequest{Kind: "fuzz", Text: source, Line: lineContaining(t, source, "func Sum(") + 1}); err == nil {
		t.Fatal("variadic fuzz target accepted")
	}
	if _, err := GenerateGoCode(CodeGenRequest{Kind: "benchmark", Text: source, Line: lineContaining(t, source, "func Discount("), TestText: testText}); err == nil {
		t.Fatal("duplicate benchmark accepted")
	}

	dir := t.TempDir()
	files := map[string]string{"go.mod": "module example.com/shop\n\ngo 1.22\n", "shop.go": source, "shop_test.go": testText}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{{"vet", "./..."}, {"test", "-run", "^$", "-bench", ".", "-benchtime", "1x", "./..."}, {"test", "-run", "FuzzDiscount", "./..."}} {
		command := exec.Command(goBinary, args...)
		command.Dir = dir
		command.Env = append(os.Environ(), "GOFLAGS=-mod=mod", "GOTOOLCHAIN=local")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("go %v failed: %v\n%s\n--- shop.go\n%s\n--- shop_test.go\n%s", args, err, output, source, testText)
		}
	}
}

func TestParameterNameFollowsGoInitialisms(t *testing.T) {
	for field, want := range map[string]string{"ID": "id", "URLPath": "urlPath", "customer": "customer", "Name": "name", "HTTPClient": "httpClient", "type": "typeValue", "X": "x"} {
		if got := parameterName(field); got != want {
			t.Errorf("parameterName(%q) = %q, want %q", field, got, want)
		}
	}
}

func TestGenerateGoCodeRequiresTheRightTarget(t *testing.T) {
	if _, err := GenerateGoCode(CodeGenRequest{Kind: "constructor", Text: codegenSource, Line: lineContaining(t, codegenSource, "func Sum(")}); err == nil {
		t.Fatal("constructor outside a struct accepted")
	}
	if _, err := GenerateGoCode(CodeGenRequest{Kind: "benchmark", Text: codegenSource, Line: 1}); err == nil {
		t.Fatal("benchmark outside a function accepted")
	}
	if _, err := GenerateGoCode(CodeGenRequest{Kind: "constructor", Text: "package x\nfunc (", Line: 1}); err == nil {
		t.Fatal("syntax errors accepted")
	}
	result, err := GenerateGoCode(CodeGenRequest{Kind: "benchmark", Text: codegenSource, Line: lineContaining(t, codegenSource, "func Discount(") + 1, TestText: "package shop\n\nimport \"fmt\"\n\nvar _ = fmt.Sprint\n"})
	if err != nil || !strings.Contains(result.TestText, "import \"testing\"\nimport \"fmt\"") {
		t.Fatalf("testing import not added to an existing test file: %v\n%s", err, result.TestText)
	}
}
