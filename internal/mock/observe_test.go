package mock

import "testing"

func TestHitsSinceReturnsOnlyNewHits(t *testing.T) {
	cursor := HitSequence()
	recordHitDetailed("GET", "/users/1", true, "r1", 200, mockHitDetails{EndpointPath: "/users/:id"})
	recordHitDetailed("POST", "/orders", false, "", 404, mockHitDetails{Reason: "no endpoint"})
	hits, dropped := HitsSince(cursor)
	if dropped != 0 || len(hits) != 2 || hits[0].EndpointPath != "/users/:id" || hits[1].Matched {
		t.Fatalf("hits = %+v, dropped %d", hits, dropped)
	}
	if more, _ := HitsSince(HitSequence()); len(more) != 0 {
		t.Fatalf("a fresh cursor must see nothing, got %+v", more)
	}
}
