package lsp

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"strings"
)

// UnmarshalJSON accepts every LSP Hover contents variant: MarkupContent, MarkedString and arrays.
func (m *MarkupContent) UnmarshalJSON(data []byte) error {
	*m = MarkupContent{}
	var text string
	if json.Unmarshal(data, &text) == nil {
		m.Kind, m.Value = "markdown", text
		return nil
	}
	var entries []jsonv1.RawMessage
	if len(data) > 0 && data[0] == '[' {
		if err := json.Unmarshal(data, &entries); err != nil {
			return err
		}
		var parts []string
		for _, entry := range entries {
			var part MarkupContent
			if err := json.Unmarshal(entry, &part); err != nil {
				return err
			}
			if part.Value != "" {
				parts = append(parts, part.Value)
			}
		}
		m.Kind, m.Value = "markdown", strings.Join(parts, "\n\n")
		return nil
	}
	var object struct {
		Kind     string `json:"kind"`
		Language string `json:"language"`
		Value    string `json:"value"`
	}
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	m.Kind, m.Value = object.Kind, object.Value
	if object.Language != "" {
		fence := "```"
		for strings.Contains(object.Value, fence) {
			fence += "`"
		}
		m.Kind, m.Value = "markdown", fence+object.Language+"\n"+object.Value+"\n"+fence
	}
	return nil
}
