package dap

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"testing"
	"time"
)

// fakeAdapter risponde alle richieste nell'ordine inverso e invia eventi e una richiesta inversa.
func fakeAdapter(t *testing.T, conn net.Conn) {
	t.Helper()
	reader := bufio.NewReader(conn)
	send := func(value map[string]any) {
		data, _ := json.Marshal(value)
		fmt.Fprintf(conn, "Content-Length: %d\r\n\r\n%s", len(data), data)
	}
	var held []map[string]any
	for {
		frame, err := readFrame(reader)
		if err != nil {
			return
		}
		var request map[string]any
		_ = json.Unmarshal(frame, &request)
		switch request["command"] {
		case "first", "second":
			held = append(held, request)
			if len(held) == 2 {
				send(map[string]any{"seq": 1, "type": "event", "event": "output", "body": map[string]any{"output": "one"}})
				send(map[string]any{"seq": 2, "type": "event", "event": "output", "body": map[string]any{"output": "two"}})
				send(map[string]any{"seq": 3, "type": "request", "command": "runInTerminal"})
				for index := len(held) - 1; index >= 0; index-- {
					send(map[string]any{"seq": 10 + index, "type": "response", "request_seq": held[index]["seq"], "success": true, "command": held[index]["command"], "body": map[string]any{"name": held[index]["command"]}})
				}
			}
		case "evaluate":
			send(map[string]any{"seq": 20, "type": "response", "request_seq": request["seq"], "success": false, "command": "evaluate", "message": "Unable to evaluate expression", "body": map[string]any{"error": map[string]any{"format": "could not find symbol value for nope"}}})
		case "response":
		default:
			if request["type"] == "response" && request["command"] == "runInTerminal" && request["success"] == false {
				send(map[string]any{"seq": 30, "type": "event", "event": "reverseRefused"})
			}
		}
	}
}

func TestClientCorrelatesResponsesOrdersEventsAndRefusesReverseRequests(t *testing.T) {
	clientSide, adapterSide := net.Pipe()
	go fakeAdapter(t, adapterSide)
	client := NewClient(clientSide)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := make(chan string, 2)
	for _, command := range []string{"first", "second"} {
		go func(command string) {
			var body struct {
				Name string `json:"name"`
			}
			if err := client.Call(ctx, command, nil, &body); err != nil {
				results <- "error: " + err.Error()
				return
			}
			results <- command + "=" + body.Name
		}(command)
		time.Sleep(20 * time.Millisecond)
	}
	got := map[string]bool{<-results: true, <-results: true}
	if !got["first=first"] || !got["second=second"] {
		t.Fatalf("risposte non correlate alle richieste: %v", got)
	}
	var order []string
	for len(order) < 3 {
		select {
		case event := <-client.Events():
			order = append(order, event.Event+string(event.Body))
		case <-ctx.Done():
			t.Fatalf("eventi mancanti: %v", order)
		}
	}
	if order[0] != `output{"output":"one"}` || order[1] != `output{"output":"two"}` || order[2] != "reverseRefused" {
		t.Fatalf("ordine degli eventi o risposta inversa errati: %v", order)
	}
	err := client.Call(ctx, "evaluate", map[string]string{"expression": "nope"}, nil)
	if err == nil || err.Error() != "could not find symbol value for nope" {
		t.Fatalf("errore dettagliato atteso, ottenuto %v", err)
	}
	_ = adapterSide.Close()
	<-client.Done()
	if err := client.Call(context.Background(), "first", nil, nil); err != ErrClosed {
		t.Fatalf("una chiamata su connessione chiusa deve fallire subito: %v", err)
	}
}
