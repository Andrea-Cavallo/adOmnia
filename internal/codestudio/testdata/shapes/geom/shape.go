package geom

// Shape è una figura con un'area.
type Shape interface {
	Area() int
	Name() string
}
