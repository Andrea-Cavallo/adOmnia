package main

import (
	"fmt"
	"os"
	"time"
)

type point struct {
	X, Y int
}

func sum(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

func main() {
	if os.Getenv("DBG_HANG") != "" {
		time.Sleep(time.Minute)
	}
	origin := point{X: 3, Y: 4}
	total := sum([]int{1, 2, 3})
	fmt.Println("total", total, origin.X)
}
