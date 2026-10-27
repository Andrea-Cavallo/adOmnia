// Package bootstrap loads the renderer's critical startup state in one local
// database transaction.
package bootstrap

import (
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	"errors"
	"fmt"

	"github.com/Andrea-Cavallo/adOmnia/internal/collectionsstore"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
	bolt "go.etcd.io/bbolt"
)

const Version = 1

var (
	settingsKey     = storage.Key{Bucket: "workspace", Item: "settings"}
	environmentsKey = storage.Key{Bucket: "environments", Item: "all"}
	hostsKey        = storage.Key{Bucket: "hosts", Item: "all"}
	tabsCriticalKey = storage.Key{Bucket: "tabs", Item: "session-v3"}
	tabsLegacyKey   = storage.Key{Bucket: "tabs", Item: "session-v1"}
)

// State is a versioned envelope of raw persisted values. Raw JSON avoids a
// second encode/decode cycle in Go and preserves all frontend migrations.
type State struct {
	Version                   int    `json:"version"`
	Settings                  string `json:"settings"`
	Collections               string `json:"collections"`
	CollectionsSchema         int    `json:"collectionsSchema"`
	CollectionsIndex          string `json:"collectionsIndex"`
	ActiveCollectionWorkspace string `json:"activeCollectionWorkspace"`
	Environments              string `json:"environments"`
	Hosts                     string `json:"hosts"`
	Tabs                      string `json:"tabs"`
}

// StateV2 embeds persisted JSON directly in the Wails response. The runtime
// decodes each value as part of the response envelope, avoiding escaped JSON
// strings and a second JSON.parse in every frontend store.
type StateV2 struct {
	Version                   int               `json:"version"`
	Settings                  jsonv1.RawMessage `json:"settings"`
	CollectionsSchema         int               `json:"collectionsSchema"`
	CollectionsIndex          jsonv1.RawMessage `json:"collectionsIndex"`
	ActiveCollectionWorkspace jsonv1.RawMessage `json:"activeCollectionWorkspace"`
	Environments              jsonv1.RawMessage `json:"environments"`
	Hosts                     jsonv1.RawMessage `json:"hosts"`
	Tabs                      jsonv1.RawMessage `json:"tabs"`
	PayloadBytes              PayloadBytes      `json:"payloadBytes"`
}

type PayloadBytes struct {
	Settings                  int `json:"settings"`
	CollectionsIndex          int `json:"collectionsIndex"`
	ActiveCollectionWorkspace int `json:"activeCollectionWorkspace"`
	Environments              int `json:"environments"`
	Hosts                     int `json:"hosts"`
	Tabs                      int `json:"tabs"`
	Total                     int `json:"total"`
}

func Load() (State, error) {
	if storage.DB() == nil {
		return State{}, fmt.Errorf("storage not initialized")
	}

	var state State
	load := func(tx *bolt.Tx) error {
		read := func(key storage.Key) (string, error) {
			bucket := tx.Bucket([]byte(key.Bucket))
			if bucket == nil {
				return "", fmt.Errorf("bucket %s not found", key.Bucket)
			}
			return string(bucket.Get([]byte(key.Item))), nil
		}

		settings, err := read(settingsKey)
		if err != nil {
			return err
		}
		if settings == "" {
			settings = "{}"
		}
		environments, err := read(environmentsKey)
		if err != nil {
			return err
		}
		hosts, err := read(hostsKey)
		if err != nil {
			return err
		}
		tabs, err := read(tabsCriticalKey)
		if err != nil {
			return err
		}
		if tabs == "" {
			tabs, err = read(tabsLegacyKey)
			if err != nil {
				return err
			}
		}
		collections, err := collectionsstore.LoadCriticalTx(tx)
		if err != nil {
			return err
		}

		state = State{
			Version:                   Version,
			Settings:                  settings,
			Collections:               collections.LegacyJSON,
			CollectionsSchema:         collections.SchemaVersion,
			CollectionsIndex:          collections.IndexJSON,
			ActiveCollectionWorkspace: collections.ActiveWorkspace,
			Environments:              environments,
			Hosts:                     hosts,
			Tabs:                      tabs,
		}
		return nil
	}
	err := storage.DB().View(load)
	if errors.Is(err, collectionsstore.ErrMigrationRequired) {
		// Re-read everything in the write transaction: another caller may have
		// migrated or saved collections since the read transaction completed.
		err = storage.DB().Update(load)
	}
	if err != nil {
		return State{}, fmt.Errorf("load bootstrap state: %w", err)
	}
	return state, nil
}

func rawJSON(value, fallback string) (jsonv1.RawMessage, error) {
	if value == "" {
		value = fallback
	}
	if !jsontext.Value([]byte(value)).IsValid() {
		return nil, fmt.Errorf("invalid persisted JSON")
	}
	return jsonv1.RawMessage(value), nil
}

// LoadV2 preserves Load as a compatibility fallback while returning a
// structured envelope to current frontends.
func LoadV2() (StateV2, error) {
	legacy, err := Load()
	if err != nil {
		return StateV2{}, err
	}
	settings, err := rawJSON(legacy.Settings, "{}")
	if err != nil {
		return StateV2{}, err
	}
	index, err := rawJSON(legacy.CollectionsIndex, "null")
	if err != nil {
		return StateV2{}, err
	}
	// LoadCriticalTx already validated and normalized the active workspace.
	active := jsonv1.RawMessage(legacy.ActiveCollectionWorkspace)
	if len(active) == 0 {
		active = jsonv1.RawMessage("null")
	}
	environments, err := rawJSON(legacy.Environments, "null")
	if err != nil {
		return StateV2{}, err
	}
	hosts, err := rawJSON(legacy.Hosts, "null")
	if err != nil {
		return StateV2{}, err
	}
	tabs, err := rawJSON(legacy.Tabs, "null")
	if err != nil {
		return StateV2{}, err
	}
	return StateV2{
		Version:                   2,
		Settings:                  settings,
		CollectionsSchema:         legacy.CollectionsSchema,
		CollectionsIndex:          index,
		ActiveCollectionWorkspace: active,
		Environments:              environments,
		Hosts:                     hosts,
		Tabs:                      tabs,
		PayloadBytes: PayloadBytes{
			Settings:                  len(legacy.Settings),
			CollectionsIndex:          len(legacy.CollectionsIndex),
			ActiveCollectionWorkspace: len(legacy.ActiveCollectionWorkspace),
			Environments:              len(legacy.Environments),
			Hosts:                     len(legacy.Hosts),
			Tabs:                      len(legacy.Tabs),
			Total: len(legacy.Settings) + len(legacy.CollectionsIndex) + len(legacy.ActiveCollectionWorkspace) +
				len(legacy.Environments) + len(legacy.Hosts) + len(legacy.Tabs),
		},
	}, nil
}
