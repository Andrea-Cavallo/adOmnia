package main

import "fmt"

type StorageEntry struct {
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
	Value  string `json:"value"`
}

func (a *App) StorageGet(bucket, key string) (string, error) {
	if storeDB == nil {
		return "", fmt.Errorf("storage not initialized")
	}
	data, err := storeGet(bucket, key)
	if err != nil {
		return "", err
	}
	if data == nil {
		return "", nil
	}
	return string(data), nil
}

func (a *App) StoragePut(bucket, key, value string) error {
	if storeDB == nil {
		return fmt.Errorf("storage not initialized")
	}
	return storePut(bucket, key, []byte(value))
}

func (a *App) StorageDelete(bucket, key string) error {
	if storeDB == nil {
		return fmt.Errorf("storage not initialized")
	}
	return storeDelete(bucket, key)
}

func (a *App) StorageList(bucket, prefix string) ([]string, error) {
	if storeDB == nil {
		return nil, fmt.Errorf("storage not initialized")
	}
	return storeList(bucket, prefix)
}

func (a *App) StorageGetAll(bucket string) ([]StorageEntry, error) {
	if storeDB == nil {
		return nil, fmt.Errorf("storage not initialized")
	}
	keys, err := storeList(bucket, "")
	if err != nil {
		return nil, err
	}
	entries := make([]StorageEntry, 0, len(keys))
	for _, k := range keys {
		val, err := storeGet(bucket, k)
		if err != nil {
			continue
		}
		entries = append(entries, StorageEntry{
			Bucket: bucket,
			Key:    k,
			Value:  string(val),
		})
	}
	return entries, nil
}
