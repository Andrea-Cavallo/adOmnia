package perf

import (
	"fmt"
	"sort"
	"strings"
)

// Report renders a human-readable catalogue summary.
func (c *Catalog) Report() string {
	lines := make([]string, 0, len(c.items)+2)
	for _, item := range c.items {
		lines = append(lines, fmt.Sprintf("%s %-24s qty=%3d price=%6d", item.SKU, item.Name, item.Quantity, item.Price))
	}
	sort.Strings(lines)
	lines = append(lines, strings.Repeat("-", 48), fmt.Sprintf("total=%d", c.Total()))
	return strings.Join(lines, "\n")
}

// LowStock lists the SKUs below the threshold, ordered by SKU.
func (c *Catalog) LowStock(threshold int) []string {
	skus := make([]string, 0, len(c.items))
	for sku, item := range c.items {
		if item.Quantity < threshold {
			skus = append(skus, sku)
		}
	}
	sort.Strings(skus)
	return skus
}

// Seed fills the catalogue with a deterministic sample set.
func (c *Catalog) Seed() {
	c.Put(Item{SKU: "A-1", Name: "Bolt", Quantity: 120, Price: 3})
	c.Put(Item{SKU: "A-2", Name: "Nut", Quantity: 300, Price: 2})
	c.Put(Item{SKU: "B-1", Name: "Washer", Quantity: 12, Price: 1})
	c.Put(Item{SKU: "C-9", Name: "Bracket", Quantity: 4, Price: 25})
}
