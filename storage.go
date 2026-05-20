// storage.go — embedded bbolt key/value storage engine for adOmnia.
// Replaces localStorage for workspace, history, mock config, and proxy config.
// Single-file DB, ACID transactions, zero runtime deps.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

var (
	storeDB    *bolt.DB
	storeDBMu  sync.RWMutex
	storeDBEnc = false
)

// Bucket names
var storeBuckets = []string{
	"workspace",  // collections, environments, settings
	"history",    // request/response history
	"mock",       // mock server config + hits
	"proxy",      // proxy/interceptor config + traffic
}

func storeDir() string {
	d := dataDir()
	if d == "" {
		d, _ = os.UserConfigDir()
		if d == "" {
			d = "."
		}
	}
	return filepath.Join(d, "adomnia")
}

func storePath() string {
	return filepath.Join(storeDir(), "adomnia.db")
}

func openStore() error {
	dir := storeDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	db, err := bolt.Open(storePath(), 0600, &bolt.Options{
		Timeout:      1 * time.Second,
		NoGrowSync:   false,
		FreelistType: bolt.FreelistMapType,
	})
	if err != nil {
		return err
	}

	// Ensure buckets exist
	err = db.Update(func(tx *bolt.Tx) error {
		for _, b := range storeBuckets {
			if _, err := tx.CreateBucketIfNotExists([]byte(b)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		db.Close()
		return err
	}

	storeDB = db
	log.Printf("[store] bbolt opened: %s", storePath())
	return nil
}

func closeStore() {
	if storeDB != nil {
		storeDB.Close()
		log.Println("[store] bbolt closed")
	}
}

// --- generic helpers ---

func storeGet(bucket, key string) ([]byte, error) {
	var val []byte
	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		v := b.Get([]byte(key))
		if v != nil {
			val = make([]byte, len(v))
			copy(val, v)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("store get %s/%s: %w", bucket, key, err)
	}
	return val, nil
}

func storePut(bucket, key string, value []byte) error {
	err := storeDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		return b.Put([]byte(key), value)
	})
	if err != nil {
		return fmt.Errorf("store put %s/%s: %w", bucket, key, err)
	}
	return nil
}

func storeDelete(bucket, key string) error {
	err := storeDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		return b.Delete([]byte(key))
	})
	if err != nil {
		return fmt.Errorf("store delete %s/%s: %w", bucket, key, err)
	}
	return nil
}

func storeList(bucket, prefix string) ([]string, error) {
	var keys []string
	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		p := []byte(prefix)
		for k, _ := c.Seek(p); k != nil && strings.HasPrefix(string(k), prefix); k, _ = c.Next() {
			keys = append(keys, string(k))
		}
		return nil
	})
	return keys, err
}

func storeCount(bucket, prefix string) (int, error) {
	count := 0
	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		p := []byte(prefix)
		for k, _ := c.Seek(p); k != nil && strings.HasPrefix(string(k), prefix); k, _ = c.Next() {
			count++
		}
		return nil
	})
	return count, err
}

// storeJSONGet reads a key and unmarshals it as JSON into v.
func storeJSONGet(bucket, key string, v interface{}) error {
	data, err := storeGet(bucket, key)
	if err != nil {
		return err
	}
	if data == nil {
		return nil // not found is not an error
	}
	return json.Unmarshal(data, v)
}

// storeJSONPut marshals v as JSON and stores it.
func storeJSONPut(bucket, key string, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return storePut(bucket, key, data)
}

// --- migration from localStorage (one-shot) ---

func migrateFromLocalStorage(workspaceJSON, settingsJSON, mockJSON string) {
	if storeDB == nil {
		return
	}
	var migrated int
	_ = storeDB.Update(func(tx *bolt.Tx) error {
		wb := tx.Bucket([]byte("workspace"))
		mb := tx.Bucket([]byte("mock"))

		// Check if we already have data
		if wb.Get([]byte("v2")) != nil {
			return nil // already migrated
		}

		if workspaceJSON != "" {
			if err := wb.Put([]byte("v2"), []byte(workspaceJSON)); err == nil {
				migrated++
			}
			if settingsJSON != "" {
				if err := wb.Put([]byte("settings"), []byte(settingsJSON)); err == nil {
					migrated++
				}
			}
		}
		if mockJSON != "" {
			if err := mb.Put([]byte("config"), []byte(mockJSON)); err == nil {
				migrated++
			}
		}
		return nil
	})
	if migrated > 0 {
		log.Printf("[store] migrated %d keys from localStorage", migrated)
	}
}

// --- stats ---

func storeStats() map[string]interface{} {
	stats := map[string]interface{}{}
	if storeDB == nil {
		stats["ok"] = false
		stats["error"] = "db not open"
		return stats
	}
	info, _ := os.Stat(storePath())
	if info != nil {
		stats["fileSize"] = info.Size()
	}
	_ = storeDB.View(func(tx *bolt.Tx) error {
		for _, name := range storeBuckets {
			b := tx.Bucket([]byte(name))
			if b == nil {
				continue
			}
			count := 0
			c := b.Cursor()
			for k, _ := c.First(); k != nil; k, _ = c.Next() {
				count++
			}
			stats[name+"_keys"] = count
		}
		return nil
	})
	stats["ok"] = true
	return stats
}

// --- HTTP handlers ---

func storageStatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(storeStats())
}

func storageGetHandler(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	if bucket == "" || key == "" {
		http.Error(w, "bucket and key required", http.StatusBadRequest)
		return
	}
	data, err := storeGet(bucket, key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if data == nil {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`null`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func storagePutHandler(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	dlog("storagePutHandler", "scrittura valore nello store", map[string]any{"bucket": bucket, "key": key})
	if bucket == "" || key == "" {
		http.Error(w, "bucket and key required", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		dlogErr("storagePutHandler", "lettura body fallita", err, map[string]any{"bucket": bucket, "key": key})
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := storePut(bucket, key, body); err != nil {
		dlogErr("storagePutHandler", "storePut fallito", err, map[string]any{"bucket": bucket, "key": key})
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dlog("storagePutHandler", "valore salvato correttamente", map[string]any{"bucket": bucket, "key": key, "bytes": len(body)})
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func storageDeleteHandler(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	dlog("storageDeleteHandler", "eliminazione chiave dallo store", map[string]any{"bucket": bucket, "key": key})
	if bucket == "" || key == "" {
		http.Error(w, "bucket and key required", http.StatusBadRequest)
		return
	}
	if err := storeDelete(bucket, key); err != nil {
		dlogErr("storageDeleteHandler", "storeDelete fallito", err, map[string]any{"bucket": bucket, "key": key})
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dlog("storageDeleteHandler", "chiave eliminata correttamente", map[string]any{"bucket": bucket, "key": key})
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func storageListHandler(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	prefix := r.URL.Query().Get("prefix")
	if bucket == "" {
		http.Error(w, "bucket required", http.StatusBadRequest)
		return
	}
	keys, err := storeList(bucket, prefix)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if keys == nil {
		keys = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"bucket": bucket,
		"prefix": prefix,
		"keys":   keys,
		"count":  len(keys),
	})
}

func storageMigrateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Workspace string `json:"workspace"`
		Settings  string `json:"settings"`
		Mock      string `json:"mock"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	migrateFromLocalStorage(req.Workspace, req.Settings, req.Mock)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func storageExportHandler(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		http.Error(w, "bucket required", http.StatusBadRequest)
		return
	}
	export := map[string]string{}
	_ = storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			export[string(k)] = string(v)
		}
		return nil
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(export)
}

func storageImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		http.Error(w, "bucket required", http.StatusBadRequest)
		return
	}
	var data map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	count := 0
	_ = storeDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("bucket %s not found", bucket)
		}
		for k, v := range data {
			if err := b.Put([]byte(k), v); err != nil {
				return err
			}
			count++
		}
		return nil
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "imported": count})
}

// Snapshot: export all bbolt data as a single downloadable .adomnia-snapshot file.
func storageSnapshotHandler(w http.ResponseWriter, r *http.Request) {
	export := map[string]string{}
	if storeDB == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}
	_ = storeDB.View(func(tx *bolt.Tx) error {
		for _, bucket := range storeBuckets {
			b := tx.Bucket([]byte(bucket))
			if b == nil {
				continue
			}
			c := b.Cursor()
			for k, v := c.First(); k != nil; k, v = c.Next() {
				export[bucket+"/"+string(k)] = string(v)
			}
		}
		return nil
	})

	data, _ := json.MarshalIndent(export, "", "  ")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=adomnia-snapshot.json")
	w.Header().Set("X-Snapshot-Size", fmt.Sprintf("%d", len(data)))
	w.Write(data)
}

// Restore snapshot from uploaded file.
func storageRestoreHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 50*1024*1024)) // 50MB max
	var data map[string]string
	if err := json.Unmarshal(body, &data); err != nil {
		http.Error(w, "invalid snapshot: "+err.Error(), http.StatusBadRequest)
		return
	}
	if storeDB == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}
	restored := 0
	_ = storeDB.Update(func(tx *bolt.Tx) error {
		for key, val := range data {
			parts := strings.SplitN(key, "/", 2)
			if len(parts) != 2 {
				continue
			}
			b := tx.Bucket([]byte(parts[0]))
			if b == nil {
				continue
			}
			if err := b.Put([]byte(parts[1]), []byte(val)); err != nil {
				return err
			}
			restored++
		}
		return nil
	})

	log.Printf("[store] restored %d keys from snapshot", restored)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "restored": restored})
}

// Full-text search across all buckets.
func storageSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(r.URL.Query().Get("q"))
	bucket := r.URL.Query().Get("bucket")
	if q == "" {
		http.Error(w, "q required", http.StatusBadRequest)
		return
	}
	if storeDB == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}

	type hit struct {
		Bucket string `json:"bucket"`
		Key    string `json:"key"`
		Value  string `json:"value"`
	}
	results := make([]hit, 0)
	_ = storeDB.View(func(tx *bolt.Tx) error {
		buckets := storeBuckets
		if bucket != "" {
			buckets = []string{bucket}
		}
		for _, bname := range buckets {
			b := tx.Bucket([]byte(bname))
			if b == nil {
				continue
			}
			c := b.Cursor()
			for k, v := c.First(); k != nil; k, v = c.Next() {
				ks := strings.ToLower(string(k))
				vs := strings.ToLower(string(v))
				if strings.Contains(ks, q) || strings.Contains(vs, q) {
					val := string(v)
					if len(val) > 200 {
						val = val[:200] + "..."
					}
					results = append(results, hit{Bucket: bname, Key: string(k), Value: val})
					if len(results) >= 50 {
						return nil
					}
				}
			}
		}
		return nil
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"q":       q,
		"results": results,
		"count":   len(results),
	})
}
