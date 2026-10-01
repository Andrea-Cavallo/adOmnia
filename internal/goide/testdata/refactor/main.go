package main

import (
	"fmt"

	"example.com/refactor/geo"
)

func report(rect geo.Rect) string {
	area := rect.Width * rect.Height
	if area == 0 {
		return "empty"
	}
	perimeter := geo.Double(rect.Width + rect.Height)
	label := fmt.Sprintf("area %d", area)
	label += fmt.Sprintf(" perimeter %d", perimeter)
	return label
}

func main() {
	fmt.Println(report(geo.Rect{Width: 3, Height: 4}))
	fmt.Println(geo.Scale(2, 3))
}
