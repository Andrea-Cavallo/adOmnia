package goide

import (
	"context"
	"testing"
)

func markerNamed(markers []ImplementationMarker, name string) *ImplementationMarker {
	for index := range markers {
		if markers[index].Name == name {
			return &markers[index]
		}
	}
	return nil
}

func TestImplementationMarkersWithRealGopls(t *testing.T) {
	gopls := findGoplsForTest(t)
	root := copyFixture(t, "shapes")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session := startLanguageServerForTest(t, service, recorder, root, gopls)
	sessionID := string(session.ID)

	shape, err := service.OpenDocument(sessionID, "geom/shape.go")
	if err != nil {
		t.Fatal(err)
	}
	markers, err := service.ImplementationMarkers(context.Background(), sessionID, string(shape.Document.ID))
	if err != nil {
		t.Fatal(err)
	}
	iface := markerNamed(markers, "Shape")
	if iface == nil || iface.Direction != "implementedBy" || len(iface.Locations) != 2 {
		t.Fatalf("l'interfaccia deve mostrare due implementazioni: %+v", markers)
	}
	if method := markerNamed(markers, "Area"); method == nil || method.Direction != "implementedBy" || len(method.Locations) != 2 {
		t.Fatalf("il metodo d'interfaccia deve mostrare due implementazioni: %+v", markers)
	}

	square, err := service.OpenDocument(sessionID, "geom/square.go")
	if err != nil {
		t.Fatal(err)
	}
	markers, err = service.ImplementationMarkers(context.Background(), sessionID, string(square.Document.ID))
	if err != nil {
		t.Fatal(err)
	}
	implements := markerNamed(markers, "Square")
	if implements == nil || implements.Direction != "implements" {
		t.Fatalf("il tipo concreto deve indicare le interfacce implementate: %+v", markers)
	}
	foundShape, foundStringer := false, false
	for _, location := range implements.Locations {
		foundShape = foundShape || location.RelativePath == "geom/shape.go"
		foundStringer = foundStringer || location.External
	}
	if !foundShape || !foundStringer {
		t.Fatalf("Square implementa Shape (progetto) e fmt.Stringer (SDK): %+v", implements.Locations)
	}
	for _, marker := range markers {
		for _, location := range marker.Locations {
			if location.RelativePath == "geom/square.go" && location.Range.StartLine == marker.Line {
				t.Fatalf("un marcatore non deve puntare a se stesso: %+v", marker)
			}
		}
	}
}
