package goide

import (
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
	if err == nil || !strings.Contains(err.Error(), "ciclo") {
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
