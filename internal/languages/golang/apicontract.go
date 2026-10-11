package golang

import (
	"strings"

	"adomnia/internal/ide/apicontract"
)

// APIOperations traduce le route HTTP del report, con i DTO di richiesta e risposta, nel
// modello neutro dei contratti API.
func APIOperations(report ArchitectureReport) []apicontract.Operation {
	schemas := map[string]ArchSchema{}
	for _, schema := range report.Schemas {
		schemas[schema.Name] = schema
	}
	body := func(archBody *ArchBody) *apicontract.Body {
		if archBody == nil {
			return nil
		}
		out := &apicontract.Body{Schema: archBody.Ref, Array: archBody.Array}
		for _, field := range schemas[archBody.Ref].Fields {
			out.Fields = append(out.Fields, apicontract.Field{Name: field.Name, Type: field.Type, Ref: field.Ref, Required: field.Required})
		}
		return out
	}
	var operations []apicontract.Operation
	for _, entry := range report.Entries {
		if entry.Kind != "http" {
			continue
		}
		method, path, found := strings.Cut(entry.Name, " ")
		if !found {
			method, path = "ANY", entry.Name
		}
		operations = append(operations, apicontract.Operation{Method: method, Path: path, Request: body(entry.Request), Response: body(entry.Response), File: entry.Site.Path, Line: entry.Site.Line})
	}
	return operations
}
