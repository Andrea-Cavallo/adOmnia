package calc

// Add somma due numeri.
func Add(a, b int) int {
	return a + b
}

// Sign restituisce il segno di n.
func Sign(n int) int {
	if n < 0 {
		return -1
	}
	return 1
}
