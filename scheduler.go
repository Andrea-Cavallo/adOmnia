package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"adomnia/internal/httpexec"
	"adomnia/internal/storage"

	"github.com/robfig/cron/v3"
)

const (
	schedulerBucket  = "scheduler"
	jobKeyPrefix     = "job:"
	historyKeyPrefix = "history:"
	historyMaxRuns   = 50
)

// ScheduledJob is a persisted cron job that runs a saved request.
type ScheduledJob struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	CronExpr     string `json:"cronExpr"`
	RequestID    string `json:"requestId"`
	CollectionID string `json:"collectionId,omitempty"`
	Enabled      bool   `json:"enabled"`
	CreatedAt    string `json:"createdAt"`
	LastRunAt    string `json:"lastRunAt,omitempty"`
	NextRunAt    string `json:"nextRunAt,omitempty"`
}

// JobRun is a single capped-history execution record.
type JobRun struct {
	JobID      string `json:"jobId"`
	StartedAt  string `json:"startedAt"`
	Duration   int64  `json:"durationMs"`
	StatusCode int    `json:"statusCode"`
	Error      string `json:"error,omitempty"`
	Success    bool   `json:"success"`
}

// SchedulerBinding exposes cron-based request scheduling to the frontend.
// Persistence uses the shared bbolt storage; execution reuses httpexec so
// scheduled runs bypass browser CORS/header restrictions like normal requests.
type SchedulerBinding struct {
	cron     *cron.Cron
	mu       sync.Mutex
	entryIDs map[string]cron.EntryID // jobID -> cron entry ID
	started  bool
}

func NewSchedulerBinding() *SchedulerBinding {
	return &SchedulerBinding{
		// Standard 5-field cron + @descriptors (@hourly, @every 5m). No seconds
		// field, so validation (ParseStandard) and scheduling stay consistent.
		cron:     cron.New(),
		entryIDs: make(map[string]cron.EntryID),
	}
}

func schedulerNewID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("job-%d", time.Now().UnixNano())
	}
	return "job-" + hex.EncodeToString(buf)
}

// Start loads enabled jobs from storage and begins the cron loop.
func (s *SchedulerBinding) Start() {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.mu.Unlock()

	jobs, _ := s.listJobsInternal()
	for _, j := range jobs {
		if j.Enabled {
			_ = s.scheduleJob(j)
		}
	}
	s.cron.Start()
}

// Stop drains the cron loop gracefully.
func (s *SchedulerBinding) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
}

// ─── persistence helpers ────────────────────────────────────────────────────

func (s *SchedulerBinding) persistJob(job ScheduledJob) error {
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return storage.Put(schedulerBucket, jobKeyPrefix+job.ID, data)
}

func (s *SchedulerBinding) listJobsInternal() ([]ScheduledJob, error) {
	keys, err := storage.List(schedulerBucket, jobKeyPrefix)
	if err != nil {
		return nil, err
	}
	jobs := make([]ScheduledJob, 0, len(keys))
	for _, key := range keys {
		data, err := storage.Get(schedulerBucket, key)
		if err != nil || data == nil {
			continue
		}
		var j ScheduledJob
		if err := json.Unmarshal(data, &j); err == nil {
			jobs = append(jobs, j)
		}
	}
	return jobs, nil
}

func (s *SchedulerBinding) appendHistory(run JobRun) {
	key := historyKeyPrefix + run.JobID
	var runs []JobRun
	if existing, err := storage.Get(schedulerBucket, key); err == nil && existing != nil {
		_ = json.Unmarshal(existing, &runs)
	}
	runs = append([]JobRun{run}, runs...)
	if len(runs) > historyMaxRuns {
		runs = runs[:historyMaxRuns]
	}
	if data, err := json.Marshal(runs); err == nil {
		_ = storage.Put(schedulerBucket, key, data)
	}
}

// ─── request execution ──────────────────────────────────────────────────────

type schedKV struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type schedBody struct {
	Type string `json:"type"`
	Raw  string `json:"raw"`
}

type schedNode struct {
	ID            string      `json:"id"`
	Type          string      `json:"type"`
	Method        string      `json:"method"`
	URL           string      `json:"url"`
	Headers       []schedKV   `json:"headers"`
	Bodies        []schedBody `json:"bodies"`
	ActiveBodyIdx int         `json:"activeBodyIdx"`
	Children      []schedNode `json:"children"`
}

type schedCollectionsDoc struct {
	Workspaces []struct {
		Collections []struct {
			Children []schedNode `json:"children"`
		} `json:"collections"`
	} `json:"workspaces"`
	// Legacy top-level collections (pre-workspace schema).
	Collections []struct {
		Children []schedNode `json:"children"`
	} `json:"collections"`
}

func findNodeByID(nodes []schedNode, id string) *schedNode {
	for i := range nodes {
		if nodes[i].ID == id && nodes[i].Type == "request" {
			return &nodes[i]
		}
		if found := findNodeByID(nodes[i].Children, id); found != nil {
			return found
		}
	}
	return nil
}

// loadRequest finds a saved request item by ID across all persisted workspaces.
func loadRequest(requestID string) (*schedNode, error) {
	data, err := storage.Get("collections", "all")
	if err != nil {
		return nil, fmt.Errorf("read collections: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("no collections stored")
	}
	var doc schedCollectionsDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse collections: %w", err)
	}
	for _, ws := range doc.Workspaces {
		for _, col := range ws.Collections {
			if node := findNodeByID(col.Children, requestID); node != nil {
				return node, nil
			}
		}
	}
	for _, col := range doc.Collections {
		if node := findNodeByID(col.Children, requestID); node != nil {
			return node, nil
		}
	}
	return nil, fmt.Errorf("request %q not found in any collection", requestID)
}

// executeRequestByID runs a saved request via httpexec. NOTE (v1 limitation):
// environment variable substitution, auth flows, and pre/post scripts are NOT
// applied to scheduled runs — the request is sent with its stored URL, headers,
// and active raw body as-is.
func executeRequestByID(requestID string) (httpexec.HTTPExecResponse, error) {
	node, err := loadRequest(requestID)
	if err != nil {
		return httpexec.HTTPExecResponse{}, err
	}

	headers := map[string]string{}
	for _, h := range node.Headers {
		if h.Enabled && h.Key != "" {
			headers[h.Key] = h.Value
		}
	}

	body := ""
	if node.ActiveBodyIdx >= 0 && node.ActiveBodyIdx < len(node.Bodies) {
		b := node.Bodies[node.ActiveBodyIdx]
		if b.Type == "raw" {
			body = b.Raw
		}
	}

	method := node.Method
	if method == "" {
		method = "GET"
	}

	reqJSON, _ := json.Marshal(httpexec.HTTPExecRequest{
		Method:          method,
		URL:             node.URL,
		Headers:         headers,
		Body:            body,
		TimeoutMs:       30000,
		FollowRedirects: true,
	})

	var resp httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(httpexec.Execute(string(reqJSON))), &resp); err != nil {
		return httpexec.HTTPExecResponse{}, err
	}
	return resp, nil
}

// ─── scheduling ─────────────────────────────────────────────────────────────

func (s *SchedulerBinding) scheduleJob(job ScheduledJob) error {
	fn := func() {
		start := time.Now()
		run := JobRun{JobID: job.ID, StartedAt: start.UTC().Format(time.RFC3339)}
		resp, err := executeRequestByID(job.RequestID)
		run.Duration = time.Since(start).Milliseconds()
		if err != nil {
			run.Error = err.Error()
		} else if resp.Error != nil {
			run.Error = resp.Error.Message
			run.StatusCode = resp.Status
		} else {
			run.StatusCode = resp.Status
			run.Success = resp.Status >= 200 && resp.Status < 400
		}
		s.appendHistory(run)

		s.mu.Lock()
		jobs, _ := s.listJobsInternal()
		for _, j := range jobs {
			if j.ID == job.ID {
				j.LastRunAt = run.StartedAt
				_ = s.persistJob(j)
				break
			}
		}
		s.mu.Unlock()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if eid, ok := s.entryIDs[job.ID]; ok {
		s.cron.Remove(eid)
		delete(s.entryIDs, job.ID)
	}
	eid, err := s.cron.AddFunc(job.CronExpr, fn)
	if err != nil {
		return err
	}
	s.entryIDs[job.ID] = eid
	return nil
}

// ─── Wails-bound public API ─────────────────────────────────────────────────

func (s *SchedulerBinding) AddJob(name, cronExpr, requestID string) (ScheduledJob, error) {
	if _, err := cron.ParseStandard(cronExpr); err != nil {
		return ScheduledJob{}, fmt.Errorf("invalid cron expression: %w", err)
	}
	job := ScheduledJob{
		ID:        schedulerNewID(),
		Name:      name,
		CronExpr:  cronExpr,
		RequestID: requestID,
		Enabled:   true,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.persistJob(job); err != nil {
		return ScheduledJob{}, err
	}
	if err := s.scheduleJob(job); err != nil {
		return ScheduledJob{}, err
	}
	return job, nil
}

func (s *SchedulerBinding) UpdateJob(id, name, cronExpr, requestID string) (ScheduledJob, error) {
	if _, err := cron.ParseStandard(cronExpr); err != nil {
		return ScheduledJob{}, fmt.Errorf("invalid cron expression: %w", err)
	}
	jobs, _ := s.listJobsInternal()
	for _, j := range jobs {
		if j.ID == id {
			j.Name = name
			j.CronExpr = cronExpr
			j.RequestID = requestID
			if err := s.persistJob(j); err != nil {
				return j, err
			}
			if j.Enabled {
				if err := s.scheduleJob(j); err != nil {
					return j, err
				}
			}
			return j, nil
		}
	}
	return ScheduledJob{}, fmt.Errorf("job %s not found", id)
}

func (s *SchedulerBinding) DeleteJob(id string) error {
	s.mu.Lock()
	if eid, ok := s.entryIDs[id]; ok {
		s.cron.Remove(eid)
		delete(s.entryIDs, id)
	}
	s.mu.Unlock()
	_ = storage.Delete(schedulerBucket, historyKeyPrefix+id)
	return storage.Delete(schedulerBucket, jobKeyPrefix+id)
}

func (s *SchedulerBinding) EnableJob(id string) error  { return s.setEnabled(id, true) }
func (s *SchedulerBinding) DisableJob(id string) error { return s.setEnabled(id, false) }

func (s *SchedulerBinding) setEnabled(id string, enabled bool) error {
	jobs, _ := s.listJobsInternal()
	for _, j := range jobs {
		if j.ID == id {
			j.Enabled = enabled
			if err := s.persistJob(j); err != nil {
				return err
			}
			if enabled {
				return s.scheduleJob(j)
			}
			s.mu.Lock()
			if eid, ok := s.entryIDs[id]; ok {
				s.cron.Remove(eid)
				delete(s.entryIDs, id)
			}
			s.mu.Unlock()
			return nil
		}
	}
	return fmt.Errorf("job %s not found", id)
}

func (s *SchedulerBinding) ListJobs() ([]ScheduledJob, error) {
	jobs, err := s.listJobsInternal()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range jobs {
		if eid, ok := s.entryIDs[jobs[i].ID]; ok {
			entry := s.cron.Entry(eid)
			if !entry.Next.IsZero() {
				jobs[i].NextRunAt = entry.Next.UTC().Format(time.RFC3339)
			}
		}
	}
	return jobs, nil
}

func (s *SchedulerBinding) GetHistory(jobID string) ([]JobRun, error) {
	runs := []JobRun{}
	data, err := storage.Get(schedulerBucket, historyKeyPrefix+jobID)
	if err != nil || data == nil {
		return runs, nil
	}
	_ = json.Unmarshal(data, &runs)
	return runs, nil
}
