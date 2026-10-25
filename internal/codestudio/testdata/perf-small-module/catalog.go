// Package perf is a deliberately small Go module used as the "small project"
// side of the PERF-1.2 comparison (gopls memory budget on a small workspace).
// It is testdata: the Go tool never builds or vets it.
package perf

// Catalog is a tiny in-memory catalogue.
type Catalog struct {
	items map[string]Item
}

// Item is one catalogue entry.
type Item struct {
	SKU      string
	Name     string
	Quantity int
	Price    int64
}

// NewCatalog returns an empty catalogue.
func NewCatalog() *Catalog {
	return &Catalog{items: make(map[string]Item)}
}

// Put inserts or replaces an item.
func (c *Catalog) Put(item Item) {
	c.items[item.SKU] = item
}

// Get reads one item.
func (c *Catalog) Get(sku string) (Item, bool) {
	item, ok := c.items[sku]
	return item, ok
}

// Total sums the catalogue value.
func (c *Catalog) Total() int64 {
	var total int64
	for _, item := range c.items {
		total += item.Price * int64(item.Quantity)
	}
	return total
}

// Restock adds quantity to an existing item, reporting whether it existed.
func (c *Catalog) Restock(sku string, quantity int) bool {
	item, ok := c.items[sku]
	if !ok {
		return false
	}
	item.Quantity += quantity
	c.items[sku] = item
	return true
}
