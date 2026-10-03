package goide

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/lsp"
)

// Gerarchie di gopls (chiamate e tipi) esposte in forma uniforme: l'elemento LSP
// viaggia come token opaco, così gopls ritrova i propri dati per espandere il nodo.

const maxHierarchyChildren = 200

// HierarchyItem è un nodo di Call Hierarchy o Type Hierarchy.
type HierarchyItem struct {
	Name     string         `json:"name"`
	Detail   string         `json:"detail,omitempty"`
	Kind     int            `json:"kind"`
	Location EditorLocation `json:"location"`
	// CallSites sono le righe delle chiamate (nel chiamante per incoming, nel nodo corrente per outgoing).
	CallSites []EditorRange `json:"callSites,omitempty"`
	// Token è l'elemento LSP originale, da ripassare a ExpandHierarchy.
	Token string `json:"token"`
}

type hierarchyItem struct {
	Name           string          `json:"name"`
	Kind           int             `json:"kind"`
	Detail         string          `json:"detail,omitempty"`
	URI            string          `json:"uri"`
	Range          lsp.Range       `json:"range"`
	SelectionRange lsp.Range       `json:"selectionRange"`
	Data           json.RawMessage `json:"data,omitempty"`
}

var (
	hierarchyPrepareMethods = map[string]string{"call": "textDocument/prepareCallHierarchy", "type": "textDocument/prepareTypeHierarchy"}
	hierarchyExpandMethods  = map[string]string{
		"incoming": "callHierarchy/incomingCalls", "outgoing": "callHierarchy/outgoingCalls",
		"supertypes": "typeHierarchy/supertypes", "subtypes": "typeHierarchy/subtypes",
	}
)

// PrepareHierarchy restituisce il nodo radice (di solito uno) per il simbolo al cursore.
func (m *LSPManager) PrepareHierarchy(ctx context.Context, sessionID SessionID, documentID DocumentID, kind string, line, column int) ([]HierarchyItem, error) {
	method, ok := hierarchyPrepareMethods[kind]
	if !ok {
		return nil, fmt.Errorf("gerarchia non supportata: %q", kind)
	}
	document, process, err := m.snapshot(sessionID, documentID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	var items []hierarchyItem
	if err := process.conn.Call(ctx, method, positionParams(document, line, column), &items); err != nil {
		return nil, err
	}
	state, _ := m.forDocument(sessionID, documentID)
	return m.hierarchyItems(state, items, nil), nil
}

// ExpandHierarchy restituisce i figli di un nodo: chiamanti o chiamati, supertipi o sottotipi.
func (m *LSPManager) ExpandHierarchy(ctx context.Context, sessionID SessionID, direction, token string) ([]HierarchyItem, error) {
	method, ok := hierarchyExpandMethods[direction]
	if !ok {
		return nil, fmt.Errorf("direzione non supportata: %q", direction)
	}
	var item hierarchyItem
	if err := json.Unmarshal([]byte(token), &item); err != nil || item.URI == "" {
		return nil, fmt.Errorf("nodo della gerarchia non valido")
	}
	// Il nodo può stare in un file non aperto: il server è quello del linguaggio del file.
	state, ok := m.forPath(sessionID, pathFromURI(item.URI))
	if !ok {
		return nil, fmt.Errorf("nessun language server avviato per %s", filepath.Base(pathFromURI(item.URI)))
	}
	state.mu.Lock()
	process, ready, name := state.process, state.status.State == LanguageServerReady, state.options.DisplayName()
	state.mu.Unlock()
	if process == nil || !ready {
		return nil, fmt.Errorf("%s non è pronto", name)
	}
	ctx, cancel := withRequestTimeout(ctx)
	defer cancel()
	switch direction {
	case "incoming", "outgoing":
		var calls []struct {
			From       *hierarchyItem `json:"from"`
			To         *hierarchyItem `json:"to"`
			FromRanges []lsp.Range    `json:"fromRanges"`
		}
		if err := process.conn.Call(ctx, method, map[string]any{"item": item}, &calls); err != nil {
			return nil, err
		}
		result := make([]HierarchyItem, 0, len(calls))
		for _, call := range calls {
			target := call.From
			if direction == "outgoing" {
				target = call.To
			}
			if target == nil {
				continue
			}
			sites := make([]EditorRange, 0, len(call.FromRanges))
			for _, site := range call.FromRanges {
				sites = append(sites, editorRange(site))
			}
			result = append(result, m.hierarchyItems(state, []hierarchyItem{*target}, sites)...)
			if len(result) == maxHierarchyChildren {
				break
			}
		}
		return result, nil
	default:
		var items []hierarchyItem
		if err := process.conn.Call(ctx, method, map[string]any{"item": item}, &items); err != nil {
			return nil, err
		}
		if len(items) > maxHierarchyChildren {
			items = items[:maxHierarchyChildren]
		}
		return m.hierarchyItems(state, items, nil), nil
	}
}

func (m *LSPManager) hierarchyItems(state *lspSession, items []hierarchyItem, callSites []EditorRange) []HierarchyItem {
	result := make([]HierarchyItem, 0, len(items))
	for _, item := range items {
		token, err := json.Marshal(item)
		if err != nil {
			continue
		}
		locations := m.editorLocations(state, []lsp.Location{{URI: item.URI, Range: item.SelectionRange}})
		if len(locations) == 0 {
			continue
		}
		result = append(result, HierarchyItem{
			Name: item.Name, Detail: strings.TrimSpace(item.Detail), Kind: item.Kind,
			Location: locations[0], CallSites: callSites, Token: string(token),
		})
	}
	return result
}
