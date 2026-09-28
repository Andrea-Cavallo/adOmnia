package main

import "testing"

func TestSum(t *testing.T) {
	got := sum([]int{2, 3})
	if got != 5 {
		t.Fatal(got)
	}
}
