package agenttask

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"
)

const ChangedEvent = "agenttask.changed"

type RunRequest struct {
	Task    Task
	Attempt Attempt
	Message string
}

type Runtime interface {
	Run(context.Context, RunRequest, func(Event)) error
}

type Service struct {
	mu          sync.Mutex
	store       Store
	tasks       map[string]Task
	runtimes    map[string]Runtime
	running     map[string]context.CancelFunc
	now         func() time.Time
	emit        func(string, any)
	lastPublish time.Time
	// workspaces e verifier sono forniti dall'host: il core definisce i contratti e
	// conserva i risultati, ma non esegue processi né duplica i servizi esistenti.
	workspaces WorkspaceProvider
	verifier   Verifier
	// verifying evita due esecuzioni concorrenti delle verifiche dello stesso task.
	verifying map[string]bool
	// autoVerify contiene le verifiche da rieseguire quando una correzione è completata.
	// Vive solo in memoria: dopo un riavvio nessuna verifica riparte da sola.
	autoVerify map[string][]string
}

// streamPublishInterval limita la frequenza degli aggiornamenti verso la UI
// durante lo streaming: ogni evento resta nel task, ma il clone completo non
// viene serializzato a ogni token. Il finish pubblica sempre lo stato finale.
var streamPublishInterval = 100 * time.Millisecond

func NewService(store Store) (*Service, error) {
	snapshot, err := store.Load()
	if err != nil {
		return nil, err
	}
	service := &Service{
		store: store, tasks: map[string]Task{}, runtimes: map[string]Runtime{},
		running: map[string]context.CancelFunc{}, now: time.Now,
		verifying: map[string]bool{}, autoVerify: map[string][]string{},
	}
	for _, task := range snapshot.Tasks {
		service.tasks[task.ID] = cloneTask(task)
	}
	if service.recoverActiveLocked() {
		if err := service.saveLocked(); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func (service *Service) SetEmitter(emit func(string, any)) {
	service.mu.Lock()
	service.emit = emit
	service.mu.Unlock()
}

func (service *Service) RegisterRuntime(agent string, runtime Runtime) {
	service.mu.Lock()
	defer service.mu.Unlock()
	if runtime == nil {
		delete(service.runtimes, strings.TrimSpace(agent))
		return
	}
	service.runtimes[strings.TrimSpace(agent)] = runtime
}

func (service *Service) List(root string) []Task {
	service.mu.Lock()
	defer service.mu.Unlock()
	root = strings.TrimSpace(root)
	tasks := make([]Task, 0, len(service.tasks))
	for _, task := range service.tasks {
		if root == "" || task.Root == root {
			tasks = append(tasks, cloneTask(task))
		}
	}
	sort.Slice(tasks, func(left, right int) bool { return tasks[left].UpdatedAt.After(tasks[right].UpdatedAt) })
	return tasks
}

func (service *Service) Get(id string) (Task, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Task{}, errors.New("agent task not found")
	}
	return cloneTask(task), nil
}

func (service *Service) Create(draft Draft) (Task, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, err := NewTask(draft, service.now())
	if err != nil {
		return Task{}, err
	}
	service.tasks[task.ID] = task
	if err := service.saveLocked(); err != nil {
		delete(service.tasks, task.ID)
		return Task{}, err
	}
	service.publishLocked(task)
	return cloneTask(task), nil
}

func (service *Service) Update(id string, draft Draft) (Task, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		return Task{}, errors.New("stop the task before editing it")
	}
	normalized, err := normalizeDraft(draft)
	if err != nil {
		return Task{}, err
	}
	previous := cloneTask(task)
	task.Root, task.UnitID = normalized.Root, normalized.UnitID
	task.Intent, task.Objective = normalized.Intent, normalized.Objective
	task.Criteria, task.Paths = normalized.Criteria, normalized.Paths
	task.Dependencies, task.Agent = normalized.Dependencies, normalized.Agent
	task.Limits = normalized.Limits
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.tasks[id] = previous
		return Task{}, err
	}
	service.publishLocked(task)
	return cloneTask(task), nil
}

func (service *Service) Start(id, message string, receipt ContextReceipt) (Task, error) {
	return service.start(id, message, receipt, "", nil, nil)
}

// start avvia un tentativo. correctionOf/evidenceIDs legano una correzione alle evidenze
// selezionate; autoVerify elenca le verifiche da rieseguire quando il tentativo finisce.
func (service *Service) start(id, message string, receipt ContextReceipt, correctionOf string, evidenceIDs, autoVerify []string) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		service.mu.Unlock()
		return Task{}, errors.New("task is already active")
	}
	if strings.TrimSpace(message) == "" {
		service.mu.Unlock()
		return Task{}, errors.New("approved task context is required")
	}
	if receipt.Bytes < 0 || receipt.Bytes > task.Limits.MaxContextBytes {
		service.mu.Unlock()
		return Task{}, errors.New("approved context exceeds the task limit")
	}
	// Cartelle di lavoro distinte possono procedere in parallelo: due task sullo
	// stesso checkout si sovrascriverebbero a vicenda e restano esclusi.
	workdir := task.workdir()
	for _, other := range service.tasks {
		if other.ID != id && other.Active() && other.workdir() == workdir {
			service.mu.Unlock()
			return Task{}, errors.New("another task is already active in this working tree; give each task its own isolated workspace")
		}
	}
	runtime := service.runtimes[task.Agent]
	if runtime == nil {
		service.mu.Unlock()
		return Task{}, fmt.Errorf("agent %s is not available for tasks", task.Agent)
	}
	now := service.now().UTC()
	attempt := Attempt{
		ID: newID("attempt"), Status: StatusRunning, NewSession: true,
		Context: receipt, Prompt: redactAndLimit(message), StartedAt: now, Events: []Event{},
		CorrectionOf: correctionOf, EvidenceIDs: append([]string(nil), evidenceIDs...),
	}
	previous := cloneTask(task)
	task.Status, task.ActiveAttemptID = StatusRunning, attempt.ID
	task.LastContext, task.UpdatedAt = receipt, now
	task.Attempts = append(task.Attempts, attempt)
	service.tasks[id] = task
	if len(autoVerify) > 0 {
		service.autoVerify[id] = append([]string(nil), autoVerify...)
	}
	if err := service.saveLocked(); err != nil {
		service.tasks[id] = previous
		delete(service.autoVerify, id)
		service.mu.Unlock()
		return Task{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(task.Limits.TimeoutMinutes)*time.Minute)
	service.running[id] = cancel
	// L'agente lavora nella cartella isolata: il runtime riceve la directory del
	// workspace, mentre il task conserva la radice del progetto.
	requestTask := cloneTask(task)
	requestTask.Root = workdir
	request := RunRequest{Task: requestTask, Attempt: attempt, Message: message}
	service.appendEventLocked(id, attempt.ID, Event{Kind: "lifecycle", Message: "Task started in a new agent session"})
	service.publishLocked(task)
	service.mu.Unlock()
	go service.run(ctx, cancel, runtime, request)
	return service.Get(id)
}

func (service *Service) run(ctx context.Context, cancel context.CancelFunc, runtime Runtime, request RunRequest) {
	defer cancel()
	err := runtime.Run(ctx, request, func(event Event) {
		service.mu.Lock()
		defer service.mu.Unlock()
		service.appendEventLocked(request.Task.ID, request.Attempt.ID, event)
	})
	service.finish(request.Task.ID, request.Attempt.ID, ctx, err)
}

func (service *Service) finish(id, attemptID string, ctx context.Context, runErr error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	delete(service.running, id)
	task, ok := service.tasks[id]
	if !ok || task.ActiveAttemptID != attemptID {
		return
	}
	attempt := &task.Attempts[len(task.Attempts)-1]
	now := service.now().UTC()
	attempt.EndedAt = &now
	stopping := task.Status == StatusStopping
	switch {
	case stopping || errors.Is(runErr, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) && runErr == nil:
		task.Status, attempt.Status = StatusStopped, StatusStopped
		service.appendEventTaskLocked(&task, attemptID, Event{Kind: "lifecycle", Message: "Task stopped"})
	case runErr != nil:
		task.Status, attempt.Status = StatusFailed, StatusFailed
		attempt.Error = redactAndLimit(runErr.Error())
		service.appendEventTaskLocked(&task, attemptID, Event{Kind: "error", Message: attempt.Error})
	default:
		task.Status, attempt.Status = StatusCompleted, StatusCompleted
		service.appendEventTaskLocked(&task, attemptID, Event{Kind: "lifecycle", Message: "Task completed"})
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) && !stopping {
		task.Status, attempt.Status = StatusFailed, StatusFailed
		attempt.Error = "task exceeded its configured timeout"
	}
	task.ActiveAttemptID = ""
	task.UpdatedAt = now
	service.tasks[id] = task
	rerun := service.autoVerify[id]
	// Qualunque esito chiude la richiesta di correzione: una verifica non
	// rieseguita non deve ripartire da sola su un tentativo successivo.
	delete(service.autoVerify, id)
	if task.Status != StatusCompleted {
		rerun = nil
	}
	if err := service.saveLocked(); err != nil {
		service.reportPersistenceErrorLocked(&task, err)
	}
	service.publishLocked(task)
	if len(rerun) > 0 {
		// La correzione è finita: adOmnia riesegue le stesse verifiche sul nuovo
		// contenuto. Nessun esito viene ereditato dal tentativo precedente.
		go service.runVerifications(id, rerun)
	}
}

func (service *Service) Stop(id string) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	cancel := service.running[id]
	if !task.Active() || cancel == nil {
		service.mu.Unlock()
		return Task{}, errors.New("task is not active")
	}
	task.Status = StatusStopping
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	service.appendEventLocked(id, task.ActiveAttemptID, Event{Kind: "lifecycle", Message: "Stop requested"})
	service.publishLocked(task)
	service.mu.Unlock()
	cancel()
	return service.Get(id)
}

func (service *Service) Shutdown() error {
	service.mu.Lock()
	changed := service.recoverActiveLocked()
	service.autoVerify = map[string][]string{}
	service.verifying = map[string]bool{}
	var err error
	if changed {
		err = service.saveLocked()
	}
	cancels := make([]context.CancelFunc, 0, len(service.running))
	for _, cancel := range service.running {
		cancels = append(cancels, cancel)
	}
	service.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	return err
}

func (service *Service) Export(id string) (string, error) {
	task, err := service.Get(id)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(Snapshot{Version: CurrentVersion, Tasks: []Task{task}})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (service *Service) appendEventLocked(id, attemptID string, event Event) {
	task, ok := service.tasks[id]
	if !ok || task.ActiveAttemptID != attemptID {
		return
	}
	service.appendEventTaskLocked(&task, attemptID, event)
	if event.SessionID != "" {
		for index := range task.Attempts {
			if task.Attempts[index].ID == attemptID {
				task.Attempts[index].SessionID = event.SessionID
			}
		}
	}
	persist := event.Kind == "lifecycle" || event.Kind == "error"
	switch event.Kind {
	case "permission":
		persist = true
		if task.Status == StatusRunning {
			task.Status = StatusWaitingPermission
		}
	case "permission_resolved":
		persist = true
		if task.Status == StatusWaitingPermission {
			task.Status = StatusRunning
		}
	}
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if persist {
		if err := service.saveLocked(); err != nil {
			service.reportPersistenceErrorLocked(&task, err)
		}
	}
	if !streamingKind(event.Kind) || service.now().Sub(service.lastPublish) >= streamPublishInterval {
		service.lastPublish = service.now()
		service.publishLocked(task)
	}
}

// streamingKind identifica gli eventi che arrivano a decine al secondo durante
// un turno: lifecycle, error e permission devono invece arrivare subito.
func streamingKind(kind string) bool {
	switch kind {
	case "text", "thought", "tool":
		return true
	default:
		return false
	}
}

func (service *Service) appendEventTaskLocked(task *Task, attemptID string, event Event) {
	for index := range task.Attempts {
		attempt := &task.Attempts[index]
		if attempt.ID != attemptID {
			continue
		}
		event.ID = newID("event")
		event.TaskID, event.AttemptID = task.ID, attemptID
		event.Timestamp = service.now().UTC()
		event.Message = redactAndLimit(event.Message)
		attempt.Events = append(attempt.Events, event)
		if len(attempt.Events) > maxStoredEvents {
			attempt.Events = append([]Event(nil), attempt.Events[len(attempt.Events)-maxStoredEvents:]...)
		}
		return
	}
}

func (service *Service) recoverActiveLocked() bool {
	changed := false
	now := service.now().UTC()
	for id, task := range service.tasks {
		if len(task.VerifyingIDs) > 0 {
			// Una verifica non sopravvive al riavvio: lo stato va dichiarato, non inventato.
			task.VerifyingIDs = nil
			service.tasks[id] = task
			changed = true
		}
		if !task.Active() {
			continue
		}
		attemptID := task.ActiveAttemptID
		task.Status = StatusNeedsIntervention
		task.ActiveAttemptID = ""
		task.VerifyingIDs = nil
		task.UpdatedAt = now
		for index := range task.Attempts {
			attempt := &task.Attempts[index]
			if attempt.ID != attemptID {
				continue
			}
			attempt.Status = StatusNeedsIntervention
			attempt.EndedAt = &now
			attempt.Error = "adOmnia restarted while this attempt was active; no agent operation was resumed automatically"
		}
		service.appendEventTaskLocked(&task, attemptID, Event{Kind: "lifecycle", Message: "Recovery requires a new explicit attempt"})
		service.tasks[id] = task
		changed = true
	}
	return changed
}

func (service *Service) saveLocked() error {
	snapshot := Snapshot{Version: CurrentVersion, Tasks: make([]Task, 0, len(service.tasks))}
	for _, task := range service.tasks {
		snapshot.Tasks = append(snapshot.Tasks, cloneTask(task))
	}
	snapshot = pruneSnapshot(snapshot)
	if err := service.store.Save(snapshot); err != nil {
		return err
	}
	service.tasks = make(map[string]Task, len(snapshot.Tasks))
	for _, task := range snapshot.Tasks {
		service.tasks[task.ID] = cloneTask(task)
	}
	return nil
}

func (service *Service) reportPersistenceErrorLocked(task *Task, err error) {
	log.Printf("agent task %s could not be persisted: %v", task.ID, err)
	if len(task.Attempts) > 0 {
		attempt := &task.Attempts[len(task.Attempts)-1]
		attempt.Error = redactAndLimit(fmt.Sprintf("%s; task state could not be saved: %v", attempt.Error, err))
		if !task.Active() {
			task.Status, attempt.Status = StatusNeedsIntervention, StatusNeedsIntervention
		}
	}
	service.tasks[task.ID] = *task
}

func (service *Service) publishLocked(task Task) {
	if service.emit != nil {
		service.emit(ChangedEvent, cloneTask(task))
	}
}
