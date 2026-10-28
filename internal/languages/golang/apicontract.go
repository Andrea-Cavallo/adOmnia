package golang

import (
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/apicontract"
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

// EventShapes: per ogni producer/consumer di messaggi con un tipo serializzato riconosciuto,
// i campi JSON del messaggio su ciascun topic.
func EventShapes(report ArchitectureReport) []apicontract.EventShape {
	schemas := map[string]ArchSchema{}
	for _, schema := range report.Schemas {
		schemas[schema.Name] = schema
	}
	var shapes []apicontract.EventShape
	for _, entry := range report.Entries {
		broker, role, ok := strings.Cut(entry.Kind, "-")
		if !ok || (role != "producer" && role != "consumer") || entry.Event == nil {
			continue
		}
		var fields []apicontract.Field
		for _, field := range schemas[entry.Event.Ref].Fields {
			fields = append(fields, apicontract.Field{Name: field.Name, Type: field.Type, Ref: field.Ref, Required: field.Required})
		}
		for _, topic := range entry.Topics {
			shapes = append(shapes, apicontract.EventShape{Topic: topic, Broker: broker, Role: role, Function: entry.Function, Schema: entry.Event.Ref, Fields: fields, File: entry.Site.Path, Line: entry.Site.Line})
		}
	}
	return shapes
}
