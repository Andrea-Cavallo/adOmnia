package codestudio

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/database"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/kafka"
	"github.com/Andrea-Cavallo/adOmnia/internal/mock"
)

// mockObservation records what the mock server received while a verification ran.
type mockObservation struct {
	running bool
	cursor  int64
}

func observeMock() mockObservation {
	running, _ := mock.Running()
	return mockObservation{running: running, cursor: mock.HitSequence()}
}

// annotate adds the mock hits to the evidence, or says they were not collected:
// a stopped mock server is not "no calls".
func (observation mockObservation) annotate(evidence agenttask.Evidence) agenttask.Evidence {
	if !observation.running {
		evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "mockHits", Value: "not collected: the mock server was not running"})
		return evidence
	}
	hits, dropped := mock.HitsSince(observation.cursor)
	evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "mockHits", Value: fmt.Sprintf("%d", len(hits))})
	if len(hits) == 0 && dropped == 0 {
		return evidence
	}
	var builder strings.Builder
	builder.WriteString("\n\n--- mock server calls during the verification ---\n")
	for _, hit := range hits {
		target := hit.EndpointPath
		if !hit.Matched {
			target = "no match"
			if hit.Reason != "" {
				target += ": " + hit.Reason
			}
		}
		fmt.Fprintf(&builder, "%s %s → %d (%s", hit.Method, hit.Path, hit.Status, target)
		if hit.ResponseName != "" {
			fmt.Fprintf(&builder, ", %s", hit.ResponseName)
		}
		builder.WriteString(")\n")
	}
	if dropped > 0 {
		fmt.Fprintf(&builder, "… %d earlier calls were no longer in the mock log\n", dropped)
	}
	evidence.Log += builder.String()
	return evidence
}

// stackMarkers start a stack trace or an uncaught error in common runtimes.
var stackMarkers = []string{
	"panic: ", "goroutine ", // Go
	"Exception in thread", "Caused by: ", // Java
	"Traceback (most recent call last):",    // Python
	"thread 'main' panicked", "panicked at", // Rust
	"Uncaught ", "UnhandledPromiseRejection", // Node
}

const maxStackLines = 60

// extractStackTrace returns the first stack trace found in output (bounded), or "".
// ponytail: marker heuristic over common runtimes; a language adapter capability can replace it when one needs exact parsing.
func extractStackTrace(output string) string {
	lines := strings.Split(output, "\n")
	for index, line := range lines {
		for _, marker := range stackMarkers {
			if strings.Contains(line, marker) {
				end := min(len(lines), index+maxStackLines)
				return strings.TrimRight(strings.Join(lines[index:end], "\n"), "\n")
			}
		}
	}
	return ""
}

// withStackTrace adds the stack trace found in the service output, if any.
func withStackTrace(evidence agenttask.Evidence, serviceOutput string) agenttask.Evidence {
	trace := extractStackTrace(serviceOutput)
	if trace == "" {
		evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "stackTrace", Value: "none in the service output"})
		return evidence
	}
	evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "stackTrace", Value: "found"})
	evidence.Log += "\n\n--- stack trace from the service output ---\n" + trace
	return evidence
}

// brokerObservation records the messages produced on the watched topics while a verification ran.
type brokerObservation struct {
	watch agenttask.VerificationWatch
	marks kafka.TopicMarks
	err   error
}

const maxObservedMessages = 50

func observeBroker(watch agenttask.VerificationWatch) brokerObservation {
	if !watch.Enabled() {
		return brokerObservation{}
	}
	marks, err := kafka.MarkTopics(watch.Brokers, watch.Topics)
	return brokerObservation{watch: watch, marks: marks, err: err}
}

// annotate adds the messages to the evidence, or says why they were not collected:
// an unreachable broker is not "no messages".
func (observation brokerObservation) annotate(ctx context.Context, evidence agenttask.Evidence) agenttask.Evidence {
	if !observation.watch.Enabled() {
		return evidence
	}
	if observation.err != nil {
		return notCollectedMessages(evidence, observation.err)
	}
	messages, dropped, err := kafka.MessagesSince(ctx, observation.watch.Brokers, observation.marks, maxObservedMessages)
	if err != nil && len(messages) == 0 {
		return notCollectedMessages(evidence, err)
	}
	evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "brokerMessages", Value: fmt.Sprintf("%d", int64(len(messages))+dropped)})
	if len(messages) == 0 {
		return evidence
	}
	var builder strings.Builder
	builder.WriteString("\n\n--- broker messages produced during the verification ---\n")
	for _, message := range messages {
		fmt.Fprintf(&builder, "%s[%d]@%d key=%q %s\n", message.Topic, message.Partition, message.Offset, message.Key, truncateText(message.Value, 512))
	}
	if dropped > 0 {
		fmt.Fprintf(&builder, "… %d more messages were not read\n", dropped)
	}
	if err != nil {
		fmt.Fprintf(&builder, "reading stopped early: %v\n", err)
	}
	evidence.Log += builder.String()
	return evidence
}

func notCollectedMessages(evidence agenttask.Evidence, err error) agenttask.Evidence {
	evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "brokerMessages", Value: "not collected: " + err.Error()})
	return evidence
}

// databaseObservation records the statements a saved database connection ran while a verification ran.
type databaseObservation struct {
	connectionID string
	marks        database.StatementMarks
	err          error
}

const maxObservedStatements = 30

func observeDatabase(ctx context.Context, connectionID string) databaseObservation {
	if connectionID == "" {
		return databaseObservation{}
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	marks, err := database.MarkStatements(ctx, connectionID)
	return databaseObservation{connectionID: connectionID, marks: marks, err: err}
}

// annotate adds the statements to the evidence, or says why they were not collected.
func (observation databaseObservation) annotate(ctx context.Context, evidence agenttask.Evidence) agenttask.Evidence {
	if observation.connectionID == "" {
		return evidence
	}
	err := observation.err
	var statements []database.ObservedStatement
	var dropped int
	if err == nil {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		statements, dropped, err = database.StatementsSince(ctx, observation.connectionID, observation.marks, maxObservedStatements)
	}
	if err != nil {
		evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "databaseQueries", Value: "not collected: " + err.Error()})
		return evidence
	}
	evidence.Observations = append(evidence.Observations, agenttask.Observation{Name: "databaseQueries", Value: fmt.Sprintf("%d", len(statements)+dropped)})
	if len(statements) == 0 {
		return evidence
	}
	var builder strings.Builder
	builder.WriteString("\n\n--- database queries during the verification (pg_stat_statements, all clients of the database) ---\n")
	for _, statement := range statements {
		fmt.Fprintf(&builder, "%d× %s\n", statement.Calls, truncateText(strings.Join(strings.Fields(statement.Query), " "), 512))
	}
	if dropped > 0 {
		fmt.Fprintf(&builder, "… %d more statements\n", dropped)
	}
	evidence.Log += builder.String()
	return evidence
}
