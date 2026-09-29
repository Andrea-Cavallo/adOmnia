package lib

func r(m Mux) { m.HandleFunc("GET /vendored", h) }
