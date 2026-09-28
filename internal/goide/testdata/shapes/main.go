package main

import (
	"fmt"

	"example.com/shapes/geom"
)

func main() {
	shapes := []geom.Shape{geom.Square{Side: 2}, geom.Rect{Width: 2, Height: 3}}
	for _, shape := range shapes {
		fmt.Println(shape.Name(), shape.Area())
	}
}
