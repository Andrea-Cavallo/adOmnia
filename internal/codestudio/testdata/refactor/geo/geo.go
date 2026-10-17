package geo

// Rect è un rettangolo.
type Rect struct {
	Width, Height int
}

// Double raddoppia un valore.
func Double(value int) int {
	return value * 2
}

// Scale moltiplica value per factor.
func Scale(value, factor int) int {
	return value * factor
}
