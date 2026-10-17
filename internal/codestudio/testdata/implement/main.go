package main

import "io"

// Buffer accumula byte.
type Buffer struct {
	data []byte
}

var _ io.ReadWriter = (*Buffer)(nil)

func main() {}
