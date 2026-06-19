package git

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RebaseTodoItem is one line of an interactive-rebase plan. Action is one of
// pick|reword|edit|squash|fixup|drop. NewMessage carries the edited message for
// reword (and an optional combined message for squash).
type RebaseTodoItem struct {
	Action     string `json:"action"`
	Hash       string `json:"hash"`
	Message    string `json:"message"`
	NewMessage string `json:"newMessage"`
}

// RebasePlan summarizes an interactive rebase for the confirmation step.
type RebasePlan struct {
	Branch    string           `json:"branch"`
	BaseRef   string           `json:"baseRef"`
	Published bool             `json:"published"`
	Items     []RebaseTodoItem `json:"items"`
}

// GetRebaseTodo lists the commits in baseRef..HEAD in rebase order (oldest
// first), each defaulting to "pick", so the UI can render an editable plan.
func GetRebaseTodo(repoPath, baseRef string) (RebasePlan, error) {
	baseRef = strings.TrimSpace(baseRef)
	if baseRef == "" {
		return RebasePlan{}, fmt.Errorf("base ref is empty")
	}
	state, _ := inspectState(repoPath)
	plan := RebasePlan{Branch: state.Branch, BaseRef: baseRef, Published: state.Published, Items: []RebaseTodoItem{}}
	out, err := runGit(repoPath, "log", "--reverse", "--format=%H%x1f%s", baseRef+"..HEAD")
	if err != nil {
		return plan, fmt.Errorf("git log range: %w", err)
	}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, "\x1f", 2)
		if len(parts) < 2 {
			continue
		}
		plan.Items = append(plan.Items, RebaseTodoItem{Action: "pick", Hash: parts[0], Message: parts[1]})
	}
	return plan, nil
}

// StartInteractiveRebase runs `git rebase -i baseRef` driving the todo and any
// reword/squash messages through generated non-interactive editor shims, so the
// whole flow is scriptable. Conflicts surface via OpResult.Code == conflict and
// are continued through ContinueOperation.
func StartInteractiveRebase(repoPath, baseRef string, items []RebaseTodoItem) OpResult {
	baseRef = strings.TrimSpace(baseRef)
	if baseRef == "" {
		return fail(repoPath, "git rebase -i", "", "", CodeError, "base ref is empty")
	}
	if len(items) == 0 {
		return fail(repoPath, "git rebase -i", "", "", CodeError, "rebase plan is empty")
	}
	if op := inProgressOperation(repoPath); op != "" {
		return fail(repoPath, "git rebase -i", "", "", CodeAborted, "cannot start rebase while a "+op+" is in progress")
	}

	work, err := os.MkdirTemp("", "adomnia-rebase-*")
	if err != nil {
		return fail(repoPath, "git rebase -i", "", "", CodeError, "create temp dir: "+err.Error())
	}
	defer os.RemoveAll(work)

	todo := buildRebaseTodo(items)
	todoFile := filepath.Join(work, "todo.txt")
	if err := os.WriteFile(todoFile, []byte(todo), 0644); err != nil {
		return fail(repoPath, "git rebase -i", "", "", CodeError, "write todo: "+err.Error())
	}

	env, err := rebaseEditorEnv(work, todoFile, buildMessageQueue(items))
	if err != nil {
		return fail(repoPath, "git rebase -i", "", "", CodeError, err.Error())
	}

	stdout, stderr, command, err := runFullWithEnv(repoPath, env, "rebase", "-i", baseRef)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, conflictCodeIfAny(repoPath), "")
	}
	return ok(repoPath, command, stdout, stderr)
}

// RebaseOnto replays the current branch onto a target commit (non-interactive).
func RebaseOnto(repoPath, targetRef string) OpResult {
	targetRef = strings.TrimSpace(targetRef)
	if targetRef == "" {
		return fail(repoPath, "git rebase", "", "", CodeError, "target ref is empty")
	}
	stdout, stderr, command, err := runFullWithEnv(repoPath, noOpEditorEnv(), "rebase", targetRef)
	if err != nil {
		return fail(repoPath, command, stdout, stderr, conflictCodeIfAny(repoPath), "")
	}
	return ok(repoPath, command, stdout, stderr)
}

func buildRebaseTodo(items []RebaseTodoItem) string {
	var b strings.Builder
	for _, it := range items {
		action := strings.TrimSpace(it.Action)
		if action == "" {
			action = "pick"
		}
		if action == "drop" {
			b.WriteString(fmt.Sprintf("drop %s %s\n", it.Hash, it.Message))
			continue
		}
		b.WriteString(fmt.Sprintf("%s %s %s\n", action, it.Hash, it.Message))
	}
	return b.String()
}

// buildMessageQueue precomputes the messages git's message-editor will be asked
// for, in the exact top-to-bottom order rebase triggers them: one per reword and
// one per squash group (fixup/edit/pick/drop never open the message editor).
func buildMessageQueue(items []RebaseTodoItem) []string {
	queue := []string{}
	var groupHasSquash bool
	var comboParts []string
	var comboCustom string

	closeGroup := func() {
		if groupHasSquash {
			msg := comboCustom
			if strings.TrimSpace(msg) == "" {
				msg = strings.Join(comboParts, "\n\n")
			}
			queue = append(queue, msg)
		}
		groupHasSquash = false
		comboParts = nil
		comboCustom = ""
	}

	for _, it := range items {
		switch strings.TrimSpace(it.Action) {
		case "squash":
			groupHasSquash = true
			comboParts = append(comboParts, it.Message)
			if strings.TrimSpace(it.NewMessage) != "" {
				comboCustom = it.NewMessage
			}
		case "fixup":
			// no editor, no message contribution
		case "reword":
			closeGroup()
			msg := it.NewMessage
			if strings.TrimSpace(msg) == "" {
				msg = it.Message
			}
			queue = append(queue, msg)
			comboParts = []string{msg}
		default: // pick, edit, drop
			closeGroup()
			comboParts = []string{it.Message}
		}
	}
	closeGroup()
	return queue
}

// rebaseEditorEnv writes the editor shim scripts and returns the environment
// pointing GIT_SEQUENCE_EDITOR at the todo writer and GIT_EDITOR at the message
// queue server. Git always runs the editor through its own sh, so a single
// POSIX script works on every platform when invoked via `sh`.
func rebaseEditorEnv(work, todoFile string, messages []string) ([]string, error) {
	seqScript := filepath.Join(work, "seq-editor.sh")
	seqBody := "#!/bin/sh\ncp \"" + toSh(todoFile) + "\" \"$1\"\n"
	if err := os.WriteFile(seqScript, []byte(seqBody), 0755); err != nil {
		return nil, fmt.Errorf("write seq editor: %w", err)
	}
	env := []string{"GIT_SEQUENCE_EDITOR=sh " + shArg(seqScript)}

	if len(messages) == 0 {
		env = append(env, noOpEditorEnv()[0]) // GIT_EDITOR no-op
		return env, nil
	}

	msgDir := filepath.Join(work, "msgs")
	if err := os.MkdirAll(msgDir, 0755); err != nil {
		return nil, fmt.Errorf("create msg dir: %w", err)
	}
	for i, m := range messages {
		if err := os.WriteFile(filepath.Join(msgDir, fmt.Sprintf("%d.txt", i)), []byte(m), 0644); err != nil {
			return nil, fmt.Errorf("write msg %d: %w", i, err)
		}
	}
	counter := filepath.Join(work, "counter")
	if err := os.WriteFile(counter, []byte("0"), 0644); err != nil {
		return nil, fmt.Errorf("write counter: %w", err)
	}
	msgScript := filepath.Join(work, "msg-editor.sh")
	msgBody := "#!/bin/sh\n" +
		"c=$(cat \"" + toSh(counter) + "\")\n" +
		"cp \"" + toSh(msgDir) + "/$c.txt\" \"$1\"\n" +
		"echo $((c+1)) > \"" + toSh(counter) + "\"\n"
	if err := os.WriteFile(msgScript, []byte(msgBody), 0755); err != nil {
		return nil, fmt.Errorf("write msg editor: %w", err)
	}
	env = append(env, "GIT_EDITOR=sh "+shArg(msgScript))
	return env, nil
}

// toSh converts a filesystem path to the forward-slash form git's sh expects.
func toSh(p string) string {
	return filepath.ToSlash(p)
}

// shArg quotes a path for safe inclusion in a `sh -c` command line.
func shArg(p string) string {
	return "'" + strings.ReplaceAll(toSh(p), "'", "'\\''") + "'"
}
