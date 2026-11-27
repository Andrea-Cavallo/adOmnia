package database

import (
	jsonv1 "encoding/json"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestMongoReadOptions(t *testing.T) {
	c, err := mongoCollation(jsonv1.RawMessage(`{"locale":"it","strength":2,"numericOrdering":true}`))
	if err != nil || c == nil || c.Locale != "it" || c.Strength != 2 || !c.NumericOrdering {
		t.Fatalf("collation = %+v, %v", c, err)
	}
	if _, err := mongoCollation(jsonv1.RawMessage(`{"strength":2}`)); err == nil {
		t.Fatal("collation without locale must fail")
	}
	if _, err := mongoCollation(jsonv1.RawMessage(`{"locale":"it","bogus":1}`)); err == nil {
		t.Fatal("unknown collation key must fail")
	}
	if c, err := mongoCollation(nil); c != nil || err != nil {
		t.Fatalf("empty collation = %+v, %v", c, err)
	}

	if h, err := mongoHint(jsonv1.RawMessage(`"name_1"`)); err != nil || h != "name_1" {
		t.Fatalf("string hint = %v, %v", h, err)
	}
	if h, err := mongoHint(jsonv1.RawMessage(`{"name":1}`)); err != nil || h == nil {
		t.Fatalf("doc hint = %v, %v", h, err)
	}
	if h, err := mongoHint(nil); h != nil || err != nil {
		t.Fatalf("empty hint = %v, %v", h, err)
	}

	cases := []struct {
		req, max int64
		want     time.Duration
	}{
		{0, 0, 30 * time.Second},
		{10_000, 500, 500 * time.Millisecond},
		{1_000, 5_000, time.Second},
	}
	for _, tc := range cases {
		if got := mongoTimeout(tc.req, tc.max); got != tc.want {
			t.Errorf("mongoTimeout(%d, %d) = %v, want %v", tc.req, tc.max, got, tc.want)
		}
	}
}

func TestMongoReadOnlyCommand(t *testing.T) {
	for raw, want := range map[string]bool{
		`{"explain":{"find":"c"},"verbosity":"executionStats"}`: true,
		`{"serverStatus":1}`:                          true,
		`{"currentOp":1,"active":true}`:               true,
		`{"dropDatabase":1}`:                          false,
		`{"killOp":1,"op":5}`:                         false,
		`{"aggregate":"c","pipeline":[{"$out":"x"}]}`: false,
		``:         false,
		`not json`: false,
	} {
		if got := mongoReadOnlyCommand(jsonv1.RawMessage(raw)); got != want {
			t.Errorf("mongoReadOnlyCommand(%s) = %v, want %v", raw, got, want)
		}
	}
}

func TestMongoSpecCapped(t *testing.T) {
	capped, _ := bson.Marshal(bson.D{{Key: "capped", Value: true}, {Key: "size", Value: 1024}})
	plain, _ := bson.Marshal(bson.D{{Key: "validator", Value: bson.D{}}})
	if !mongoSpecCapped(capped) || mongoSpecCapped(plain) || mongoSpecCapped(nil) {
		t.Fatal("mongoSpecCapped misreads the collection options")
	}
}
