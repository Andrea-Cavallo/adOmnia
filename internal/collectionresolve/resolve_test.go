package collectionresolve

import (
	"encoding/json"
	"testing"

	"adomnia/internal/collectionfs"
	"adomnia/internal/requestcontract"
)

func TestResolveEffectiveRequestAppliesCollectionAuthAndFolderHeaders(t *testing.T) {
	collection := collectionfs.Collection{
		ID:   "col",
		Name: "Collection",
		Auth: requestcontract.Auth{Type: "bearer", Token: "{{token}}"},
		Variables: []requestcontract.Variable{
			{Key: "token", Value: "collection-token", Enabled: true},
			{Key: "tenant", Value: "acme", Enabled: true},
		},
		Children: []collectionfs.Node{{
			ID:   "folder",
			Name: "Admin",
			Type: "folder",
			Headers: []requestcontract.KVRow{
				{Key: "X-Tenant", Value: "{{tenant}}", Enabled: true},
			},
			Children: []collectionfs.Node{requestNode(t, "req", requestcontract.Request{
				ID:      "req",
				Name:    "Probe",
				Type:    "request",
				Method:  "GET",
				URL:     "https://api.example.test/users",
				Headers: []requestcontract.KVRow{{Key: "Accept", Value: "application/json", Enabled: true}},
				Auth:    requestcontract.Auth{Type: "none"},
			})},
		}},
	}

	resolved, ok, err := ResolveEffectiveRequest(collection, "req")
	if err != nil {
		t.Fatalf("ResolveEffectiveRequest err = %v", err)
	}
	if !ok {
		t.Fatalf("request not found")
	}
	if resolved.Request.Auth.Type != "bearer" || resolved.Request.Auth.Token != "{{token}}" {
		t.Fatalf("auth = %#v", resolved.Request.Auth)
	}
	if resolved.Vars["token"] != "collection-token" || resolved.Vars["tenant"] != "acme" {
		t.Fatalf("vars = %#v", resolved.Vars)
	}
	if got := rowValue(resolved.Request.Headers, "X-Tenant"); got != "{{tenant}}" {
		t.Fatalf("X-Tenant = %q", got)
	}
	if got := rowValue(resolved.Request.Headers, "Accept"); got != "application/json" {
		t.Fatalf("Accept = %q", got)
	}
}

func TestResolveEffectiveRequestAllowsRequestOverrideAndDisabledRows(t *testing.T) {
	collection := collectionfs.Collection{
		ID:      "col",
		Name:    "Collection",
		Headers: []requestcontract.KVRow{{Key: "X-Trace", Value: "collection", Enabled: true}},
		Auth:    requestcontract.Auth{Type: "bearer", Token: "collection-token"},
		Children: []collectionfs.Node{requestNode(t, "req", requestcontract.Request{
			ID:      "req",
			Name:    "Probe",
			Type:    "request",
			Method:  "GET",
			URL:     "https://api.example.test/users",
			Headers: []requestcontract.KVRow{{Key: "x-trace", Value: "", Enabled: false}},
			Auth:    requestcontract.Auth{Type: "basic", Username: "me", Password: "secret"},
		})},
	}

	resolved, ok, err := ResolveEffectiveRequest(collection, "req")
	if err != nil {
		t.Fatalf("ResolveEffectiveRequest err = %v", err)
	}
	if !ok {
		t.Fatalf("request not found")
	}
	if resolved.Request.Auth.Type != "basic" {
		t.Fatalf("request auth should override inherited auth, got %#v", resolved.Request.Auth)
	}
	if row := rowByKey(resolved.Request.Headers, "X-Trace"); row == nil || row.Enabled || row.Value != "" {
		t.Fatalf("disabled request header should override inherited header, got %#v", row)
	}
}

func TestResolveEffectiveRequestCanDisableAuthAndHeadersInheritance(t *testing.T) {
	collection := collectionfs.Collection{
		ID:      "col",
		Name:    "Collection",
		Headers: []requestcontract.KVRow{{Key: "X-Trace", Value: "collection", Enabled: true}},
		Auth:    requestcontract.Auth{Type: "bearer", Token: "collection-token"},
		Children: []collectionfs.Node{requestNode(t, "req", requestcontract.Request{
			ID:     "req",
			Name:   "Probe",
			Type:   "request",
			Method: "GET",
			URL:    "https://api.example.test/users",
			Inheritance: requestcontract.InheritancePolicy{
				Auth:    "none",
				Headers: "none",
			},
		})},
	}

	resolved, ok, err := ResolveEffectiveRequest(collection, "req")
	if err != nil {
		t.Fatalf("ResolveEffectiveRequest err = %v", err)
	}
	if !ok {
		t.Fatalf("request not found")
	}
	if resolved.Request.Auth.Type != "none" {
		t.Fatalf("auth inheritance should be disabled, got %#v", resolved.Request.Auth)
	}
	if len(resolved.Request.Headers) != 0 {
		t.Fatalf("headers inheritance should be disabled, got %#v", resolved.Request.Headers)
	}
}

func requestNode(t *testing.T, id string, req requestcontract.Request) collectionfs.Node {
	t.Helper()
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return collectionfs.Node{ID: id, Name: req.Name, Type: "request", Raw: raw}
}

func rowValue(rows []requestcontract.KVRow, key string) string {
	if row := rowByKey(rows, key); row != nil {
		return row.Value
	}
	return ""
}

func rowByKey(rows []requestcontract.KVRow, key string) *requestcontract.KVRow {
	for index, row := range rows {
		if rowKey(row.Key) == rowKey(key) {
			return &rows[index]
		}
	}
	return nil
}
