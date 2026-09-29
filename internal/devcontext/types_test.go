package devcontext

import "testing"

func TestMergeFoldsSameIDAcrossSources(t *testing.T) {
	code := entity("route", "GET /payments/{id}", "GET /payments/{id}", ConfidenceInferred,
		map[string]string{"handler": "getPayment"}, Source{"goroutes", "api/routes.go", 12})
	oas := entity("route", "GET /payments/{id}", "GET /payments/{id}", ConfidenceCertain,
		map[string]string{"handler": "ignored", "contract": "api/openapi.yaml"}, Source{"oas", "api/openapi.yaml", 30})
	table := entity("table", "payments", "payments", ConfidenceInferred, nil, Source{"goliterals", "store.go", 4})

	got := merge([]Entity{code}, []Entity{oas, table})

	if len(got) != 2 {
		t.Fatalf("want 2 entities, got %d: %+v", len(got), got)
	}
	route := got[0]
	if route.Kind != "route" || route.ID != "route:GET /payments/{id}" {
		t.Fatalf("entities must be sorted by kind then id, got %+v", got)
	}
	if len(route.Sources) != 2 {
		t.Fatalf("sources must be appended, got %+v", route.Sources)
	}
	if route.Attrs["handler"] != "getPayment" || route.Attrs["contract"] != "api/openapi.yaml" {
		t.Fatalf("attrs must be unioned with first writer winning, got %+v", route.Attrs)
	}
	if route.Confidence != ConfidenceCertain {
		t.Fatalf("certain must win over inferred, got %s", route.Confidence)
	}
	if code.Attrs["contract"] != "" || len(code.Sources) != 1 {
		t.Fatalf("merge must not mutate its inputs, got %+v", code)
	}
}

func TestMergeEmptyIsNonNil(t *testing.T) {
	if got := merge(); got == nil {
		t.Fatal("merge must return a non-nil slice so JSON encodes []")
	}
}
