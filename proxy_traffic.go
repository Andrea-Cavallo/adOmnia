package main

import (
	"fmt"
	"strings"
	"time"
)

func maskSensitiveHeaders(headers map[string]string) map[string]string {
	out := make(map[string]string, len(headers))
	for k, v := range headers {
		lk := strings.ToLower(k)
		if lk == "authorization" || lk == "cookie" || lk == "set-cookie" || strings.Contains(lk, "token") || strings.Contains(lk, "secret") || strings.Contains(lk, "key") {
			out[k] = "***redacted***"
		} else {
			out[k] = v
		}
	}
	return out
}

func recordEntry(url, method string, reqHeaders map[string]string, reqBody string, status int, respHeaders map[string]string, respBody string, duration time.Duration, errMsg string, matched bool, timing ...*requestTiming) {
	trafficMu.Lock()
	defer trafficMu.Unlock()

	trafficSeq++
	proxySettingsMu.RLock()
	reqLimit := proxySettings.ReqBodyLimitKB * 1024
	respLimit := proxySettings.RespBodyLimitKB * 1024
	maxEntries := proxySettings.MaxTrafficEntries
	proxySettingsMu.RUnlock()
	if reqLimit <= 0 {
		reqLimit = 32 * 1024
	}
	if respLimit <= 0 {
		respLimit = 64 * 1024
	}
	if maxEntries <= 0 {
		maxEntries = 500
	}

	entry := trafficEntry{
		ID:          fmt.Sprintf("t-%d", trafficSeq),
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		Method:      method,
		URL:         url,
		ReqHeaders:  maskSensitiveHeaders(reqHeaders),
		ReqBody:     truncateBody(reqBody, reqLimit),
		Status:      status,
		RespHeaders: maskSensitiveHeaders(respHeaders),
		RespBody:    truncateBody(respBody, respLimit),
		DurationMs:  float64(duration.Microseconds()) / 1000.0,
		Error:       errMsg,
		Matched:     matched,
	}
	if len(timing) > 0 && timing[0] != nil {
		entry.Timing = timing[0]
	}

	trafficLog = append(trafficLog, entry)
	if len(trafficLog) > maxEntries {
		trafficLog = trafficLog[len(trafficLog)-maxEntries:]
	}
}

func truncateBody(s string, max int) string {
	if len(s) > max {
		return s[:max] + "…[truncated]"
	}
	return s
}

func matchesGlob(url, pattern string) bool {
	if pattern == "" {
		return false
	}
	if strings.Contains(pattern, "*") {
		parts := strings.Split(pattern, "*")
		remaining := url
		for _, part := range parts {
			if part == "" {
				continue
			}
			idx := strings.Index(remaining, part)
			if idx < 0 {
				return false
			}
			remaining = remaining[idx+len(part):]
		}
		return true
	}
	return strings.Contains(url, pattern)
}

func matchesAnyPattern(url string, patterns []string) bool {
	for _, p := range patterns {
		if matchesGlob(url, p) {
			return true
		}
	}
	return false
}

func applyThrottleLatency() {
	proxyThrottleMu.RLock()
	latency := proxyThrottle.LatencyMs
	proxyThrottleMu.RUnlock()
	if latency > 0 {
		time.Sleep(time.Duration(latency) * time.Millisecond)
	}
}

func writeWithThrottle(w interface{ Write([]byte) (int, error) }, data []byte) {
	proxyThrottleMu.RLock()
	bw := proxyThrottle.BandwidthKbps
	proxyThrottleMu.RUnlock()
	if bw <= 0 {
		w.Write(data)
		return
	}
	chunkSize := (bw * 1024 / 8) / 10
	if chunkSize < 1024 {
		chunkSize = 1024
	}
	type flusher interface{ Flush() }
	for i := 0; i < len(data); i += chunkSize {
		end := i + chunkSize
		if end > len(data) {
			end = len(data)
		}
		w.Write(data[i:end])
		if f, ok := w.(flusher); ok {
			f.Flush()
		}
		time.Sleep(100 * time.Millisecond)
	}
}
