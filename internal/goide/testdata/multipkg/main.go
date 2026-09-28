package main

import (
	"fmt"

	"example.com/multipkg/greet"
)

func main() {
	var g greet.Greeter = greet.English{}
	fmt.Println(greet.Hello("gopher"), g.Greet("dev"))
}
