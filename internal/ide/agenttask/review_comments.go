package agenttask

import (
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
)

// CommentStatus is where a review comment stands in the correction loop.
type CommentStatus string

const (
	// CommentOpen: written by the user, not sent to the agent yet.
	CommentOpen CommentStatus = "open"
	// CommentSent: part of a correction attempt that is still running.
	CommentSent CommentStatus = "sent"
	// CommentToReview: the correction finished; the user must check the new revision.
	CommentToReview CommentStatus = "to_review"
	// CommentResolved: the user confirmed the new revision addresses it.
	CommentResolved CommentStatus = "resolved"
)

// ReviewComment is a remark on a line range of a changed file (or on an evidence)
// that the user can send to the agent as part of a correction.
type ReviewComment struct {
	ID string `json:"id"`
	// Path is relative to the reviewed folder, with forward slashes.
	Path string `json:"path"`
	// Side is "new" (agent version) or "old" (version before the agent).
	Side      string `json:"side"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
	// Excerpt is the commented text exactly as shown: the agent receives what the user saw.
	Excerpt    string `json:"excerpt,omitempty"`
	Body       string `json:"body"`
	EvidenceID string `json:"evidenceId,omitempty"`
	// AttemptID is the attempt whose content was commented; SentInAttemptID the correction that received it.
	AttemptID       string        `json:"attemptId,omitempty"`
	SentInAttemptID string        `json:"sentInAttemptId,omitempty"`
	Status          CommentStatus `json:"status"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}

// ReviewCommentDraft is what the renderer sends: no ID, status or timestamps.
type ReviewCommentDraft struct {
	Path       string `json:"path"`
	Side       string `json:"side"`
	StartLine  int    `json:"startLine"`
	EndLine    int    `json:"endLine"`
	Excerpt    string `json:"excerpt,omitempty"`
	Body       string `json:"body"`
	EvidenceID string `json:"evidenceId,omitempty"`
}

const (
	maxCommentsPerTask = 100
	maxCommentBody     = 4 * 1024
	maxCommentExcerpt  = 8 * 1024
)

func normalizeCommentDraft(task Task, draft ReviewCommentDraft) (ReviewCommentDraft, error) {
	draft.Body = strings.TrimSpace(draft.Body)
	if draft.Body == "" {
		return draft, errors.New("write the comment first")
	}
	if len(draft.Body) > maxCommentBody {
		return draft, errors.New("the comment is longer than 4 KiB")
	}
	if len(draft.Excerpt) > maxCommentExcerpt {
		draft.Excerpt, _ = boundText(draft.Excerpt, maxCommentExcerpt)
	}
	draft.Path = strings.TrimSpace(strings.ReplaceAll(draft.Path, "\\", "/"))
	if draft.Path == "" && draft.EvidenceID == "" {
		return draft, errors.New("a comment refers to a file or to an evidence")
	}
	if draft.Path != "" {
		cleaned := path.Clean(draft.Path)
		if path.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.Contains(cleaned, ":") {
			return draft, errors.New("the commented file must be inside the reviewed folder")
		}
		draft.Path = cleaned
		if draft.Side != "old" {
			draft.Side = "new"
		}
		if draft.StartLine < 1 || draft.EndLine < draft.StartLine {
			return draft, errors.New("invalid line range")
		}
	}
	if draft.EvidenceID != "" && !hasEvidence(task, draft.EvidenceID) {
		return draft, fmt.Errorf("evidence %s no longer exists", draft.EvidenceID)
	}
	return draft, nil
}

func hasEvidence(task Task, id string) bool {
	for _, evidence := range task.Evidences {
		if evidence.ID == id {
			return true
		}
	}
	return false
}

// AddComment stores a review comment on the task, linked to its latest attempt.
func (service *Service) AddComment(id string, draft ReviewCommentDraft) (Task, error) {
	return service.updateTask(id, func(task *Task, now time.Time) error {
		if len(task.Comments) >= maxCommentsPerTask {
			return fmt.Errorf("at most %d comments can be stored per task", maxCommentsPerTask)
		}
		normalized, err := normalizeCommentDraft(*task, draft)
		if err != nil {
			return err
		}
		comment := ReviewComment{
			ID: newID("comment"), Path: normalized.Path, Side: normalized.Side,
			StartLine: normalized.StartLine, EndLine: normalized.EndLine, Excerpt: normalized.Excerpt,
			Body: normalized.Body, EvidenceID: normalized.EvidenceID, Status: CommentOpen,
			CreatedAt: now, UpdatedAt: now,
		}
		if count := len(task.Attempts); count > 0 {
			comment.AttemptID = task.Attempts[count-1].ID
		}
		task.Comments = append(task.Comments, comment)
		return nil
	})
}

// SetCommentStatus resolves a comment, or reopens it when the new revision does not address it.
func (service *Service) SetCommentStatus(id, commentID string, resolved bool) (Task, error) {
	return service.updateTask(id, func(task *Task, now time.Time) error {
		comment, err := commentAt(task, commentID)
		if err != nil {
			return err
		}
		if comment.Status == CommentSent {
			return errors.New("the correction that received this comment is still running")
		}
		comment.Status = CommentOpen
		if resolved {
			comment.Status = CommentResolved
		}
		comment.UpdatedAt = now
		return nil
	})
}

// RemoveComment deletes a comment that is not part of a running correction.
func (service *Service) RemoveComment(id, commentID string) (Task, error) {
	return service.updateTask(id, func(task *Task, _ time.Time) error {
		comment, err := commentAt(task, commentID)
		if err != nil {
			return err
		}
		if comment.Status == CommentSent {
			return errors.New("the correction that received this comment is still running")
		}
		kept := task.Comments[:0:0]
		for _, item := range task.Comments {
			if item.ID != commentID {
				kept = append(kept, item)
			}
		}
		task.Comments = kept
		return nil
	})
}

func commentAt(task *Task, commentID string) (*ReviewComment, error) {
	for index := range task.Comments {
		if task.Comments[index].ID == commentID {
			return &task.Comments[index], nil
		}
	}
	return nil, errors.New("comment not found")
}

func selectComments(task Task, ids []string) ([]ReviewComment, error) {
	selected := make([]ReviewComment, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		comment, err := commentAt(&task, id)
		if err != nil {
			return nil, err
		}
		if comment.Status == CommentSent || comment.Status == CommentResolved {
			return nil, fmt.Errorf("the comment on %s is %s; reopen it to send it again", commentTarget(*comment), strings.ReplaceAll(string(comment.Status), "_", " "))
		}
		selected = append(selected, *comment)
	}
	return selected, nil
}

func commentTarget(comment ReviewComment) string {
	if comment.Path == "" {
		return "evidence " + comment.EvidenceID
	}
	if comment.StartLine == comment.EndLine {
		return fmt.Sprintf("%s:%d", comment.Path, comment.StartLine)
	}
	return fmt.Sprintf("%s:%d-%d", comment.Path, comment.StartLine, comment.EndLine)
}

// commentsMessage renders the selected comments for the correction prompt.
func commentsMessage(comments []ReviewComment) string {
	if len(comments) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("\nReview comments from the user (paths are relative to your working directory):\n")
	for _, comment := range comments {
		side := "your version"
		if comment.Side == "old" {
			side = "the version before your change"
		}
		if comment.Path != "" {
			fmt.Fprintf(&builder, "\n### %s (%s)\n", commentTarget(comment), side)
		} else {
			fmt.Fprintf(&builder, "\n### About evidence %s\n", comment.EvidenceID)
		}
		if comment.Excerpt != "" {
			builder.WriteString("```\n")
			builder.WriteString(comment.Excerpt)
			builder.WriteString("\n```\n")
		}
		builder.WriteString(comment.Body)
		builder.WriteString("\n")
	}
	return builder.String()
}

// markCommentsFinished moves the comments a finished correction received to "to review".
func markCommentsFinished(task *Task, attemptID string, now time.Time) {
	for index := range task.Comments {
		comment := &task.Comments[index]
		if comment.SentInAttemptID == attemptID && comment.Status == CommentSent {
			comment.Status, comment.UpdatedAt = CommentToReview, now
		}
	}
}

// updateTask applies change under the lock, persists and publishes; on a save error
// the previous task is restored.
func (service *Service) updateTask(id string, change func(*Task, time.Time) error) (Task, error) {
	service.mu.Lock()
	defer service.mu.Unlock()
	task, ok := service.tasks[id]
	if !ok {
		return Task{}, errors.New("agent task not found")
	}
	previous := cloneTask(task)
	now := service.now().UTC()
	if err := change(&task, now); err != nil {
		return Task{}, err
	}
	task.UpdatedAt = now
	service.tasks[id] = task
	if err := service.saveLocked(); err != nil {
		service.tasks[id] = previous
		return Task{}, err
	}
	service.publishLocked(task)
	return cloneTask(service.tasks[id]), nil
}
