// A local API for the README screenshots. No accounts or external services.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
)

type Item struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

type Order struct {
	ID         string `json:"id"`
	CustomerID string `json:"customerId"`
	Items      []Item `json:"items"`
	Status     string `json:"status"`
}

func handler() http.Handler {
	var mu sync.Mutex
	orders := []Order{{ID: "ord_1001", CustomerID: "usr_1001", Items: []Item{{"coffee-001", 2}, {"mug-002", 1}}, Status: "confirmed"}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"service": "orders", "status": "ready", "storage": "in-memory"})
	})
	mux.HandleFunc("GET /orders", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"orders": orders, "count": len(orders)})
	})
	mux.HandleFunc("POST /orders", func(w http.ResponseWriter, r *http.Request) {
		var order Order
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&order); err != nil || order.CustomerID == "" || len(order.Items) == 0 {
			http.Error(w, "customerId and items are required", http.StatusBadRequest)
			return
		}
		mu.Lock()
		order.ID = "ord_demo"
		order.Status = "confirmed"
		orders = append(orders, order)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(order)
		log.Printf("order created: customer=%s items=%d", order.CustomerID, len(order.Items))
	})
	return mux
}

func main() {
	log.Print("Orders API listening on http://127.0.0.1:18080")
	log.Fatal(http.ListenAndServe("127.0.0.1:18080", handler()))
}
