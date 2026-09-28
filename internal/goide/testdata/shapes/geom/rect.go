package geom

// Rect è un rettangolo.
type Rect struct{ Width, Height int }

// Area restituisce l'area del rettangolo.
func (r Rect) Area() int { return r.Width * r.Height }

// Name restituisce il nome della figura.
func (r Rect) Name() string { return "rect" }
