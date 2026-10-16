package goide

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func moveFixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go non disponibile")
	}
	root := filepath.Join(t.TempDir(), "shop")
	files := map[string]string{
		"go.mod": "module example.com/shop\n\ngo 1.22\n",
		"money/money.go": `package money

import "fmt"

// Format scrive i centesimi come euro.
func Format(cents int) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100) + "€"
}

// Currency è il simbolo della valuta.
const Currency = "€"

// Label usa una costante esportata del package.
func Label() string { return "price in " + Currency }

func round(cents int) int { return cents }

// Rounded usa un helper non esportato.
func Rounded(cents int) int { return round(cents) }

// Price è un importo con i suoi metodi.
type Price struct{ Cents int }

func (p Price) String() string { return Format(p.Cents) }
`,
		"money/money_test.go": `package money

import "testing"

func TestFormat(t *testing.T) {
	if Format(250) != "2.50€" {
		t.Fatal(Format(250))
	}
}
`,
		"orders/orders.go": `package orders

import "example.com/shop/money"

// Total formatta il totale di un ordine.
func Total() string { return money.Format(250) + money.Price{Cents: 1}.String() + money.Label() }
`,
	}
	for name, content := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if info, err := service.DetectToolchain(id); err != nil || !info.Available {
		t.Fatalf("toolchain non disponibile: %v", err)
	}
	return service, id, root
}

func changedFiles(change WorkspaceChange) map[string]FileChange {
	result := map[string]FileChange{}
	for _, file := range change.Files {
		result[file.RelativePath] = file
	}
	return result
}

func TestMoveFunctionToNewPackageRewritesEveryReference(t *testing.T) {
	service, id, _ := moveFixture(t)
	change, err := service.MoveSymbol(id, MoveSymbolRequest{RelativePath: "money/money.go", Line: 6, Column: 7, TargetDirectory: "format"})
	if err != nil {
		t.Fatal(err)
	}
	files := changedFiles(change)
	created := files["format/format.go"]
	if !created.Created || !strings.Contains(created.NewContent, "package format") || !strings.Contains(created.NewContent, "// Format scrive i centesimi come euro.") || !strings.Contains(created.NewContent, `"fmt"`) {
		t.Fatalf("file di destinazione inatteso:\n%s", created.NewContent)
	}
	money := files["money/money.go"].NewContent
	if strings.Contains(money, "func Format") || strings.Contains(money, `"fmt"`) {
		t.Fatalf("Format e l'import fmt inutilizzato vanno tolti da money.go:\n%s", money)
	}
	if !strings.Contains(files["orders/orders.go"].NewContent, "format.Format(250)") || !strings.Contains(files["orders/orders.go"].NewContent, `"example.com/shop/format"`) {
		t.Fatalf("riferimento qualificato non riscritto:\n%s", files["orders/orders.go"].NewContent)
	}
	if !strings.Contains(files["money/money_test.go"].NewContent, "format.Format(250)") {
		t.Fatalf("riferimento nel test non riscritto:\n%s", files["money/money_test.go"].NewContent)
	}
}

func TestMoveFunctionRefusesCycles(t *testing.T) {
	service, id, _ := moveFixture(t)
	// Price.String in money usa Format: spostarlo in orders farebbe importare orders da money, che orders importa già.
	_, err := service.MoveSymbol(id, MoveSymbolRequest{RelativePath: "money/money.go", Line: 6, Column: 7, TargetDirectory: "orders"})
	if err == nil || !strings.Contains(err.Error(), "import cycle") {
		t.Fatalf("atteso un ciclo di import, ottenuto: %v", err)
	}
}

func TestMoveRefusesUnexportedDependencies(t *testing.T) {
	service, id, _ := moveFixture(t)
	_, err := service.MoveSymbol(id, MoveSymbolRequest{RelativePath: "money/money.go", Line: 19, Column: 7, TargetDirectory: "format"})
	if err == nil || !strings.Contains(err.Error(), "round") {
		t.Fatalf("atteso il rifiuto per l'helper non esportato, ottenuto: %v", err)
	}
}

func TestMoveTypeCarriesItsMethods(t *testing.T) {
	service, id, _ := moveFixture(t)
	change, err := service.MoveSymbol(id, MoveSymbolRequest{RelativePath: "money/money.go", Line: 22, Column: 7, TargetDirectory: "pricing"})
	if err != nil {
		t.Fatal(err)
	}
	files := changedFiles(change)
	created := files["pricing/price.go"].NewContent
	if !strings.Contains(created, "type Price struct") || !strings.Contains(created, "func (p Price) String() string { return money.Format(p.Cents) }") {
		t.Fatalf("tipo e metodo vanno spostati insieme:\n%s", created)
	}
	if strings.Contains(files["money/money.go"].NewContent, "Price") {
		t.Fatalf("Price deve sparire da money:\n%s", files["money/money.go"].NewContent)
	}
	if !strings.Contains(files["orders/orders.go"].NewContent, "pricing.Price{Cents: 1}") {
		t.Fatalf("riferimento al tipo non riscritto:\n%s", files["orders/orders.go"].NewContent)
	}
}

func TestMoveQualifiesSourcePackageIdentifiers(t *testing.T) {
	service, id, _ := moveFixture(t)
	change, err := service.MoveSymbol(id, MoveSymbolRequest{RelativePath: "money/money.go", Line: 14, Column: 7, TargetDirectory: "labels"})
	if err != nil {
		t.Fatal(err)
	}
	created := changedFiles(change)["labels/label.go"].NewContent
	if !strings.Contains(created, `"price in " + money.Currency`) || !strings.Contains(created, `"example.com/shop/money"`) {
		t.Fatalf("Currency va qualificata con money e importata:%s", created)
	}
}

func TestMoveGoFileBetweenPackagesRewritesReferences(t *testing.T) {
	service, id, root := moveFixture(t)
	if err := service.MovePath(id, "money/money.go", "pricing/money.go"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "money", "money.go")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the original file still exists: %v", err)
	}
	read := func(relative string) string {
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			t.Fatal(err)
		}
		return string(content)
	}
	moved := read("pricing/money.go")
	for _, expected := range []string{"package pricing", "func Format", "const Currency", "type Price struct", "func (p Price) String"} {
		if !strings.Contains(moved, expected) {
			t.Fatalf("moved file does not contain %q:\n%s", expected, moved)
		}
	}
	orders := read("orders/orders.go")
	if !strings.Contains(orders, `"example.com/shop/pricing"`) || !strings.Contains(orders, "pricing.Format(250)") || !strings.Contains(orders, "pricing.Price") {
		t.Fatalf("external references were not rewritten:\n%s", orders)
	}
	testFile := read("money/money_test.go")
	if !strings.Contains(testFile, `"example.com/shop/pricing"`) || !strings.Contains(testFile, "pricing.Format(250)") {
		t.Fatalf("source-package references were not rewritten:\n%s", testFile)
	}
	command := exec.Command("go", "test", "./...")
	command.Dir = root
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("moved project does not compile: %v\n%s", err, output)
	}
}

func TestMoveGoFileRefusesUnexportedReferencesWithoutTouchingDisk(t *testing.T) {
	service, id, root := moveFixture(t)
	dependent := filepath.Join(root, "money", "local.go")
	if err := os.WriteFile(dependent, []byte("package money\n\nfunc localUse() int { return round(2) }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := service.MovePath(id, "money/money.go", "pricing/money.go")
	if err == nil || !strings.Contains(err.Error(), "round") {
		t.Fatalf("expected an unexported-reference refusal, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "money", "money.go")); err != nil {
		t.Fatalf("the rejected move touched the source file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "pricing", "money.go")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the rejected move created its destination: %v", err)
	}
}
