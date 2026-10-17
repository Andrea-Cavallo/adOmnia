package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--child" {
		for {
			time.Sleep(time.Second)
		}
	}
	child := exec.Command(os.Args[0], "--child")
	if err := child.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "child error:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "fixture child pid=%d\n", child.Process.Pid)
	fmt.Fprintln(os.Stdout, "fixture ready; type a line")
	scanner := bufio.NewScanner(os.Stdin)
	if scanner.Scan() {
		fmt.Fprintln(os.Stdout, "echo:", scanner.Text())
	}
	for {
		fmt.Fprintln(os.Stdout, "fixture tick")
		time.Sleep(time.Second)
	}
}
