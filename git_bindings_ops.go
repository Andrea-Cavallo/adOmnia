package main

import (
	"adomnia/internal/git"
	"encoding/json"
	"fmt"
)

// This file exposes the professional commit-graph operations (context-menu
// actions) to the frontend. Operational commands return their typed OpResult as
// JSON; the operation's own success/failure is inside that payload, so a Go
// error here only ever signals a marshalling problem. Pure queries keep
// returning a Go error so the frontend promise rejects.

func (g *GitSync) path(repoPath string) string {
	if repoPath == "" {
		return g.defaultRepoPath()
	}
	return repoPath
}

func marshalResult(res git.OpResult) (string, error) {
	raw, err := json.Marshal(res)
	if err != nil {
		return "", fmt.Errorf("marshal result: %w", err)
	}
	return string(raw), nil
}

// ── Repository / commit inspection ───────────────────────────────────────────

func (g *GitSync) GetRepoState(repoPath string) (string, error) {
	state, err := git.InspectState(g.path(repoPath))
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(state)
	return string(raw), nil
}

func (g *GitSync) GetCommitMeta(repoPath, ref string) (string, error) {
	meta, err := git.GetCommitMeta(g.path(repoPath), ref)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(meta)
	return string(raw), nil
}

func (g *GitSync) RemoteWebURL(repoPath string) string {
	return git.RemoteWebURL(g.path(repoPath))
}

func (g *GitSync) CompareWebURL(repoPath, refA, refB string) string {
	return git.CompareWebURL(g.path(repoPath), refA, refB)
}

// ── Phase 1: checkout / branch / tag / compare / restore ─────────────────────

func (g *GitSync) CheckoutCommit(repoPath, ref, newBranch string) (string, error) {
	return marshalResult(git.CheckoutCommit(g.path(repoPath), ref, newBranch))
}

func (g *GitSync) CreateBranchFromCommit(repoPath, branch, ref string, checkout, push bool) (string, error) {
	return marshalResult(git.CreateBranchFromCommit(g.path(repoPath), branch, ref, checkout, push))
}

func (g *GitSync) CreateTagFromCommit(repoPath, name, ref, message string, annotated, push bool) (string, error) {
	return marshalResult(git.CreateTagFromCommit(g.path(repoPath), name, ref, message, annotated, push))
}

func (g *GitSync) CompareCommits(repoPath, refA, refB string) (string, error) {
	result, err := git.CompareCommits(g.path(repoPath), refA, refB)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(result)
	return string(raw), nil
}

func (g *GitSync) CreatePatch(repoPath, refA, refB string) (string, error) {
	return git.CreatePatch(g.path(repoPath), refA, refB)
}

func (g *GitSync) ApplyPatch(repoPath, patch string, threeWay, index bool) (string, error) {
	return marshalResult(git.ApplyPatch(g.path(repoPath), patch, threeWay, index))
}

func (g *GitSync) RestoreFileFromCommit(repoPath, ref, path string) (string, error) {
	return marshalResult(git.RestoreFileFromCommit(g.path(repoPath), ref, path))
}

func (g *GitSync) FileAtCommit(repoPath, ref, path string) (string, error) {
	return git.FileAtCommit(g.path(repoPath), ref, path)
}

func (g *GitSync) FileHistory(repoPath, path string, n int) (string, error) {
	commits, err := git.FileHistory(g.path(repoPath), path, n)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(commits)
	return string(raw), nil
}

func (g *GitSync) BlameFile(repoPath, path string) (string, error) {
	return git.Blame(g.path(repoPath), path)
}

// ── Phase 2: cherry-pick / revert / reset / amend / undo / squash / extract ──

func (g *GitSync) CherryPick(repoPath string, shas []string, noCommit bool, newBranch string, recordOrigin bool) (string, error) {
	return marshalResult(git.CherryPick(g.path(repoPath), shas, noCommit, newBranch, recordOrigin))
}

func (g *GitSync) GenerateRevertMessage(repoPath, sha string) (string, error) {
	return git.GenerateRevertMessage(g.path(repoPath), sha)
}

func (g *GitSync) RevertCommit(repoPath, sha, message string, mainline int) (string, error) {
	return marshalResult(git.RevertCommit(g.path(repoPath), sha, message, mainline))
}

func (g *GitSync) ResetBranch(repoPath, sha, mode string) (string, error) {
	return marshalResult(git.ResetBranch(g.path(repoPath), sha, mode))
}

func (g *GitSync) AmendCommit(repoPath, message string, addAll bool) (string, error) {
	return marshalResult(git.AmendCommit(g.path(repoPath), message, addAll))
}

func (g *GitSync) UndoLastCommit(repoPath string, keepStaged bool) (string, error) {
	return marshalResult(git.UndoLastCommit(g.path(repoPath), keepStaged))
}

func (g *GitSync) SquashHeadIntoPrevious(repoPath string) (string, error) {
	return marshalResult(git.SquashHeadIntoPrevious(g.path(repoPath)))
}

func (g *GitSync) ExtractHeadToNewBranch(repoPath, newBranch string) (string, error) {
	return marshalResult(git.ExtractHeadToNewBranch(g.path(repoPath), newBranch))
}

func (g *GitSync) ForcePush(repoPath, branch string) (string, error) {
	return marshalResult(git.ForcePush(g.path(repoPath), branch))
}

// ── Conflict resolver: continue / skip / abort ───────────────────────────────

func (g *GitSync) ContinueOperation(repoPath string) (string, error) {
	return marshalResult(git.ContinueOperation(g.path(repoPath)))
}

func (g *GitSync) SkipOperation(repoPath string) (string, error) {
	return marshalResult(git.SkipOperation(g.path(repoPath)))
}

func (g *GitSync) AbortOperation(repoPath string) (string, error) {
	return marshalResult(git.AbortOperation(g.path(repoPath)))
}

// ── Phase 3: interactive rebase / bisect / search ────────────────────────────

func (g *GitSync) GetRebaseTodo(repoPath, baseRef string) (string, error) {
	plan, err := git.GetRebaseTodo(g.path(repoPath), baseRef)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(plan)
	return string(raw), nil
}

func (g *GitSync) StartInteractiveRebase(repoPath, baseRef, itemsJSON string) (string, error) {
	var items []git.RebaseTodoItem
	if err := json.Unmarshal([]byte(itemsJSON), &items); err != nil {
		return "", fmt.Errorf("invalid rebase plan: %w", err)
	}
	return marshalResult(git.StartInteractiveRebase(g.path(repoPath), baseRef, items))
}

func (g *GitSync) RebaseOnto(repoPath, targetRef string) (string, error) {
	return marshalResult(git.RebaseOnto(g.path(repoPath), targetRef))
}

func (g *GitSync) BisectStart(repoPath, bad, good string) (string, error) {
	return marshalResult(git.BisectStart(g.path(repoPath), bad, good))
}

func (g *GitSync) BisectMark(repoPath, verdict string) (string, error) {
	return marshalResult(git.BisectMark(g.path(repoPath), verdict))
}

func (g *GitSync) BisectRun(repoPath, command string) (string, error) {
	return marshalResult(git.BisectRun(g.path(repoPath), command))
}

func (g *GitSync) BisectReset(repoPath string) (string, error) {
	return marshalResult(git.BisectReset(g.path(repoPath)))
}

func (g *GitSync) SearchHistory(repoPath, filtersJSON string) (string, error) {
	var filters git.SearchFilters
	if err := json.Unmarshal([]byte(filtersJSON), &filters); err != nil {
		return "", fmt.Errorf("invalid search filters: %w", err)
	}
	commits, err := git.SearchHistory(g.path(repoPath), filters)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(commits)
	return string(raw), nil
}
