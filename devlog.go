// devlog.go — shim di transizione: delega a internal/devlog.
// Rimuovere quando tutti i package saranno migrati a internal/.
package main

import "adomnia/internal/devlog"

func dlog(fn, msg string, data map[string]any)               { devlog.Log(fn, msg, data) }
func dlogInfo(fn, msg string, data map[string]any)           { devlog.Info(fn, msg, data) }
func dlogErr(fn, msg string, err error, data map[string]any) { devlog.Err(fn, msg, err, data) }
