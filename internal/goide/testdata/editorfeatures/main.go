package main

import "fmt"

// Fact calcola il fattoriale in modo ricorsivo.
func Fact(n int) int {
	if n <= 1 {
		return 1
	}
	return n * Fact(n-1)
}

func main() {
	total := 0
	total = Fact(5)
	total++
	fmt.Println(total, pick(true))
}

func pick(flag bool) string {
	if flag {
		return "yes"
	}
	panic("no")
}
