package main

import (
	"fmt"
	"os"
)

func unused() {}

func main() {
	s := "é"
	os.Open("x")
	fmt.Println(s)
}
