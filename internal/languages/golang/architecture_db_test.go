package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

var dbFixture = map[string]string{
	"go.mod":                  "module example.com/data\n\ngo 1.22\n\nrequire gorm.io/gorm v0.0.0\n\nreplace gorm.io/gorm => ./third_party/gorm\n",
	"third_party/gorm/go.mod": "module gorm.io/gorm\n\ngo 1.22\n",
	"third_party/gorm/gorm.go": `package gorm

type DB struct{ Error error }

func (db *DB) Model(v any) *DB                      { return db }
func (db *DB) Table(name string) *DB                { return db }
func (db *DB) Where(q any, args ...any) *DB         { return db }
func (db *DB) Find(dest any, conds ...any) *DB      { return db }
func (db *DB) Create(v any) *DB                     { return db }
func (db *DB) Updates(v any) *DB                    { return db }
func (db *DB) Raw(sql string, values ...any) *DB    { return db }
func (db *DB) Scan(dest any) *DB                    { return db }
func (db *DB) Begin() *DB                           { return db }
func (db *DB) Commit() *DB                          { return db }
func (db *DB) Transaction(fc func(tx *DB) error) error { return fc(db) }
`,
	"store/sql.go": `package store

import (
	"context"
	"database/sql"
	"fmt"
)

type OrderRepository struct{ db *sql.DB }

func (r *OrderRepository) List(ctx context.Context) error {
	rows, err := r.db.QueryContext(ctx, "SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id")
	if err != nil {
		return err
	}
	return rows.Close()
}

func (r *OrderRepository) Pay(ctx context.Context, id int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE orders SET paid = true WHERE id = $1", id); err != nil {
		return err
	}
	stmt, err := tx.PrepareContext(ctx, "INSERT INTO audit (order_id) VALUES ($1)")
	if err != nil {
		return err
	}
	if _, err := stmt.ExecContext(ctx, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *OrderRepository) Count(table string) error {
	return r.db.QueryRow(fmt.Sprintf("SELECT count(*) FROM %s", table)).Scan(new(int))
}
`,
	"store/gorm.go": `package store

import "gorm.io/gorm"

type User struct{ ID int }
type OrderItem struct{ ID int }
type Category struct{ ID int }

func (Category) TableName() string { return "product_categories" }

type Users struct{ db *gorm.DB }

func (u *Users) Active() error {
	var users []User
	return u.db.Where("active = ?", true).Find(&users).Error
}

func (u *Users) Rename() error {
	return u.db.Transaction(func(tx *gorm.DB) error {
		return tx.Model(&OrderItem{}).Updates(map[string]any{"name": "x"}).Error
	})
}

func (u *Users) Report() error {
	var total int
	u.db.Table("sales").Find(&total)
	u.db.Find(&[]Category{})
	return u.db.Raw("SELECT sum(amount) FROM payments").Scan(&total).Error
}
`,
}

func TestSQLTables(t *testing.T) {
	for sql, want := range map[string]string{
		"SELECT * FROM orders o JOIN customers c ON c.id = o.cid": "orders,customers",
		"insert into \"public\".\"audit\" (x) values (1)":         "public.audit",
		"UPDATE `shop`.`items` SET x = 1":                         "shop.items",
		"DELETE FROM sessions WHERE expires < now()":              "sessions",
		"SELECT * FROM (SELECT id FROM a) sub":                    "a",
		"SELECT x FROM unnest($1)":                                "",
		"TRUNCATE TABLE logs":                                     "logs",
	} {
		if got := strings.Join(SQLTables(sql), ","); got != want {
			t.Errorf("%q: got %q, want %q", sql, got, want)
		}
	}
	if gormTable("OrderItem") != "order_items" || gormTable("Category") != "categories" || gormTable("Address") != "addresses" || gormTable("Key") != "keys" {
		t.Fatal("gorm naming")
	}
}

func TestArchitectureQueries(t *testing.T) {
	root := t.TempDir()
	for name, content := range dbFixture {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fset := token.NewFileSet()
	config := &packages.Config{Context: context.Background(), Dir: root, Tests: true, Fset: fset, Env: append(os.Environ(), "GOFLAGS=-mod=mod", "GOPROXY=off"),
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedModule}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		t.Skipf("go/packages unavailable: %v", err)
	}
	for _, pkg := range loaded {
		if len(pkg.Errors) > 0 {
			t.Fatalf("fixture does not compile: %v", pkg.Errors)
		}
	}
	read := func(path string) ([]byte, error) {
		if !strings.HasPrefix(filepath.Clean(path), filepath.Join(root, "store")) {
			return nil, os.ErrNotExist
		}
		return os.ReadFile(path)
	}
	report := AnalyzeArchitecture(fset, loaded, read)
	got := []string{}
	for _, query := range report.Queries {
		label := query.Function + " " + query.Library + " " + query.Operation + " " + query.Method + " [" + strings.Join(query.Tables, ",") + "]"
		if query.Transaction {
			label += " tx"
		}
		if query.Prepared {
			label += " prepared"
		}
		if query.Dynamic {
			label += " dynamic"
		}
		if query.TableGuess {
			label += " guess"
		}
		got = append(got, label)
	}
	want := []string{
		"(*Users).Active GORM orm Find [users] guess",
		"(*Users).Rename GORM begin Transaction []",
		"(*Users).Rename GORM orm Updates [order_items] tx guess",
		"(*Users).Report GORM orm Find [sales]",
		"(*Users).Report GORM orm Find [product_categories]",
		"(*Users).Report GORM orm Scan []",
		"(*Users).Report GORM query Raw [payments]",
		"(*OrderRepository).List database/sql query QueryContext [orders,customers]",
		"(*OrderRepository).Pay database/sql begin BeginTx []",
		"(*OrderRepository).Pay database/sql exec ExecContext [orders] tx",
		"(*OrderRepository).Pay database/sql prepare PrepareContext [audit] tx prepared",
		"(*OrderRepository).Pay database/sql exec ExecContext [] prepared",
		"(*OrderRepository).Count database/sql query QueryRow [] dynamic",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("queries:\n%s", strings.Join(got, "\n"))
	}
	for _, query := range report.Queries {
		if query.Method == "QueryRow" && query.SQL != "SELECT count(*) FROM ?" {
			t.Fatalf("sprintf SQL: %q", query.SQL)
		}
	}
}
