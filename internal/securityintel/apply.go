package securityintel

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"adomnia/internal/procutil"
)

// Stati di un passo di verifica. Un passo non è mai "ok" finché non è stato eseguito:
// "idle" e "skipped" sono cose diverse, e l'utente deve vederle.
const (
	StepIdle    = "idle"
	StepRunning = "running"
	StepOK      = "ok"
	StepFailed  = "failed"
	StepSkipped = "skipped"
)

// Stati di un piano di remediation. La modifica diventa definitiva solo con la
// conferma dell'utente: fino a quel momento è provvisoria e ripristinabile.
const (
	PlanProposed  = "proposed"
	PlanApplied   = "applied"
	PlanCommitted = "committed"
	PlanReverted  = "reverted"
)

// Identificativi dei passi generici del motore. Gli adapter aggiungono i propri
// (compilazione, test) tramite UpgradeEditor.VerifySteps.
const (
	StepWrite   = "write"
	StepResolve = "resolve"
	StepRescan  = "rescan"
)

// verifyStepTimeout è il tempo massimo di un singolo passo di verifica.
const verifyStepTimeout = 10 * time.Minute

// UpgradeRequest descrive la correzione da preparare: il componente aggiornato alla
// versione target, con il report di scansione da cui leggere il set corrente.
type UpgradeRequest struct {
	// Component è il componente da aggiornare, come appare nel finding.
	Component Component `json:"component"`
	// TargetVersion è la versione a cui aggiornare.
	TargetVersion string `json:"targetVersion"`
	// Report è la scansione da cui leggere gli advisory correnti del componente.
	Report ScanReport `json:"report"`
	// Options guida la risoluzione e i passi di verifica (offline, processi).
	Options ResolveOptions `json:"options"`
}

// UpgradeStep è un passo di verifica con il proprio stato e il proprio output.
type UpgradeStep struct {
	VerifyStep
	// Status è lo stato visibile: idle, running, ok, failed, skipped.
	Status string `json:"status"`
	// Output è l'esito leggibile del passo.
	Output string `json:"output,omitempty"`
}

// UpgradePlan è la modifica proposta a un manifest, ancora da confermare.
//
// Il piano non tocca nulla finché non si esegue il passo di scrittura, e anche allora
// la modifica è solo provvisoria: il contenuto precedente finisce in un backup e la
// scelta definitiva resta all'utente (commit o ripristino).
type UpgradePlan struct {
	// ID identifica il piano fra quelli aperti.
	ID string `json:"id"`
	// Target è il manifest su cui si interviene.
	Target Target `json:"target"`
	// Component e TargetVersion descrivono il passo.
	Component     Component `json:"component"`
	TargetVersion string    `json:"targetVersion"`
	// Manifest è il file assoluto che viene modificato.
	Manifest string `json:"manifest"`
	// Diff è il diff unificato fra il contenuto attuale e quello proposto.
	Diff string `json:"diff"`
	// Preview è l'impatto di sicurezza atteso, da confrontare con la riscansione.
	Preview UpgradePreview `json:"preview"`
	// Steps sono i passi di verifica, nel loro ordine.
	Steps []UpgradeStep `json:"steps"`
	// State è lo stato del piano: proposed, applied, committed, reverted.
	State string `json:"state"`
	// Backup è il file che conserva il contenuto precedente del manifest.
	Backup string `json:"backup,omitempty"`
	// Note riassume l'esito finale per l'utente.
	Note string `json:"note,omitempty"`
	// CreatedAt è la data di creazione del piano (RFC 3339).
	CreatedAt string `json:"createdAt"`
}

// PlanStore tiene i piani di remediation aperti in questa sessione dell'applicazione.
// Un piano porta con sé il contenuto originale del manifest: nessuna modifica avviene
// senza possibilità di ripristino.
type PlanStore struct {
	mu    sync.Mutex
	plans map[string]*upgradePlanState
	next  int
}

// upgradePlanState è lo stato interno di un piano, mai esposto ai binding.
type upgradePlanState struct {
	mu       sync.Mutex
	plan     UpgradePlan
	original string
	patched  string
	adapter  EcosystemAdapter
	applied  bool
}

// NewPlanStore crea il contenitore dei piani aperti.
func NewPlanStore() *PlanStore {
	return &PlanStore{plans: map[string]*upgradePlanState{}}
}

// Plan prepara la modifica del manifest per un aggiornamento.
//
// Non scrive nulla: produce il testo modificato, il diff da rivedere e i passi di
// verifica. Se la modifica non è applicabile in automatico viene restituito un errore
// con il motivo, che il finding riporta come Blocked invece di un comando che fallisce.
func (store *PlanStore) Plan(ctx context.Context, engine *Engine, request UpgradeRequest) (UpgradePlan, error) {
	component := request.Component
	targetVersion := strings.TrimSpace(request.TargetVersion)
	if component.Manifest == "" {
		return UpgradePlan{}, fmt.Errorf("no manifest declares this component in the workspace")
	}
	if targetVersion == "" {
		return UpgradePlan{}, fmt.Errorf("no target version to upgrade to")
	}
	if CompareVersions(targetVersion, component.Version) == 0 {
		return UpgradePlan{}, fmt.Errorf("%s is already at version %s", component.Name, targetVersion)
	}
	adapter := engine.adapterFor(component.Ecosystem)
	if adapter == nil {
		return UpgradePlan{}, fmt.Errorf("no adapter for ecosystem %s", component.Ecosystem)
	}
	editor, ok := adapter.(UpgradeEditor)
	if !ok {
		return UpgradePlan{}, fmt.Errorf("automatic remediation is not available for ecosystem %s", component.Ecosystem)
	}
	manifest := filepath.Clean(component.Manifest)
	if open := store.openFor(manifest); open != nil {
		return UpgradePlan{}, fmt.Errorf("a remediation plan is already open for %s: apply or discard it first", filepath.ToSlash(manifest))
	}
	original, err := os.ReadFile(manifest)
	if err != nil {
		return UpgradePlan{}, fmt.Errorf("read %s: %w", filepath.ToSlash(manifest), err)
	}
	patched, err := editor.UpgradeManifest(string(original), component, targetVersion)
	if err != nil {
		return UpgradePlan{}, err
	}
	if patched == string(original) {
		return UpgradePlan{}, fmt.Errorf("%s would not change: the version is not declared in this manifest", filepath.ToSlash(manifest))
	}

	target := Target{
		Ecosystem: component.Ecosystem,
		Root:      filepath.Dir(manifest),
		Manifest:  manifest,
		Name:      component.Name,
	}
	plan := UpgradePlan{
		Target:        target,
		Component:     component,
		TargetVersion: targetVersion,
		Manifest:      manifest,
		Diff:          unifiedDiff(filepath.ToSlash(manifest), string(original), patched),
		State:         PlanProposed,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	}
	preview, err := PreviewUpgrade(ctx, engine.sources, request.Report, component, targetVersion)
	if err != nil {
		plan.Preview = UpgradePreview{
			Component:      component,
			CurrentVersion: component.Version,
			TargetVersion:  targetVersion,
			Compatibility:  CompatibilityClassOf(component.Version, targetVersion),
			Advice:         "The security impact could not be previewed: " + err.Error(),
		}
	} else {
		plan.Preview = preview
	}

	plan.Steps = append(plan.Steps, UpgradeStep{
		VerifyStep: VerifyStep{
			ID:      StepWrite,
			Label:   "Write the change",
			Command: "backup + write " + filepath.ToSlash(manifest),
		},
		Status: StepIdle,
	})
	plan.Steps = append(plan.Steps, UpgradeStep{
		VerifyStep: VerifyStep{ID: StepResolve, Label: "Dependency resolution"},
		Status:     StepIdle,
	})
	for _, step := range editor.VerifySteps(target, component, targetVersion, request.Options) {
		plan.Steps = append(plan.Steps, UpgradeStep{VerifyStep: step, Status: StepIdle})
	}
	plan.Steps = append(plan.Steps, UpgradeStep{
		VerifyStep: VerifyStep{ID: StepRescan, Label: "Rescan and compare with the impact preview"},
		Status:     StepIdle,
	})

	store.mu.Lock()
	store.next++
	plan.ID = fmt.Sprintf("upgrade-%d", store.next)
	store.plans[plan.ID] = &upgradePlanState{
		plan:     plan,
		original: string(original),
		patched:  patched,
		adapter:  adapter,
	}
	store.mu.Unlock()
	return planCopy(plan), nil
}

// RunStep esegue un singolo passo di verifica del piano e ne riporta l'output.
//
// Qualsiasi passo che avvia un processo viene eseguito solo con autorizzazione
// esplicita (ResolveOptions.AllowProcesses): senza, il passo risulta "skipped" con il
// motivo, mai eseguito silenziosamente.
func (store *PlanStore) RunStep(ctx context.Context, engine *Engine, planID, stepID string, options ResolveOptions) (UpgradePlan, error) {
	state := store.state(planID)
	if state == nil {
		return UpgradePlan{}, fmt.Errorf("unknown remediation plan %s", planID)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.plan.State == PlanCommitted || state.plan.State == PlanReverted {
		return UpgradePlan{}, fmt.Errorf("the remediation plan is already %s", state.plan.State)
	}
	index := -1
	for candidate := range state.plan.Steps {
		if state.plan.Steps[candidate].ID == stepID {
			index = candidate
			break
		}
	}
	if index < 0 {
		return UpgradePlan{}, fmt.Errorf("unknown verification step %s", stepID)
	}
	step := &state.plan.Steps[index]
	if step.Status == StepOK || step.Status == StepRunning {
		return planCopy(state.plan), nil
	}
	step.Status = StepRunning
	step.Output = ""
	output, status := runUpgradeStep(ctx, engine, state, step, options)
	step.Status = status
	step.Output = output
	return planCopy(state.plan), nil
}

// Finish chiude il piano: apply rende definitiva la modifica, altrimenti il manifest
// torna esattamente com'era. La scelta è sempre dell'utente.
func (store *PlanStore) Finish(planID string, apply bool) (UpgradePlan, error) {
	state := store.state(planID)
	if state == nil {
		return UpgradePlan{}, fmt.Errorf("unknown remediation plan %s", planID)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.plan.State == PlanCommitted || state.plan.State == PlanReverted {
		return UpgradePlan{}, fmt.Errorf("the remediation plan is already %s", state.plan.State)
	}
	if apply {
		if !state.applied {
			return UpgradePlan{}, fmt.Errorf("the change is not written yet: run the verification steps first")
		}
		for _, step := range state.plan.Steps {
			if step.Status == StepFailed {
				return UpgradePlan{}, fmt.Errorf("the %s step failed: fix it or discard the change", step.Label)
			}
		}
		state.plan.State = PlanCommitted
		state.plan.Note = fmt.Sprintf("The change is definitive. The previous version of %s is kept at %s. %s",
			filepath.ToSlash(state.plan.Manifest), filepath.ToSlash(state.plan.Backup), verificationSummary(state.plan.Steps))
	} else {
		if state.applied {
			if err := writeManifest(state.plan.Manifest, state.original); err != nil {
				return UpgradePlan{}, err
			}
			if state.plan.Backup != "" {
				_ = os.Remove(state.plan.Backup)
			}
		}
		state.plan.State = PlanReverted
		state.plan.Note = "The manifest is restored to its previous content: no change is kept."
	}
	return planCopy(state.plan), nil
}

// Get ritorna una copia del piano, se esiste.
func (store *PlanStore) Get(planID string) (UpgradePlan, bool) {
	state := store.state(planID)
	if state == nil {
		return UpgradePlan{}, false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return planCopy(state.plan), true
}

// state ritrova lo stato interno di un piano.
func (store *PlanStore) state(planID string) *upgradePlanState {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.plans[planID]
}

// openFor cerca un piano ancora aperto per lo stesso manifest.
func (store *PlanStore) openFor(manifest string) *upgradePlanState {
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, state := range store.plans {
		if state.plan.Manifest == manifest && (state.plan.State == PlanProposed || state.plan.State == PlanApplied) {
			return state
		}
	}
	return nil
}

// runUpgradeStep esegue il passo richiesto e ne riporta output e stato.
func runUpgradeStep(ctx context.Context, engine *Engine, state *upgradePlanState, step *UpgradeStep, options ResolveOptions) (string, string) {
	switch step.ID {
	case StepWrite:
		if state.applied {
			return "the manifest change is already written (provisional)", StepOK
		}
		backup, err := writeManifestBackup(state.plan.Manifest, state.original)
		if err != nil {
			return firstMessage(err.Error()), StepFailed
		}
		if err := writeManifest(state.plan.Manifest, state.patched); err != nil {
			return firstMessage(err.Error()), StepFailed
		}
		state.plan.Backup = backup
		state.applied = true
		state.plan.State = PlanApplied
		return fmt.Sprintf("change written to %s (provisional). The previous content is kept at %s until you confirm.",
			filepath.ToSlash(state.plan.Manifest), filepath.ToSlash(backup)), StepOK
	case StepResolve:
		// La risoluzione delle dipendenze può richiedere strumenti esterni (go, mvn). Senza
		// autorizzazione esplicita il passo non è mai "ok" per supposizione: se la verifica non
		// è possibile resta "skipped" e lo dice, come per ogni altro passo che avvia processi.
		resolution, err := state.adapter.Resolve(ctx, state.plan.Target, options)
		if err != nil {
			if !options.AllowProcesses {
				return "external tools are not authorized for this project: dependency resolution is skipped, not executed", StepSkipped
			}
			return firstMessage(err.Error()), StepFailed
		}
		for _, resolved := range resolution.Components {
			if resolved.Name != state.plan.Component.Name {
				continue
			}
			if CompareVersions(resolved.Version, state.plan.TargetVersion) == 0 {
				return fmt.Sprintf("dependency resolution now selects %s@%s", resolved.Name, resolved.Version), StepOK
			}
			return fmt.Sprintf("the resolved graph still selects %s@%s: this version is managed elsewhere (parent POM, BOM or replace directive)", resolved.Name, resolved.Version), StepFailed
		}
		return fmt.Sprintf("%s is no longer in the resolved graph: check the manifest", state.plan.Component.Name), StepFailed
	case StepRescan:
		return rescanUpgrade(ctx, engine, state)
	default:
		return runProcessStep(ctx, state, step, options)
	}
}

// runProcessStep esegue un passo descritto dall'adapter. Un passo che avvia un
// processo senza autorizzazione esplicita non parte mai: resta "skipped" e lo dice.
func runProcessStep(ctx context.Context, state *upgradePlanState, step *UpgradeStep, options ResolveOptions) (string, string) {
	if !step.RequiresProcess {
		return fmt.Sprintf("no action required for %s", step.Label), StepOK
	}
	if !options.AllowProcesses {
		return "external tools are not authorized for this project: this step is skipped, not executed", StepSkipped
	}
	if step.Program == "" {
		return fmt.Sprintf("the tool required by %s is not installed", step.Label), StepFailed
	}
	runContext, cancel := context.WithTimeout(ctx, verifyStepTimeout)
	defer cancel()
	command := procutil.CommandContext(runContext, step.Program, step.Args...)
	if step.Dir != "" {
		command.Dir = step.Dir
	}
	if len(step.Env) > 0 {
		command.Env = append(append([]string{}, os.Environ()...), step.Env...)
	}
	var output strings.Builder
	command.Stdout = &output
	command.Stderr = &output
	err := command.Run()
	if runContext.Err() != nil {
		return fmt.Sprintf("%s timed out after %s", step.Label, verifyStepTimeout), StepFailed
	}
	text := strings.TrimSpace(output.String())
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return trimOutput(text), StepFailed
	}
	if text == "" {
		text = step.Label + " completed with no output"
	}
	return trimOutput(text), StepOK
}

// rescanUpgrade ripete la consultazione delle fonti per la versione target e la
// confronta con l'impatto atteso: le correzioni promesse devono essere sparite.
func rescanUpgrade(ctx context.Context, engine *Engine, state *upgradePlanState) (string, string) {
	if !state.applied {
		return "the change is not written yet: run the write step first", StepFailed
	}
	to := state.plan.Component
	to.Version = state.plan.TargetVersion
	fresh := advisoriesAffecting(querySources(ctx, engine.sources, []Component{to})[to.Key()], to)
	found := map[string]bool{}
	for _, advisory := range fresh {
		found[CanonicalAdvisoryID(advisory)] = true
	}
	lines := []string{}
	problems := 0
	for _, impact := range state.plan.Preview.Resolves {
		if found[impact.ID] {
			lines = append(lines, fmt.Sprintf("%s is still reported at %s: the preview said it was resolved", impact.ID, to.Version))
			problems++
			continue
		}
		lines = append(lines, fmt.Sprintf("%s is no longer reported at %s, as previewed", impact.ID, to.Version))
	}
	for _, impact := range state.plan.Preview.Remaining {
		if found[impact.ID] {
			lines = append(lines, fmt.Sprintf("%s remains at %s, as previewed", impact.ID, to.Version))
			continue
		}
		lines = append(lines, fmt.Sprintf("%s is no longer reported at %s (better than previewed)", impact.ID, to.Version))
	}
	for _, impact := range state.plan.Preview.Introduces {
		if found[impact.ID] {
			lines = append(lines, fmt.Sprintf("%s is introduced by %s@%s, as previewed", impact.ID, state.plan.Component.Name, to.Version))
			continue
		}
		lines = append(lines, fmt.Sprintf("%s was not confirmed at %s@%s", impact.ID, state.plan.Component.Name, to.Version))
	}
	if len(lines) == 0 {
		return "no advisory data to compare: the databases could not be consulted during the preview", StepOK
	}
	status := StepOK
	if problems > 0 {
		status = StepFailed
	}
	return strings.Join(lines, "\n"), status
}

// verificationSummary riassume cosa è stato davvero verificato, con ciò che è stato
// saltato: un commit onesto dice anche cosa non è stato controllato.
func verificationSummary(steps []UpgradeStep) string {
	ran, skipped, failed := 0, 0, 0
	for _, step := range steps {
		switch step.Status {
		case StepOK:
			ran++
		case StepSkipped:
			skipped++
		case StepFailed:
			failed++
		}
	}
	summary := fmt.Sprintf("%d of %d verification steps ran.", ran, len(steps))
	if skipped > 0 {
		summary += fmt.Sprintf(" %d skipped.", skipped)
	}
	if failed > 0 {
		summary += fmt.Sprintf(" %d failed.", failed)
	}
	return summary
}

// writeManifestBackup conserva il contenuto attuale del manifest prima di ogni
// modifica. Il backup non viene sovrascritto: se esiste già, se ne crea uno nuovo.
func writeManifestBackup(manifest, original string) (string, error) {
	backup := manifest + ".adomnia-restore"
	if _, err := os.Stat(backup); err == nil {
		backup = fmt.Sprintf("%s.adomnia-restore-%s", manifest, time.Now().UTC().Format("20060102T150405Z"))
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(manifest); err == nil {
		mode = info.Mode()
	}
	if err := os.WriteFile(backup, []byte(original), mode); err != nil {
		return "", fmt.Errorf("backup of %s: %w", filepath.ToSlash(manifest), err)
	}
	return backup, nil
}

// writeManifest scrive il testo del manifest conservandone i permessi.
func writeManifest(manifest, text string) error {
	mode := os.FileMode(0o644)
	if info, err := os.Stat(manifest); err == nil {
		mode = info.Mode()
	}
	if err := os.WriteFile(manifest, []byte(text), mode); err != nil {
		return fmt.Errorf("write %s: %w", filepath.ToSlash(manifest), err)
	}
	return nil
}

// planCopy copia il piano, staccando gli slice condivisi.
func planCopy(plan UpgradePlan) UpgradePlan {
	copied := plan
	copied.Steps = append([]UpgradeStep(nil), plan.Steps...)
	return copied
}

// trimOutput limita l'output mostrato, tenendo inizio e fine: gli errori di build
// vivono in mezzo, il verdetto in coda.
func trimOutput(text string) string {
	const limit = 4000
	if len(text) <= limit {
		return text
	}
	half := limit / 2
	return text[:half] + "\n…(output truncated)…\n" + text[len(text)-half:]
}

// firstMessage ritorna la prima riga di un messaggio di errore.
func firstMessage(message string) string {
	if index := strings.IndexAny(message, "\r\n"); index >= 0 {
		return message[:index]
	}
	return message
}

// diffLine è una riga di un diff: contesto, rimozione o aggiunta.
type diffLine struct {
	kind byte
	text string
}

// unifiedDiff produce un diff unificato fra due versioni di un testo, da mostrare
// all'utente prima di scrivere qualsiasi file.
func unifiedDiff(name, before, after string) string {
	ops := diffLines(splitDiffLines(before), splitDiffLines(after))
	return formatUnifiedDiff(name, ops)
}

// splitDiffLines spezza un testo in righe di diff, normalizzando i fine riga.
func splitDiffLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

// diffLines confronta due sequenze di righe con la longest common subsequence.
// I manifest sono piccoli; oltre una soglia si mostra la sostituzione integrale
// invece di costruire una matrice enorme.
func diffLines(left, right []string) []diffLine {
	if len(left)*len(right) > 4_000_000 {
		ops := make([]diffLine, 0, len(left)+len(right))
		for _, line := range left {
			ops = append(ops, diffLine{kind: '-', text: line})
		}
		for _, line := range right {
			ops = append(ops, diffLine{kind: '+', text: line})
		}
		return ops
	}
	table := make([][]int, len(left)+1)
	for index := range table {
		table[index] = make([]int, len(right)+1)
	}
	for i := len(left) - 1; i >= 0; i-- {
		for j := len(right) - 1; j >= 0; j-- {
			if left[i] == right[j] {
				table[i][j] = table[i+1][j+1] + 1
				continue
			}
			if table[i+1][j] >= table[i][j+1] {
				table[i][j] = table[i+1][j]
				continue
			}
			table[i][j] = table[i][j+1]
		}
	}
	ops := []diffLine{}
	i, j := 0, 0
	for i < len(left) && j < len(right) {
		switch {
		case left[i] == right[j]:
			ops = append(ops, diffLine{kind: ' ', text: left[i]})
			i++
			j++
		case table[i+1][j] >= table[i][j+1]:
			ops = append(ops, diffLine{kind: '-', text: left[i]})
			i++
		default:
			ops = append(ops, diffLine{kind: '+', text: right[j]})
			j++
		}
	}
	for ; i < len(left); i++ {
		ops = append(ops, diffLine{kind: '-', text: left[i]})
	}
	for ; j < len(right); j++ {
		ops = append(ops, diffLine{kind: '+', text: right[j]})
	}
	return ops
}

// formatUnifiedDiff raggruppa le righe in hunk con tre righe di contesto.
func formatUnifiedDiff(name string, ops []diffLine) string {
	const context = 3
	changed := []int{}
	for index, op := range ops {
		if op.kind != ' ' {
			changed = append(changed, index)
		}
	}
	if len(changed) == 0 {
		return ""
	}
	type hunk struct{ start, end int }
	hunks := []hunk{}
	start := maxInt(0, changed[0]-context)
	end := minInt(len(ops)-1, changed[0]+context)
	for _, index := range changed[1:] {
		if index-context <= end+1 {
			end = minInt(len(ops)-1, index+context)
			continue
		}
		hunks = append(hunks, hunk{start: start, end: end})
		start = maxInt(0, index-context)
		end = minInt(len(ops)-1, index+context)
	}
	hunks = append(hunks, hunk{start: start, end: end})

	var builder strings.Builder
	fmt.Fprintf(&builder, "--- %s\n+++ %s (proposed)\n", name, name)
	for _, group := range hunks {
		// I numeri di riga dell'hunk si calcolano contando le righe precedenti.
		oldLine, newLine := 1, 1
		for index := 0; index < group.start; index++ {
			switch ops[index].kind {
			case ' ':
				oldLine++
				newLine++
			case '-':
				oldLine++
			case '+':
				newLine++
			}
		}
		oldCount, newCount := 0, 0
		for index := group.start; index <= group.end; index++ {
			switch ops[index].kind {
			case ' ':
				oldCount++
				newCount++
			case '-':
				oldCount++
			case '+':
				newCount++
			}
		}
		fmt.Fprintf(&builder, "@@ -%d,%d +%d,%d @@\n", oldLine, oldCount, newLine, newCount)
		for index := group.start; index <= group.end; index++ {
			builder.WriteByte(ops[index].kind)
			builder.WriteString(ops[index].text)
			builder.WriteByte('\n')
		}
	}
	return builder.String()
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
