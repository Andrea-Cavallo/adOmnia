package perf

import "testing"

func TestCatalogTotal(t *testing.T) {
	catalog := NewCatalog()
	catalog.Seed()
	if total := catalog.Total(); total != 120*3+300*2+12*1+4*25 {
		t.Fatalf("unexpected total: %d", total)
	}
}

func TestLowStock(t *testing.T) {
	catalog := NewCatalog()
	catalog.Seed()
	low := catalog.LowStock(20)
	if len(low) != 2 || low[0] != "B-1" || low[1] != "C-9" {
		t.Fatalf("unexpected low stock: %v", low)
	}
}

func TestRestock(t *testing.T) {
	catalog := NewCatalog()
	catalog.Seed()
	if !catalog.Restock("C-9", 6) {
		t.Fatal("restock failed")
	}
	item, _ := catalog.Get("C-9")
	if item.Quantity != 10 {
		t.Fatalf("unexpected quantity: %d", item.Quantity)
	}
}
