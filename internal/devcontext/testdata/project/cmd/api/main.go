package main

import "net/http"

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /payments", createPayment)
	mux.HandleFunc("GET /payments/{id}", getPayment)
	_ = http.ListenAndServe(":8080", mux)
}
