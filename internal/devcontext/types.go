// Package devcontext builds the project context of a gO session: the
// services, datasources, env vars, contracts, routes, tables and topics a
// developer works with, each traceable to the file and line it came from.
package devcontext

import (
	"sort"
	"time"
)

const (
	ConfidenceCertain  = "certain"
	ConfidenceInferred = "inferred"
)

type Source struct {
	Detector string `json:"detector"`
	File     string `json:"file"` // root-relative, slash separated
	Line     int    `json:"line"`
}

type Entity struct {
	ID         string            `json:"id"`
	Kind       string            `json:"kind"`
	Label      string            `json:"label"`
	Attrs      map[string]string `json:"attrs"`
	Sources    []Source          `json:"sources"`
	Confidence string            `json:"confidence"`
}

type Snapshot struct {
	SessionID string    `json:"sessionId"`
	Root      string    `json:"root"`
	Version   int64     `json:"version"`
	Entities  []Entity  `json:"entities"`
	Warnings  []string  `json:"warnings"`
	ScannedAt time.Time `json:"scannedAt"`
}

func entity(kind, key, label, confidence string, attrs map[string]string, src Source) Entity {
	if attrs == nil {
		attrs = map[string]string{}
	}
	return Entity{ID: kind + ":" + key, Kind: kind, Label: label, Attrs: attrs, Sources: []Source{src}, Confidence: confidence}
}

// merge folds entities sharing an ID: sources are appended, attrs are unioned
// (first writer wins) and certain beats inferred. Inputs are never mutated.
func merge(groups ...[]Entity) []Entity {
	byID := map[string]*Entity{}
	for _, group := range groups {
		for _, e := range group {
			current, ok := byID[e.ID]
			if !ok {
				fresh := e
				fresh.Attrs = make(map[string]string, len(e.Attrs))
				for k, v := range e.Attrs {
					fresh.Attrs[k] = v
				}
				fresh.Sources = append([]Source(nil), e.Sources...)
				byID[e.ID] = &fresh
				continue
			}
			current.Sources = append(current.Sources, e.Sources...)
			for k, v := range e.Attrs {
				if _, exists := current.Attrs[k]; !exists {
					current.Attrs[k] = v
				}
			}
			if e.Confidence == ConfidenceCertain {
				current.Confidence = ConfidenceCertain
			}
		}
	}
	out := make([]Entity, 0, len(byID))
	for _, e := range byID {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].ID < out[j].ID
	})
	return out
}
