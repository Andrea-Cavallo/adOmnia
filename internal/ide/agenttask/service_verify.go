package agenttask

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// maxEvidenceLog limita il log conservato per evidenza: il report resta leggibile e
// versionabile, mentre il dettaglio completo resta negli strumenti che l'hanno prodotto.
const maxEvidenceLog = 16 * 1024

// SetWorkspaceProvider collega la creazione delle cartelle isolate ai servizi Git dell'host.
func (service *Service) SetWorkspaceProvider(provider WorkspaceProvider) {
	service.mu.Lock()
	service.workspaces = provider
	service.mu.Unlock()
}

// SetVerifier collega l'esecuzione delle verifiche agli strumenti dell'host.
func (service *Service) SetVerifier(verifier Verifier) {
	service.mu.Lock()
	service.verifier = verifier
	service.mu.Unlock()
}

// CreateWorkspace crea la cartella isolata del task e ne registra l'associazione.
// La root del progetto e il suo working tree restano intatti.
func (service *Service) CreateWorkspace(id, baseRef string, includeLocalChanges bool) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		service.mu.Unlock()
		return Task{}, errors.New("stop the task before creating its workspace")
	}
	if task.Workspace != nil {
		service.mu.Unlock()
		return Task{}, errors.New("this task already has a workspace")
	}
	provider := service.workspaces
	if provider == nil {
		service.mu.Unlock()
		return Task{}, errors.New("isolated workspaces are not available")
	}
	request, err := normalizeWorkspaceRequest(WorkspaceRequest{TaskID: task.ID, RepoRoot: task.Root, BaseRef: baseRef, IncludeLocalChanges: includeLocalChanges})
	if err != nil {
		service.mu.Unlock()
		return Task{}, err
	}
	service.mu.Unlock()

	// La creazione esegue Git: fuori dal lock del servizio, come ogni operazione lenta.
	workspace, err := provider.Create(request)
	if err != nil {
		return Task{}, err
	}

	service.mu.Lock()
	task, ok = service.tasks[id]
	if !ok || task.Active() || task.Workspace != nil {
		service.mu.Unlock()
		// Il task è cambiato mentre il worktree veniva creato: non lasciare cartelle orfane.
		if removeErr := provider.Remove(workspace); removeErr != nil {
			return Task{}, fmt.Errorf("%w; the new workspace could not be removed: %w", errTaskChanged, removeErr)
		}
		return Task{}, errTaskChanged
	}
	task.Workspace = &workspace
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		task.Workspace = nil
		service.tasks[id] = task
		service.mu.Unlock()
		if removeErr := provider.Remove(workspace); removeErr != nil {
			return Task{}, fmt.Errorf("%w; the new workspace could not be removed: %w", err, removeErr)
		}
		return Task{}, err
	}
	service.publishLocked(task)
	service.mu.Unlock()
	return service.Get(id)
}

var errTaskChanged = errors.New("the task changed while its workspace was being created; no workspace was assigned")

// RemoveWorkspace rimuove la cartella isolata. Git rifiuta la rimozione se contiene
// modifiche non salvaguardate: adOmnia non forza e mostra il motivo.
func (service *Service) RemoveWorkspace(id string) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		service.mu.Unlock()
		return Task{}, errors.New("stop the task before removing its workspace")
	}
	if task.Workspace == nil {
		service.mu.Unlock()
		return Task{}, errors.New("this task has no workspace")
	}
	provider := service.workspaces
	if provider == nil {
		service.mu.Unlock()
		return Task{}, errors.New("isolated workspaces are not available")
	}
	workspace := *task.Workspace
	service.mu.Unlock()

	if err := provider.Remove(workspace); err != nil {
		return Task{}, err
	}

	service.mu.Lock()
	task, ok = service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	task.Workspace = nil
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		task.Workspace = &workspace
		service.tasks[id] = task
		service.mu.Unlock()
		return Task{}, err
	}
	service.publishLocked(task)
	service.mu.Unlock()
	return service.Get(id)
}

// ReconcileWorkspaces confronta le associazioni salvate con il disco: un worktree
// rimosso esternamente diventa "missing" con un avviso, senza cancellare il task.
func (service *Service) ReconcileWorkspaces() []Task {
	service.mu.Lock()
	provider := service.workspaces
	if provider == nil {
		service.mu.Unlock()
		return nil
	}
	workspaces := make(map[string]Workspace)
	for id, task := range service.tasks {
		if task.Workspace != nil {
			workspaces[id] = *task.Workspace
		}
	}
	service.mu.Unlock()

	inspected := make(map[string]struct {
		state  WorkspaceState
		notice string
	}, len(workspaces))
	for id, workspace := range workspaces {
		state, notice := provider.Inspect(workspace)
		inspected[id] = struct {
			state  WorkspaceState
			notice string
		}{state: state, notice: notice}
	}

	service.mu.Lock()
	var changed []Task
	for id, result := range inspected {
		task, ok := service.tasks[id]
		if !ok || task.Workspace == nil {
			continue
		}
		if task.Workspace.State == result.state && task.Workspace.Notice == result.notice {
			continue
		}
		task.Workspace.State, task.Workspace.Notice = result.state, result.notice
		task.UpdatedAt = service.now().UTC()
		service.tasks[id] = task
		changed = append(changed, cloneTask(task))
	}
	if len(changed) > 0 {
		if err := service.saveLocked(); err != nil {
			for _, task := range changed {
				service.reportPersistenceErrorLocked(&task, err)
			}
		}
	}
	for _, task := range changed {
		service.publishLocked(task)
	}
	service.mu.Unlock()
	sort.Slice(changed, func(left, right int) bool { return changed[left].UpdatedAt.Before(changed[right].UpdatedAt) })
	return changed
}

// AddVerification aggiunge una verifica riutilizzabile al task.
func (service *Service) AddVerification(id string, draft VerificationDraft) (Task, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		return Task{}, errors.New("stop the task before changing its verifications")
	}
	if len(task.Verifications) >= maxVerificationsPerTask {
		return Task{}, fmt.Errorf("at most %d verifications can be stored per task", maxVerificationsPerTask)
	}
	normalized, err := normalizeVerificationDraft(draft)
	if err != nil {
		return Task{}, err
	}
	previous := cloneTask(task)
	task.Verifications = append(task.Verifications, Verification{
		ID: newID("verify"), Kind: normalized.Kind, Label: normalized.Label,
		Language: normalized.Language, WorkingDirectory: normalized.WorkingDirectory,
		Packages: normalized.Packages, Run: normalized.Run, Coverage: normalized.Coverage,
		Method: normalized.Method, URL: normalized.URL, Headers: normalized.Headers,
		Body: normalized.Body, ExpectedStatus: normalized.ExpectedStatus,
		AllowRemote: normalized.AllowRemote, Service: normalized.Service, Watch: normalized.Watch, TimeoutSeconds: normalized.TimeoutSeconds,
		SettleSeconds: normalized.SettleSeconds,
		CreatedAt:     service.now().UTC(),
	})
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.tasks[id] = previous
		return Task{}, err
	}
	service.publishLocked(task)
	return cloneTask(task), nil
}

// RemoveVerification rimuove una verifica. Le evidenze già raccolte restano:
// sono la storia di ciò che è stato misurato.
func (service *Service) RemoveVerification(id, verificationID string) (Task, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		return Task{}, errors.New("stop the task before changing its verifications")
	}
	index := -1
	for position, verification := range task.Verifications {
		if verification.ID == verificationID {
			index = position
			break
		}
	}
	if index < 0 {
		return Task{}, errors.New("verification not found")
	}
	previous := cloneTask(task)
	task.Verifications = append(task.Verifications[:index], task.Verifications[index+1:]...)
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.tasks[id] = previous
		return Task{}, err
	}
	service.publishLocked(task)
	return cloneTask(task), nil
}

// StartVerifications avvia le verifiche selezionate (tutte se vuoto) in background.
// Ritorna subito: i risultati arrivano come nuove Evidence e come task aggiornato.
func (service *Service) StartVerifications(id string, verificationIDs []string) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		service.mu.Unlock()
		return Task{}, errors.New("stop the running attempt before verifying its content")
	}
	if service.verifier == nil {
		service.mu.Unlock()
		return Task{}, errors.New("verification is not available in this build")
	}
	if service.verifying[id] {
		service.mu.Unlock()
		return Task{}, errors.New("verification is already running for this task")
	}
	selected, err := selectVerifications(task, verificationIDs)
	if err != nil {
		service.mu.Unlock()
		return Task{}, err
	}
	if len(selected) == 0 {
		service.mu.Unlock()
		return Task{}, errors.New("add a verification to this task first")
	}
	ids := make([]string, 0, len(selected))
	for _, verification := range selected {
		ids = append(ids, verification.ID)
	}
	task.VerifyingIDs = append([]string(nil), ids...)
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	service.verifying[id] = true
	if err := service.saveLocked(); err != nil {
		delete(service.verifying, id)
		task.VerifyingIDs = nil
		service.tasks[id] = task
		service.mu.Unlock()
		return Task{}, err
	}
	service.publishLocked(task)
	service.mu.Unlock()
	go service.runVerifications(id, ids)
	return service.Get(id)
}

func selectVerifications(task Task, ids []string) ([]Verification, error) {
	if len(ids) == 0 {
		return append([]Verification(nil), task.Verifications...), nil
	}
	selected := make([]Verification, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		found := false
		for _, verification := range task.Verifications {
			if verification.ID == id {
				selected = append(selected, verification)
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("verification %s no longer exists", id)
		}
	}
	return selected, nil
}

// runVerifications esegue le verifiche una alla volta, registrando un'evidenza per
// ciascuna: un errore o un contenuto non eseguibile non diventano mai "superato".
func (service *Service) runVerifications(id string, ids []string) {
	parent, cancelAll := context.WithCancel(context.Background())
	service.mu.Lock()
	service.verifyCancel[id] = cancelAll
	service.mu.Unlock()
	defer func() {
		cancelAll()
		service.mu.Lock()
		delete(service.verifyCancel, id)
		service.mu.Unlock()
	}()
	for _, verificationID := range ids {
		if parent.Err() != nil {
			// Verifiche annullate: quelle non ancora partite non producono alcuna evidenza.
			break
		}
		verification, request, ok := service.prepareVerification(id, verificationID, parent)
		if !ok {
			continue
		}
		evidence := request.verifier.Run(request.context, VerifyRequest{
			TaskID: request.taskID, AttemptID: request.attemptID,
			Workdir: request.workdir, Verification: verification,
		})
		request.cancel()
		service.recordEvidence(id, verification, evidence, request)
	}
	service.finishVerifications(id)
}

type verificationRun struct {
	verifier     Verifier
	provider     WorkspaceProvider
	workspace    *Workspace
	taskID       string
	attemptID    string
	workdir      string
	context      context.Context
	cancel       context.CancelFunc
	startedAt    time.Time
	fingerprint  string
	changedFiles int
}

// prepareVerification legge lo stato del task e calcola l'impronta del contenuto
// PRIMA di eseguire la verifica: l'evidenza dichiara esattamente cosa ha misurato.
func (service *Service) prepareVerification(id, verificationID string, parent context.Context) (Verification, verificationRun, bool) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	verifier := service.verifier
	provider := service.workspaces
	if !ok || verifier == nil {
		service.mu.Unlock()
		return Verification{}, verificationRun{}, false
	}
	var verification Verification
	found := false
	for _, candidate := range task.Verifications {
		if candidate.ID == verificationID {
			verification, found = candidate, true
			break
		}
	}
	if !found || task.Active() {
		service.mu.Unlock()
		return Verification{}, verificationRun{}, false
	}
	attemptID := ""
	if count := len(task.Attempts); count > 0 {
		attemptID = task.Attempts[count-1].ID
	}
	run := verificationRun{
		verifier: verifier, provider: provider, workspace: task.Workspace,
		taskID: task.ID, attemptID: attemptID, workdir: task.workdir(),
		startedAt: service.now().UTC(),
	}
	service.mu.Unlock()

	timeout := time.Duration(normalizeTimeout(verification.TimeoutSeconds)) * time.Second
	run.context, run.cancel = context.WithTimeout(parent, timeout)
	if provider != nil {
		ref := ""
		if run.workspace != nil && run.workspace.State == WorkspaceReady {
			ref = run.workspace.BaseSHA
			if strings.TrimSpace(ref) == "" {
				ref = run.workspace.BaseRef
			}
		}
		if fingerprint, changed, err := provider.Fingerprint(run.workdir, ref); err == nil {
			run.fingerprint, run.changedFiles = fingerprint, changed
		}
	}
	return verification, run, true
}

func (service *Service) recordEvidence(id string, verification Verification, evidence Evidence, run verificationRun) {
	now := service.now().UTC()
	evidence.ID = newID("evidence")
	evidence.TaskID = id
	evidence.AttemptID = run.attemptID
	evidence.VerificationID = verification.ID
	evidence.Kind = verification.Kind
	evidence.Label = verification.Label
	evidence.Workdir = run.workdir
	evidence.StartedAt = run.startedAt
	evidence.FinishedAt = now
	if evidence.DurationMs <= 0 {
		evidence.DurationMs = now.Sub(run.startedAt).Milliseconds()
	}
	evidence.DiffFingerprint, evidence.ChangedFiles = run.fingerprint, run.changedFiles
	// Comando, etichetta e ambiente possono contenere credenziali in una URL o in
	// una variabile: il registro delle evidenze non conserva mai un segreto.
	evidence.Command = redactAndLimit(evidence.Command)
	evidence.Label = redactAndLimit(evidence.Label)
	evidence.Environment = redactAndLimit(evidence.Environment)
	evidence.Log, evidence.Truncated = boundText(evidence.Log, maxEvidenceLog)
	evidence.Outcome = normalizeOutcome(evidence.Outcome)
	for index := range evidence.Observations {
		evidence.Observations[index].Value = redactAndLimit(evidence.Observations[index].Value)
	}

	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return
	}
	task.Evidences = append(task.Evidences, evidence)
	if len(task.Evidences) > maxEvidencePerTask {
		task.Evidences = append([]Evidence(nil), task.Evidences[len(task.Evidences)-maxEvidencePerTask:]...)
	}
	task.VerifyingIDs = removeString(task.VerifyingIDs, verification.ID)
	evaluateSteps(&task, now)
	task.UpdatedAt = now
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.reportPersistenceErrorLocked(&task, err)
	}
	service.publishLocked(task)
}

func (service *Service) finishVerifications(id string) {
	service.mu.Lock()
	defer service.mu.Unlock()
	delete(service.verifying, id)
	task, ok := service.tasks[id]
	if !ok {
		return
	}
	if len(task.VerifyingIDs) == 0 {
		service.publishLocked(task)
		return
	}
	task.VerifyingIDs = nil
	task.UpdatedAt = service.now().UTC()
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.reportPersistenceErrorLocked(&task, err)
	}
	service.publishLocked(task)
}

func normalizeTimeout(seconds int) int {
	if seconds < 1 {
		return 120
	}
	if seconds > maxVerificationTimeout {
		return maxVerificationTimeout
	}
	return seconds
}

func normalizeOutcome(outcome EvidenceOutcome) EvidenceOutcome {
	switch outcome {
	case EvidencePassed, EvidenceFailed, EvidenceError, EvidenceNotRun:
		return outcome
	default:
		// Un Verifier che non dichiara l'esito non ha misurato nulla: non è un superamento.
		return EvidenceError
	}
}

func removeString(values []string, target string) []string {
	kept := make([]string, 0, len(values))
	for _, value := range values {
		if value != target {
			kept = append(kept, value)
		}
	}
	return kept
}

// boundText redige i segreti e tronca senza spezzare l'UTF-8.
func boundText(text string, limit int) (string, bool) {
	text = redactAndLimit(text)
	if len(text) <= limit {
		return text, false
	}
	end := limit
	for end > 0 && !utf8.ValidString(text[:end]) {
		end--
	}
	return text[:end] + "… [truncated]", true
}

// StartCorrection invia all'agente lo stesso task con le sole evidenze scelte
// dall'utente. Quando il tentativo finisce, adOmnia riesegue quelle verifiche.
func (service *Service) StartCorrection(id string, evidenceIDs, commentIDs []string, note string) (Task, error) {
	service.mu.Lock()
	task, ok := service.tasks[id]
	if !ok {
		service.mu.Unlock()
		return Task{}, errors.New("agent task not found")
	}
	if task.Active() {
		service.mu.Unlock()
		return Task{}, errors.New("the task is already active")
	}
	if len(task.Attempts) == 0 {
		service.mu.Unlock()
		return Task{}, errors.New("run the task at least once before asking for a correction")
	}
	if count, limit := consecutiveCorrections(task), task.Limits.correctionLimit(); count >= limit {
		service.mu.Unlock()
		return Task{}, fmt.Errorf("the task reached its limit of %d consecutive corrections; review the evidence, then run the task again or raise the limit", limit)
	}
	if len(evidenceIDs) == 0 && len(commentIDs) == 0 {
		service.mu.Unlock()
		return Task{}, errors.New("select at least one verification result or review comment")
	}
	selected, err := selectEvidence(task, evidenceIDs)
	if err != nil {
		service.mu.Unlock()
		return Task{}, err
	}
	comments, err := selectComments(task, commentIDs)
	if err != nil {
		service.mu.Unlock()
		return Task{}, err
	}
	if label := repeatedRegression(task, verificationIDsOf(selected)); label != "" {
		service.mu.Unlock()
		return Task{}, fmt.Errorf("%q passed and then failed again %d times: the corrections are going in circles; review the changes before asking for another one", label, maxRegressions)
	}
	lastAttempt := task.Attempts[len(task.Attempts)-1]
	verificationIDs := verificationIDsOf(selected)
	message, _ := boundText(correctionMessage(task, selected, note)+commentsMessage(comments), task.Limits.MaxContextBytes)
	receipt := task.LastContext
	service.mu.Unlock()
	return service.start(id, message, receipt, startOptions{correctionOf: lastAttempt.ID, evidenceIDs: evidenceIDs, autoVerify: verificationIDs, commentIDs: commentIDs})
}

// consecutiveCorrections conta i tentativi di correzione in coda al task: una nuova
// esecuzione normale (Start) azzera la catena.
func consecutiveCorrections(task Task) int {
	count := 0
	for index := len(task.Attempts) - 1; index >= 0 && task.Attempts[index].CorrectionOf != ""; index-- {
		count++
	}
	return count
}

// maxRegressions è il numero di regressioni della stessa verifica oltre il quale il
// ciclo di correzione si ferma da solo.
const maxRegressions = 2

// repeatedRegression restituisce l'etichetta della prima verifica che è passata e poi
// tornata a fallire almeno maxRegressions volte. Contano solo esiti misurati: errori e
// verifiche non eseguite non sono né superamenti né regressioni.
func repeatedRegression(task Task, verificationIDs []string) string {
	for _, verificationID := range verificationIDs {
		regressions, passed, label := 0, false, ""
		for _, evidence := range task.Evidences {
			if evidence.VerificationID != verificationID {
				continue
			}
			label = evidence.Label
			switch evidence.Outcome {
			case EvidencePassed:
				passed = true
			case EvidenceFailed:
				if passed {
					regressions++
					passed = false
				}
			}
		}
		if regressions >= maxRegressions {
			return label
		}
	}
	return ""
}

func selectEvidence(task Task, ids []string) ([]Evidence, error) {
	selected := make([]Evidence, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		found := false
		for _, evidence := range task.Evidences {
			if evidence.ID == id {
				selected = append(selected, evidence)
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("evidence %s no longer exists", id)
		}
	}
	return selected, nil
}

func verificationIDsOf(evidences []Evidence) []string {
	seen := map[string]bool{}
	ids := make([]string, 0, len(evidences))
	for _, evidence := range evidences {
		if evidence.VerificationID == "" || seen[evidence.VerificationID] {
			continue
		}
		seen[evidence.VerificationID] = true
		ids = append(ids, evidence.VerificationID)
	}
	return ids
}

// correctionMessage costruisce il prompt di correzione con le sole evidenze selezionate,
// entro il limite di contesto approvato per il task.
func correctionMessage(task Task, evidences []Evidence, note string) string {
	var builder strings.Builder
	if len(evidences) > 0 {
		builder.WriteString("Correction requested. adOmnia ran these verifications on the previous attempt and measured the results below.\n")
		builder.WriteString("Change the code. The same verifications will be re-run by adOmnia: a claim in your reply is not a passing check.\n\n")
	} else {
		builder.WriteString("Correction requested from the user's review of your changes. Address each review comment below by changing the code.\n\n")
	}
	fmt.Fprintf(&builder, "Task intent: %s\nObjective:\n%s\n", task.Intent, task.Objective)
	builder.WriteString(scenariosMessage(task.Scenarios))
	if len(task.Criteria) > 0 {
		builder.WriteString("Completion criteria:\n")
		for _, criterion := range task.Criteria {
			fmt.Fprintf(&builder, "- %s\n", criterion)
		}
	}
	budget := task.Limits.MaxContextBytes - builder.Len()
	for _, evidence := range evidences {
		label := fmt.Sprintf("\n### %s — %s (%s)\n", evidence.Kind, evidence.Label, evidence.Outcome)
		builder.WriteString(label)
		budget -= len(label)
		detail := fmt.Sprintf("command: %s\nworkdir: %s\nenvironment: %s\ndiff: %s (%d changed files)\n", evidence.Command, evidence.Workdir, evidence.Environment, evidence.DiffFingerprint, evidence.ChangedFiles)
		if evidence.Kind == VerificationPage {
			// Il prompt è solo testo: lo screenshot resta locale e lo si dichiara, invece di farlo credere inviato.
			detail += "screenshot: recorded locally and not sent (this correction carries text only: page errors and failed requests are below)\n"
		}
		if budget > 0 && len(detail) < budget {
			builder.WriteString(detail)
			budget -= len(detail)
		}
		if evidence.Log != "" && budget > 64 {
			logText := evidence.Log
			if len(logText) > budget-32 {
				logText = logText[:max(0, budget-32)]
				for len(logText) > 0 && !utf8.ValidString(logText) {
					logText = logText[:len(logText)-1]
				}
				logText += "\n… [truncated]"
			}
			builder.WriteString("log:\n")
			builder.WriteString(logText)
			builder.WriteString("\n")
			budget -= len(logText) + 5
		}
		if budget <= 64 {
			builder.WriteString("\n… more evidence omitted to stay within the approved context limit.\n")
			break
		}
	}
	note = strings.TrimSpace(note)
	if note != "" {
		bounded, _ := boundText(note, 4096)
		builder.WriteString("\nAdditional instruction from the user:\n")
		builder.WriteString(bounded)
		builder.WriteString("\n")
	}
	return builder.String()
}
