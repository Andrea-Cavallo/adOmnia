package geom

import "fmt"

// Square è un quadrato.
type Square struct{ Side int }

// Area restituisce l'area del quadrato.
func (s Square) Area() int { return s.Side * s.Side }

// Name restituisce il nome della figura.
func (s Square) Name() string { return "square" }

// String descrive il quadrato.
func (s Square) String() string { return fmt.Sprintf("square %d", s.Side) }
