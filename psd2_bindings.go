package main

import (
	"adomnia/internal/psd2"
	"encoding/json"
	"fmt"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// SelectPSD2Certificate opens a native picker and returns a local path only.
func (a *App) SelectPSD2Certificate() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application is not ready")
	}
	return wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:   "Select QWAC or QSEAL certificate",
		Filters: []wailsRuntime.FileFilter{{DisplayName: "Certificates", Pattern: "*.pem;*.crt;*.cer;*.p12;*.pfx"}},
	})
}

func (a *App) InspectPSD2Certificate(path, password string) (string, error) {
	info, err := (psd2.FileCertificateManager{}).Inspect(path, password)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(info)
	if err != nil {
		return "", fmt.Errorf("encode certificate details: %w", err)
	}
	return string(raw), nil
}

func (a *App) BuildPSD2Headers(inputJSON string) (string, error) {
	var input psd2.HeaderBuildInput
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return "", fmt.Errorf("decode PSD2 header input: %w", err)
	}
	result, err := (psd2.BerlinHeaderBuilder{}).Build(input)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("encode PSD2 headers: %w", err)
	}
	return string(raw), nil
}
