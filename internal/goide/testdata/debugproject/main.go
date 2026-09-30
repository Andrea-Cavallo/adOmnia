package main

import (
	"errors"
	"fmt"
	"os"
	"time"
)

type point struct {
	X, Y int
}

type debugEvent struct {
	ID int
}

func sum(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

// errorChainForDebug offre una catena reale a Delve senza cambiare il comportamento del fixture.
func errorChainForDebug() {
	root := errors.New("root cause")
	inner := fmt.Errorf("inner: %w", root)
	outer := fmt.Errorf("outer: %w", inner)
	fmt.Println(outer)
}

func collectionsForDebug() {
	items := make([]int, 2, 5)
	labels := map[string]int{"one": 1, "two": 2}
	jobs := make(chan string, 3)
	jobs <- "ready"
	fmt.Println(items, labels, jobs)
}

func interfaceForDebug() {
	var payload any = debugEvent{ID: 7}
	fmt.Println(payload)
}

func main() {
	if os.Getenv("DBG_HANG") != "" {
		time.Sleep(time.Minute)
	}
	origin := point{X: 3, Y: 4}
	total := sum([]int{1, 2, 3})
	fmt.Println("total", total, origin.X)
	errorChainForDebug()
	collectionsForDebug()
	interfaceForDebug()
	if os.Getenv("DBG_PANIC") != "" {
		fmt.Println("recovered", recovered())
	}
}

// recovered va in panic e si riprende: Delve si ferma solo con "Stop on every panic".
func recovered() (message any) {
	defer func() { message = recover() }()
	panic("boom")
}
