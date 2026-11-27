package database

import (
	"bytes"
	jsonv1 "encoding/json"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// mongoCollation parses {"locale": "it", "strength": 2, ...}; nil when absent.
func mongoCollation(raw jsonv1.RawMessage) (*options.Collation, error) {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return nil, nil
	}
	var c options.Collation
	dec := jsonv1.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("invalid collation: %w", err)
	}
	if c.Locale == "" {
		return nil, fmt.Errorf("invalid collation: locale is required")
	}
	return &c, nil
}

// mongoHint accepts an index name ("name_1") or a key document ({"name": 1}); nil when absent.
func mongoHint(raw jsonv1.RawMessage) (any, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" || string(trimmed) == `""` {
		return nil, nil
	}
	if trimmed[0] == '"' {
		var name string
		if err := jsonv1.Unmarshal(trimmed, &name); err != nil {
			return nil, fmt.Errorf("invalid hint: %w", err)
		}
		return name, nil
	}
	doc, err := mongoRawDoc(trimmed, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid hint: %w", err)
	}
	return doc, nil
}

// mongoTimeout caps the request timeout with the command's maxTimeMS (driver v2 enforces it via the context).
func mongoTimeout(requestMS, maxTimeMS int64) time.Duration {
	timeout := time.Duration(requestMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if maxTimeMS > 0 {
		if limit := time.Duration(maxTimeMS) * time.Millisecond; limit < timeout {
			return limit
		}
	}
	return timeout
}

// mongoReadOptions returns collation and hint shared by find, count and aggregate.
func mongoReadOptions(cmd mongoQueryCommand) (*options.Collation, any, error) {
	collation, err := mongoCollation(cmd.Collation)
	if err != nil {
		return nil, nil, err
	}
	hint, err := mongoHint(cmd.Hint)
	if err != nil {
		return nil, nil, err
	}
	return collation, hint, nil
}

// mongoReadOnlyCommands are runCommand names that never change data, so the Explorer can run them
// without the confirmation every other runCommand needs. MongoDB dispatches on the first key only;
// explain never executes the write it describes.
var mongoReadOnlyCommands = map[string]bool{
	"explain": true, "serverstatus": true, "currentop": true, "dbstats": true, "collstats": true,
	"buildinfo": true, "hostinfo": true, "ping": true, "connectionstatus": true, "top": true,
}

func mongoReadOnlyCommand(raw jsonv1.RawMessage) bool {
	var doc bson.D
	if len(bytes.TrimSpace(raw)) == 0 || bson.UnmarshalExtJSON(raw, false, &doc) != nil || len(doc) == 0 {
		return false
	}
	return mongoReadOnlyCommands[strings.ToLower(doc[0].Key)]
}
