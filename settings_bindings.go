package main

import (
	"encoding/json"
	"fmt"
)

const settingsBucket = "workspace"
const settingsKey = "settings"

func (a *App) LoadSettings() (string, error) {
	if storeDB == nil {
		return "{}", nil
	}
	data, err := storeGet(settingsBucket, settingsKey)
	if err != nil {
		return "{}", fmt.Errorf("failed to load settings: %w", err)
	}
	if data == nil {
		return "{}", nil
	}
	return string(data), nil
}

func (a *App) SaveSettings(settingsJSON string) error {
	if storeDB == nil {
		return fmt.Errorf("storage not initialized")
	}
	if !json.Valid([]byte(settingsJSON)) {
		return fmt.Errorf("invalid settings JSON")
	}
	return storePut(settingsBucket, settingsKey, []byte(settingsJSON))
}
