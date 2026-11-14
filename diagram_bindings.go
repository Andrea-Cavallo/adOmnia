package main

import "github.com/Andrea-Cavallo/adOmnia/internal/diagrams"

// DiagramFromMarkdown reads a Markdown description (components, steps, links, Mermaid blocks)
// into a Diagram Studio blueprint; the frontend lays it out and opens it as a new diagram.
func (a *App) DiagramFromMarkdown(markdown string) (diagrams.Blueprint, error) {
	return diagrams.FromMarkdown(markdown)
}
