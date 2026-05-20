package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/spf13/cobra"
)

var (
	ltConcurrency int
	ltRequests    int
	ltDuration    int
	ltTimeout     int
	ltRampUp      int
	ltReport      string
)

var loadtestCmd = &cobra.Command{
	Use:   "loadtest <scenario.json>",
	Short: "Run a load test from a scenario file",
	Long:  "Execute a load test against an endpoint with configurable concurrency, duration, and reporting.",
	Args:  cobra.ExactArgs(1),
	RunE:  runLoadTest,
}

func init() {
	loadtestCmd.Flags().IntVarP(&ltConcurrency, "concurrency", "c", 10, "Number of concurrent workers")
	loadtestCmd.Flags().IntVarP(&ltRequests, "requests", "n", 100, "Total number of requests")
	loadtestCmd.Flags().IntVarP(&ltDuration, "duration", "d", 0, "Duration in seconds (overrides --requests)")
	loadtestCmd.Flags().IntVarP(&ltTimeout, "timeout", "t", 30000, "Request timeout in milliseconds")
	loadtestCmd.Flags().IntVar(&ltRampUp, "ramp-up", 0, "Ramp-up time in milliseconds")
	loadtestCmd.Flags().StringVarP(&ltReport, "report", "r", "", "Output report file (.json)")
}

type ltScenario struct {
	URL         string            `json:"url"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
	Concurrency int               `json:"concurrency"`
	TotalReqs   int               `json:"totalReqs"`
	DurationS   int               `json:"durationS"`
	TimeoutMs   int               `json:"timeoutMs"`
	RampUpMs    int               `json:"rampUpMs"`
}

type ltResult struct {
	TotalRequests int         `json:"totalRequests"`
	Successful    int         `json:"successful"`
	Failed        int         `json:"failed"`
	TotalTimeMs   float64     `json:"totalTimeMs"`
	AvgMs         float64     `json:"avgMs"`
	MinMs         float64     `json:"minMs"`
	MaxMs         float64     `json:"maxMs"`
	P50Ms         float64     `json:"p50Ms"`
	P90Ms         float64     `json:"p90Ms"`
	P95Ms         float64     `json:"p95Ms"`
	P99Ms         float64     `json:"p99Ms"`
	Throughput    float64     `json:"throughput"`
	ErrorRate     float64     `json:"errorRate"`
	StatusCodes   map[int]int `json:"statusCodes"`
}

type ltSample struct {
	DurationMs float64
	Status     int
	Err        error
}

func runLoadTest(cmd *cobra.Command, args []string) error {
	data, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("failed to read scenario: %w", err)
	}

	var scenario ltScenario
	if err := json.Unmarshal(data, &scenario); err != nil {
		return fmt.Errorf("failed to parse scenario: %w", err)
	}

	if cmd.Flags().Changed("concurrency") {
		scenario.Concurrency = ltConcurrency
	} else if scenario.Concurrency == 0 {
		scenario.Concurrency = ltConcurrency
	}

	if cmd.Flags().Changed("requests") {
		scenario.TotalReqs = ltRequests
	} else if scenario.TotalReqs == 0 && scenario.DurationS == 0 {
		scenario.TotalReqs = ltRequests
	}

	if cmd.Flags().Changed("duration") {
		scenario.DurationS = ltDuration
	}

	if cmd.Flags().Changed("timeout") {
		scenario.TimeoutMs = ltTimeout
	} else if scenario.TimeoutMs == 0 {
		scenario.TimeoutMs = ltTimeout
	}

	if cmd.Flags().Changed("ramp-up") {
		scenario.RampUpMs = ltRampUp
	}

	if scenario.Method == "" {
		scenario.Method = "GET"
	}

	if scenario.URL == "" {
		return fmt.Errorf("scenario URL is required")
	}

	fmt.Printf("Load Test: %s %s\n", scenario.Method, scenario.URL)
	fmt.Printf("Concurrency: %d", scenario.Concurrency)
	if scenario.DurationS > 0 {
		fmt.Printf(" | Duration: %ds", scenario.DurationS)
	} else {
		fmt.Printf(" | Requests: %d", scenario.TotalReqs)
	}
	fmt.Printf(" | Timeout: %dms\n", scenario.TimeoutMs)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	result := executeLoadTest(scenario)

	fmt.Printf("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
	fmt.Printf("Results:\n")
	fmt.Printf("  Total:      %d requests in %.2fs\n", result.TotalRequests, result.TotalTimeMs/1000)
	fmt.Printf("  Success:    %d (%.1f%%)\n", result.Successful, 100-result.ErrorRate*100)
	fmt.Printf("  Failed:     %d (%.1f%%)\n", result.Failed, result.ErrorRate*100)
	fmt.Printf("  Throughput: %.1f req/s\n", result.Throughput)
	fmt.Printf("\n  Latency:\n")
	fmt.Printf("    Min:  %.2fms\n", result.MinMs)
	fmt.Printf("    Avg:  %.2fms\n", result.AvgMs)
	fmt.Printf("    P50:  %.2fms\n", result.P50Ms)
	fmt.Printf("    P90:  %.2fms\n", result.P90Ms)
	fmt.Printf("    P95:  %.2fms\n", result.P95Ms)
	fmt.Printf("    P99:  %.2fms\n", result.P99Ms)
	fmt.Printf("    Max:  %.2fms\n", result.MaxMs)

	if len(result.StatusCodes) > 0 {
		fmt.Printf("\n  Status Codes:\n")
		for code, count := range result.StatusCodes {
			fmt.Printf("    %d: %d\n", code, count)
		}
	}

	if ltReport != "" {
		reportData, _ := json.MarshalIndent(result, "", "  ")
		if err := os.WriteFile(ltReport, reportData, 0644); err != nil {
			return fmt.Errorf("failed to write report: %w", err)
		}
		fmt.Printf("\nReport saved to: %s\n", ltReport)
	}

	return nil
}

func executeLoadTest(s ltScenario) ltResult {
	client := &http.Client{Timeout: time.Duration(s.TimeoutMs) * time.Millisecond}

	var samples []ltSample
	var mu sync.Mutex

	work := make(chan struct{}, s.Concurrency*2)
	var wg sync.WaitGroup

	startTime := time.Now()

	for i := 0; i < s.Concurrency; i++ {
		if s.RampUpMs > 0 {
			delay := time.Duration(s.RampUpMs/s.Concurrency*i) * time.Millisecond
			time.Sleep(delay)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range work {
				sample := doRequest(client, s)
				mu.Lock()
				samples = append(samples, sample)
				count := len(samples)
				mu.Unlock()

				if count%50 == 0 {
					fmt.Printf("  ... %d requests completed\n", count)
				}
			}
		}()
	}

	if s.DurationS > 0 {
		deadline := time.After(time.Duration(s.DurationS) * time.Second)
		go func() {
			for {
				select {
				case <-deadline:
					close(work)
					return
				default:
					work <- struct{}{}
				}
			}
		}()
	} else {
		go func() {
			for i := 0; i < s.TotalReqs; i++ {
				work <- struct{}{}
			}
			close(work)
		}()
	}

	wg.Wait()
	totalTime := time.Since(startTime)

	return computeResults(samples, totalTime)
}

func doRequest(client *http.Client, s ltScenario) ltSample {
	var bodyReader io.Reader
	if s.Body != "" {
		bodyReader = strings.NewReader(s.Body)
	}

	req, err := http.NewRequest(s.Method, s.URL, bodyReader)
	if err != nil {
		return ltSample{Err: err}
	}

	for k, v := range s.Headers {
		req.Header.Set(k, v)
	}

	t0 := time.Now()
	resp, err := client.Do(req)
	duration := float64(time.Since(t0).Microseconds()) / 1000.0

	if err != nil {
		return ltSample{DurationMs: duration, Err: err}
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	return ltSample{DurationMs: duration, Status: resp.StatusCode}
}

func computeResults(samples []ltSample, totalTime time.Duration) ltResult {
	if len(samples) == 0 {
		return ltResult{}
	}

	result := ltResult{
		TotalRequests: len(samples),
		TotalTimeMs:   float64(totalTime.Milliseconds()),
		StatusCodes:   make(map[int]int),
		MinMs:         math.MaxFloat64,
	}

	var durations []float64
	var sum float64

	for _, s := range samples {
		if s.Err != nil {
			result.Failed++
			continue
		}
		if s.Status >= 200 && s.Status < 400 {
			result.Successful++
		} else {
			result.Failed++
		}
		if s.Status > 0 {
			result.StatusCodes[s.Status]++
		}
		durations = append(durations, s.DurationMs)
		sum += s.DurationMs
		if s.DurationMs < result.MinMs {
			result.MinMs = s.DurationMs
		}
		if s.DurationMs > result.MaxMs {
			result.MaxMs = s.DurationMs
		}
	}

	if len(durations) > 0 {
		result.AvgMs = sum / float64(len(durations))
		sort.Float64s(durations)
		result.P50Ms = percentile(durations, 50)
		result.P90Ms = percentile(durations, 90)
		result.P95Ms = percentile(durations, 95)
		result.P99Ms = percentile(durations, 99)
	}

	if result.MinMs == math.MaxFloat64 {
		result.MinMs = 0
	}

	if result.TotalTimeMs > 0 {
		result.Throughput = float64(result.TotalRequests) / (result.TotalTimeMs / 1000.0)
	}
	if result.TotalRequests > 0 {
		result.ErrorRate = float64(result.Failed) / float64(result.TotalRequests)
	}

	return result
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := (p / 100.0) * float64(len(sorted)-1)
	lower := int(math.Floor(idx))
	upper := int(math.Ceil(idx))
	if lower == upper || upper >= len(sorted) {
		return sorted[lower]
	}
	frac := idx - float64(lower)
	return sorted[lower]*(1-frac) + sorted[upper]*frac
}
