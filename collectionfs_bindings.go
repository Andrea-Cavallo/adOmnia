package main

import (
	"adomnia/internal/collectionfs"
	"encoding/json"
	"fmt"
	"path/filepath"
)

type CollectionFS struct{}

func NewCollectionFS() *CollectionFS {
	return &CollectionFS{}
}

func (c *CollectionFS) ExportCollectionToFolder(folderPath string, collectionJSON string) error {
	cleanFolder := filepath.Clean(folderPath)
	if cleanFolder == "." || cleanFolder == "" {
		return fmt.Errorf("folder path required")
	}
	var collection collectionfs.Collection
	if err := json.Unmarshal([]byte(collectionJSON), &collection); err != nil {
		return fmt.Errorf("invalid collection JSON: %w", err)
	}
	return collectionfs.ExportCollection(cleanFolder, collection, collectionfs.ExportOptions{})
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
