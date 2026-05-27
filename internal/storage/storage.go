// storage.go — embedded bbolt key/value storage engine for adOmnia.
// Replaces localStorage for workspace, history, mock config, and proxy config.
// Single-file DB, ACID transactions, zero runtime deps.

package storage

import (
	"adomnia/internal/devlog"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

var (
	db      *bolt.DB
	baseDir string
)

// Bucket names
var storeBuckets = []string{
	"workspace",    // workspace payloads, app settings
	"collections",  // collection tree
	"environments", // environments and active env
	"tabs",         // open request tabs and response history
	"database",     // database studio connections/history/favorites
	"history",      // request/response history
	"mock",         // mock server config + hits
	"proxy",        // proxy/interceptor config + traffic
}

const storagePutMaxBodyBytes = 10 * 1024 * 1024

func isStoreBucketAllowed(bucket string) bool {
	for _, name := range storeBuckets {
		if bucket == name {
			return true
		}
	}
	return false
}

func validateStoreBucket(bucket string) error {
	if bucket == "" {
		return fmt.Errorf("bucket required")
	}
	if !isStoreBucketAllowed(bucket) {
		return fmt.Errorf("unknown storage bucket %q", bucket)
	}
	return nil
}

func storeDir() string {
	d := baseDir
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

// Path returns the local database file path.
func Path() string { return storePath() }

// DataDir returns the configured application data directory.
func DataDir() string { return baseDir }

// Buckets returns the stable list of persisted application buckets.
func Buckets() []string {
	return append([]string(nil), storeBuckets...)
}

// Open opens the local bbolt storage database within the application data directory.
func Open(dataDirectory string) error {
	baseDir = dataDirectory
	dir := storeDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	openedDB, err := bolt.Open(storePath(), 0600, &bolt.Options{
		Timeout:      5 * time.Second,
		NoGrowSync:   false,
		FreelistType: bolt.FreelistMapType,
	})
	if err != nil {
		return err
	}

	// Ensure buckets exist
	err = openedDB.Update(func(tx *bolt.Tx) error {
		for _, b := range storeBuckets {
			if _, err := tx.CreateBucketIfNotExists([]byte(b)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		openedDB.Close()
		return err
	}

	db = openedDB
	log.Printf("[store] bbolt opened: %s", storePath())
	return nil
}

// DB returns the currently opened local database.
func DB() *bolt.DB { return db }

// Close closes the local storage database.
func Close() {
	if db != nil {
		db.Close()
		log.Println("[store] bbolt closed")
	}
}

// --- generic helpers ---

func Get(bucket, key string) ([]byte, error) {
	if err := validateStoreBucket(bucket); err != nil {
		return nil, err
	}
	var val []byte
	err := db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("bucket %s not found", bucket)
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

func Put(bucket, key string, value []byte) error {
	if err := validateStoreBucket(bucket); err != nil {
		return err
	}
	err := db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("bucket %s not found", bucket)
		}
		return b.Put([]byte(key), value)
	})
	if err != nil {
		return fmt.Errorf("store put %s/%s: %w", bucket, key, err)
	}
	return nil
}

func Delete(bucket, key string) error {
	if err := validateStoreBucket(bucket); err != nil {
		return err
	}
	err := db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("bucket %s not found", bucket)
		}
		return b.Delete([]byte(key))
	})
	if err != nil {
		return fmt.Errorf("store delete %s/%s: %w", bucket, key, err)
	}
	return nil
}

func List(bucket, prefix string) ([]string, error) {
	if err := validateStoreBucket(bucket); err != nil {
		return nil, err
	}
	var keys []string
	err := db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("bucket %s not found", bucket)
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

// storeJSONPut marshals v as JSON and stores it.
func storeJSONPut(bucket, key string, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return Put(bucket, key, data)
}

// --- migration from localStorage (one-shot) ---

func migrateFromLocalStorage(workspaceJSON, settingsJSON, mockJSON string) {
	if db == nil {
		return
	}
	var migrated int
	_ = db.Update(func(tx *bolt.Tx) error {
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
	if db == nil {
		stats["ok"] = false
		stats["error"] = "db not open"
		return stats
	}
	info, _ := os.Stat(storePath())
	if info != nil {
		stats["fileSize"] = info.Size()
	}
	_ = db.View(func(tx *bolt.Tx) error {
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
	data, err := Get(bucket, key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
	devlog.Log("storagePutHandler", "scrittura valore nello store", map[string]any{"bucket": bucket, "key": key})
	if bucket == "" || key == "" {
		http.Error(w, "bucket and key required", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, storagePutMaxBodyBytes))
	if err != nil {
		devlog.Err("storagePutHandler", "lettura body fallita", err, map[string]any{"bucket": bucket, "key": key})
		http.Error(w, fmt.Sprintf("storage value too large or unreadable: max %d bytes", storagePutMaxBodyBytes), http.StatusRequestEntityTooLarge)
		return
	}
	if err := Put(bucket, key, body); err != nil {
		devlog.Err("storagePutHandler", "storePut fallito", err, map[string]any{"bucket": bucket, "key": key})
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	devlog.Log("storagePutHandler", "valore salvato correttamente", map[string]any{"bucket": bucket, "key": key, "bytes": len(body)})
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func storageDeleteHandler(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	key := r.URL.Query().Get("key")
	devlog.Log("storageDeleteHandler", "eliminazione chiave dallo store", map[string]any{"bucket": bucket, "key": key})
	if bucket == "" || key == "" {
		http.Error(w, "bucket and key required", http.StatusBadRequest)
		return
	}
	if err := Delete(bucket, key); err != nil {
		devlog.Err("storageDeleteHandler", "storeDelete fallito", err, map[string]any{"bucket": bucket, "key": key})
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	devlog.Log("storageDeleteHandler", "chiave eliminata correttamente", map[string]any{"bucket": bucket, "key": key})
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
	keys, err := List(bucket, prefix)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
	if err := validateStoreBucket(bucket); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	export := map[string]string{}
	if err := db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("bucket %s not found", bucket)
		}
		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			export[string(k)] = string(v)
		}
		return nil
	}); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(export)
}

func storageImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	bucket := r.URL.Query().Get("bucket")
	if err := validateStoreBucket(bucket); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var data map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	count := 0
	if err := db.Update(func(tx *bolt.Tx) error {
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
	}); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "imported": count})
}

// Snapshot: export all bbolt data as a single downloadable .adomnia-snapshot file.
func storageSnapshotHandler(w http.ResponseWriter, r *http.Request) {
	export := map[string]string{}
	if db == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}
	_ = db.View(func(tx *bolt.Tx) error {
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
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 50*1024*1024)) // 50MB max
	if err != nil {
		http.Error(w, "snapshot too large or unreadable", http.StatusRequestEntityTooLarge)
		return
	}
	var data map[string]string
	if err := json.Unmarshal(body, &data); err != nil {
		http.Error(w, "invalid snapshot: "+err.Error(), http.StatusBadRequest)
		return
	}
	if db == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}
	restored := 0
	if err := db.Update(func(tx *bolt.Tx) error {
		for key, val := range data {
			parts := strings.SplitN(key, "/", 2)
			if len(parts) != 2 {
				continue
			}
			if !isStoreBucketAllowed(parts[0]) {
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
	}); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

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
	if db == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}
	if bucket != "" {
		if err := validateStoreBucket(bucket); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	type hit struct {
		Bucket string `json:"bucket"`
		Key    string `json:"key"`
		Value  string `json:"value"`
	}
	results := make([]hit, 0)
	_ = db.View(func(tx *bolt.Tx) error {
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

// RegisterHandlers registers storage and saved workspace endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/storage/status", storageStatusHandler)
	mux.HandleFunc("/storage/get", storageGetHandler)
	mux.HandleFunc("/storage/put", storagePutHandler)
	mux.HandleFunc("/storage/delete", storageDeleteHandler)
	mux.HandleFunc("/storage/list", storageListHandler)
	mux.HandleFunc("/storage/migrate", storageMigrateHandler)
	mux.HandleFunc("/storage/export", storageExportHandler)
	mux.HandleFunc("/storage/import", storageImportHandler)
	mux.HandleFunc("/storage/snapshot", storageSnapshotHandler)
	mux.HandleFunc("/storage/restore", storageRestoreHandler)
	mux.HandleFunc("/storage/search", storageSearchHandler)
	mux.HandleFunc("/workspace/list", workspaceListHandler)
	mux.HandleFunc("/workspace/save", workspaceSaveHandler)
	mux.HandleFunc("/workspace/load", workspaceLoadHandler)
	mux.HandleFunc("/workspace/delete", workspaceDeleteHandler)
}
