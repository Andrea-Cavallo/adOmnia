package main

import (
	"adomnia/internal/storage"

	bolt "go.etcd.io/bbolt"
)

// Transitional adapters for Wails-bound services that still live in package main.
var storeDB *bolt.DB
var storeBuckets = storage.Buckets()

func storePath() string {
	return storage.Path()
}

func openStore() error {
	if err := storage.Open(dataDir()); err != nil {
		return err
	}
	storeDB = storage.DB()
	return nil
}

func closeStore() {
	storage.Close()
	storeDB = nil
}

func storeGet(bucket, key string) ([]byte, error) {
	return storage.Get(bucket, key)
}

func storePut(bucket, key string, value []byte) error {
	return storage.Put(bucket, key, value)
}

func storeDelete(bucket, key string) error {
	return storage.Delete(bucket, key)
}

func storeList(bucket, prefix string) ([]string, error) {
	return storage.List(bucket, prefix)
}
