package main

import (
	"adomnia/internal/collectionfs"
	"adomnia/internal/requestcontract"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

type CollectionFS struct{}

func NewCollectionFS() *CollectionFS {
	return &CollectionFS{}
}

func (c *CollectionFS) ExportCollectionToFolder(folderPath string, collectionJSON string, environmentsJSON string) error {
	cleanFolder := filepath.Clean(folderPath)
	if cleanFolder == "." || cleanFolder == "" {
		return fmt.Errorf("folder path required")
	}
	var collection collectionfs.Collection
	if err := json.Unmarshal([]byte(collectionJSON), &collection); err != nil {
		return fmt.Errorf("invalid collection JSON: %w", err)
	}
	var environments []collectionfs.Environment
	if strings.TrimSpace(environmentsJSON) != "" {
		if err := json.Unmarshal([]byte(environmentsJSON), &environments); err != nil {
			return fmt.Errorf("invalid environments JSON: %w", err)
		}
	}
	return collectionfs.ExportCollection(cleanFolder, collection, collectionfs.ExportOptions{Environments: environments})
}

func (c *CollectionFS) ImportCollectionFromFolder(folderPath string) (string, error) {
	cleanFolder := filepath.Clean(folderPath)
	if cleanFolder == "." || cleanFolder == "" {
		return "", fmt.Errorf("folder path required")
	}
	collection, err := collectionfs.ImportCollection(cleanFolder)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(collection)
	if err != nil {
		return "", fmt.Errorf("marshal imported collection: %w", err)
	}
	return string(data), nil
}

func (c *CollectionFS) ExportRequestToFolder(folderPath string, requestJSON string) (string, error) {
	cleanFolder := filepath.Clean(folderPath)
	if cleanFolder == "." || cleanFolder == "" {
		return "", fmt.Errorf("folder path required")
	}
	var request requestcontract.Request
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
		return "", fmt.Errorf("invalid request JSON: %w", err)
	}
	return collectionfs.ExportRequest(cleanFolder, request)
}

func (c *CollectionFS) InspectCollectionFolder(folderPath string, collectionJSON string) (string, error) {
	cleanFolder := filepath.Clean(folderPath)
	if cleanFolder == "." || cleanFolder == "" {
		return "", fmt.Errorf("folder path required")
	}
	var collection collectionfs.Collection
	if err := json.Unmarshal([]byte(collectionJSON), &collection); err != nil {
		return "", fmt.Errorf("invalid collection JSON: %w", err)
	}
	report, err := collectionfs.InspectDrift(cleanFolder, collection)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(report)
	if err != nil {
		return "", fmt.Errorf("marshal drift report: %w", err)
	}
	return string(data), nil
}
