package mock

import (
	"encoding/json"
	"fmt"
)

type GeneratedEndpoint struct {
	Path       string            `json:"path"`
	Method     string            `json:"method"`
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	DelayMs    int               `json:"delayMs"`
}

func ParseAIResponse(text string) ([]GeneratedEndpoint, error) {
	start := -1
	end := -1
	for i, c := range text {
		if c == '[' && start == -1 {
			start = i
		}
		if c == ']' {
			end = i
		}
	}
	if start == -1 || end == -1 {
		return nil, fmt.Errorf("nessun array JSON trovato nella risposta AI")
	}
	jsonPart := text[start : end+1]
	var endpoints []GeneratedEndpoint
	if err := json.Unmarshal([]byte(jsonPart), &endpoints); err != nil {
		return nil, fmt.Errorf("parse endpoint JSON: %w (raw: %s)", err, jsonPart)
	}
	return endpoints, nil
}

func BuildMockGenerationPrompt(inputType, userInput string) string {
	schema := `[{"path":"/esempio","method":"GET","statusCode":200,"headers":{"Content-Type":"application/json"},"body":"{\"id\":1}","delayMs":0}]`

	switch inputType {
	case "json":
		return fmt.Sprintf(`Sei un generatore di mock API.
Analizza questo campione JSON e genera gli endpoint REST mock appropriati.
Campione JSON: %s

Rispondi SOLO con un array JSON valido in questo formato esatto:
%s

Genera 2-5 endpoint CRUD sensati per questa struttura dati. Solo JSON, nessun testo aggiuntivo.`, userInput, schema)

	case "openapi":
		return fmt.Sprintf(`Sei un generatore di mock API.
Analizza questa spec OpenAPI e genera gli endpoint mock per ogni operazione.
OpenAPI spec: %s

Rispondi SOLO con un array JSON valido in questo formato esatto:
%s

Un endpoint per ogni operazione nella spec. Solo JSON, nessun testo aggiuntivo.`, userInput, schema)

	default:
		return fmt.Sprintf(`Sei un generatore di mock API REST.
L'utente descrive le API che vuole mockare: "%s"

Rispondi SOLO con un array JSON valido in questo formato esatto:
%s

Genera 3-6 endpoint REST sensati basati sulla descrizione.
Body come stringa JSON. Solo JSON, nessun testo aggiuntivo.`, userInput, schema)
	}
}
