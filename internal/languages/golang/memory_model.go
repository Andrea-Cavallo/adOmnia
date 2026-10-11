package golang

import (
	"fmt"
	"sort"
	"strings"
)

// SyncGroup sono le operazioni del package su uno stesso oggetto di sincronizzazione, con gli archi
// happens-before che il Go memory model garantisce fra goroutine e i sospetti più comuni.
type SyncGroup struct {
	Target   string     `json:"target"`
	Kind     string     `json:"kind"` // channel | mutex | rwmutex | atomic | waitgroup | once | goroutine
	Ops      []ArchSync `json:"ops"`
	Edges    []string   `json:"edges"`
	Warnings []string   `json:"warnings"`
}

func groupKind(ops []ArchSync) string {
	for _, op := range ops {
		switch op.Kind {
		case "send", "recv", "close":
			return "channel"
		case "rlock", "runlock":
			return "rwmutex"
		case "lock", "unlock":
			return "mutex"
		case "atomic":
			return "atomic"
		case "wg-add", "wg-done", "wg-wait":
			return "waitgroup"
		case "once":
			return "once"
		case "go":
			return "goroutine"
		}
	}
	return "other"
}

func where(op ArchSync) string { return fmt.Sprintf("%s (%s:%d)", op.Function, op.Site.Path, op.Site.Line) }

func pick(ops []ArchSync, kinds ...string) []ArchSync {
	var out []ArchSync
	for _, op := range ops {
		for _, kind := range kinds {
			if op.Kind == kind {
				out = append(out, op)
			}
		}
	}
	return out
}

// MemoryModel raggruppa le operazioni di sincronizzazione del package di function per oggetto e
// spiega gli archi happens-before; con function vuota restituisce tutto il package.
func MemoryModel(syncs []ArchSync, pkg, function string) []SyncGroup {
	byTarget := map[string][]ArchSync{}
	used := map[string]bool{}
	for _, op := range syncs {
		if op.Package != pkg {
			continue
		}
		key := op.Target
		if op.Kind == "go" {
			key = "go " + op.Detail
		}
		byTarget[key] = append(byTarget[key], op)
		if function == "" || op.Function == function {
			used[key] = true
		}
	}
	keys := make([]string, 0, len(used))
	for key := range used {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	groups := []SyncGroup{}
	for _, key := range keys {
		ops := byTarget[key]
		group := SyncGroup{Target: key, Kind: groupKind(ops), Ops: ops, Edges: []string{}, Warnings: []string{}}
		switch group.Kind {
		case "channel":
			sends, recvs, closes := pick(ops, "send"), pick(ops, "recv"), pick(ops, "close")
			for _, send := range sends {
				for _, recv := range recvs {
					group.Edges = append(group.Edges, fmt.Sprintf("a send on %s in %s happens before the matching receive in %s completes (on an unbuffered channel, the receive also happens before the send completes)", key, where(send), where(recv)))
				}
			}
			for _, closed := range closes {
				for _, recv := range recvs {
					group.Edges = append(group.Edges, fmt.Sprintf("close(%s) in %s happens before %s receives the zero value because the channel is closed", key, where(closed), where(recv)))
				}
			}
			if len(sends) > 0 && len(recvs) == 0 {
				group.Warnings = append(group.Warnings, fmt.Sprintf("%s is sent to but never received from in this package: a sender can block forever (goroutine leak) unless another package receives", key))
			}
			if len(recvs) > 0 && len(sends) == 0 && len(closes) == 0 {
				group.Warnings = append(group.Warnings, fmt.Sprintf("%s is received from but never sent to or closed in this package", key))
			}
			if len(closes) > 1 {
				group.Warnings = append(group.Warnings, fmt.Sprintf("%s is closed in %d places: closing a closed channel panics", key, len(closes)))
			}
		case "mutex", "rwmutex":
			locks, unlocks := pick(ops, "lock", "rlock"), pick(ops, "unlock", "runlock")
			group.Edges = append(group.Edges, fmt.Sprintf("each Unlock of %s happens before the next Lock returns, so writes made while holding it are visible to the next holder", key))
			if group.Kind == "rwmutex" {
				group.Edges = append(group.Edges, fmt.Sprintf("an Unlock of %s happens before any later RLock returns; an RUnlock happens before the next Lock", key))
			}
			perFunction := map[string]int{}
			for _, op := range locks {
				perFunction[op.Function]++
			}
			for _, op := range unlocks {
				perFunction[op.Function]--
			}
			for name, balance := range perFunction {
				if balance > 0 {
					group.Warnings = append(group.Warnings, fmt.Sprintf("%s locks %s without unlocking it in the same function: use defer %s.Unlock() or check every return path", name, key, key))
				}
			}
		case "atomic":
			group.Edges = append(group.Edges, fmt.Sprintf("atomic operations on %s are sequentially consistent: if one observes the value written by another, the write happens before the read", key))
			group.Warnings = append(group.Warnings, fmt.Sprintf("only the atomic value itself is synchronized: other fields written before an atomic store of %s are visible to a reader only after it loads that store", key))
		case "waitgroup":
			if len(pick(ops, "wg-done")) > 0 && len(pick(ops, "wg-wait")) > 0 {
				group.Edges = append(group.Edges, fmt.Sprintf("every %s.Done happens before the %s.Wait it unblocks returns: results written by the goroutines are visible after Wait", key, key))
			}
			if adds := pick(ops, "wg-add"); len(adds) == 0 && len(pick(ops, "wg-done")) > 0 {
				group.Warnings = append(group.Warnings, fmt.Sprintf("%s.Done without Add in this package", key))
			}
		case "once":
			group.Edges = append(group.Edges, fmt.Sprintf("the function passed to %s.Do returns before any %s.Do call returns", key, key))
		case "goroutine":
			for _, op := range ops {
				group.Edges = append(group.Edges, fmt.Sprintf("the go statement in %s happens before %s starts: what was written before it is visible inside; nothing done inside is visible after it without a channel, mutex, WaitGroup or atomic", where(op), op.Detail))
			}
		}
		sort.Strings(group.Warnings)
		groups = append(groups, group)
	}
	return groups
}

// MemoryModelText è la spiegazione testuale (per l'AI o da copiare).
func MemoryModelText(function string, groups []SyncGroup) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Synchronization reached by %s (Go memory model):\n", function)
	for _, group := range groups {
		fmt.Fprintf(&b, "\n%s %s:\n", group.Kind, group.Target)
		for _, op := range group.Ops {
			fmt.Fprintf(&b, "- %s%s in %s\n", op.Kind, map[bool]string{true: " " + op.Detail, false: ""}[op.Detail != "" && op.Kind != "go"], where(op))
		}
		for _, edge := range group.Edges {
			fmt.Fprintf(&b, "  happens-before: %s\n", edge)
		}
		for _, warning := range group.Warnings {
			fmt.Fprintf(&b, "  warning: %s\n", warning)
		}
	}
	return b.String()
}
