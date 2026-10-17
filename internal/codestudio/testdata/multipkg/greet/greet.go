package greet

// Greeter produce saluti.
type Greeter interface {
	Greet(name string) string
}

// English saluta in inglese.
type English struct{}

// Greet implementa Greeter.
func (English) Greet(name string) string { return Hello(name) }

// Hello restituisce un saluto per name.
func Hello(name string) string {
	return "hello " + name
}
