package screenshare

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDiagnosticsRetentionLimitPersistenceAndSubscriptions(t *testing.T) {
	dir := t.TempDir()
	d := NewDiagnostics(dir, 7, 2)
	stream, unsubscribe := d.Subscribe("user-a")
	defer unsubscribe()
	d.Record("user-a", "tablet_mqtt_connected", "connected")
	select {
	case event := <-stream:
		if event.Event != "tablet_mqtt_connected" {
			t.Fatalf("unexpected streamed event: %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("diagnostic event was not streamed")
	}
	d.Record("user-a", "offer_requested", "requested")
	d.Record("user-b", "offer_timeout", "private to user-b")
	if got := d.History("user-a", 10); len(got) != 2 {
		t.Fatalf("expected capped user history of 2, got %d", len(got))
	}
	if got := d.History("user-b", 10); len(got) != 1 || got[0].Event != "offer_timeout" {
		t.Fatalf("events were not isolated by user: %+v", got)
	}

	reloaded := NewDiagnostics(dir, 7, 2)
	if got := reloaded.History("user-a", 10); len(got) != 2 || got[0].Event != "tablet_mqtt_connected" {
		t.Fatalf("diagnostics did not persist in order: %+v", got)
	}
}

func TestDiagnosticsPrunesExpiredEventsOnStartup(t *testing.T) {
	dir := t.TempDir()
	old := diagnosticRecord{
		UserID: "user-a",
		Diagnostic: Diagnostic{
			At: time.Now().UTC().Add(-8 * 24 * time.Hour), Event: "old_event",
		},
	}
	data, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "screenshare-diagnostics.jsonl"), append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	d := NewDiagnostics(dir, 7, 5000)
	if got := d.History("user-a", 10); len(got) != 0 {
		t.Fatalf("expired event was retained: %+v", got)
	}
}
