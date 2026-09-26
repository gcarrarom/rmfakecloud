package screenshare

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Diagnostic is a deliberately small, credential-free screenshare event.
type Diagnostic struct {
	At      time.Time `json:"at"`
	Event   string    `json:"event"`
	Message string    `json:"message,omitempty"`
}

type diagnosticRecord struct {
	UserID string `json:"userId"`
	Diagnostic
}

type Diagnostics struct {
	mu          sync.Mutex
	path        string
	retention   time.Duration
	maxEvents   int
	items       []diagnosticRecord
	subscribers map[string]map[chan Diagnostic]struct{}
}

func (d *Diagnostics) Retention() time.Duration { return d.retention }

func (d *Diagnostics) PruneExpired() {
	d.mu.Lock()
	d.pruneLocked(time.Now().UTC())
	d.mu.Unlock()
}

func NewDiagnostics(dataDir string, retentionDays, maxEvents int) *Diagnostics {
	if retentionDays <= 0 {
		retentionDays = 7
	}
	if retentionDays > 36500 {
		retentionDays = 36500
	}
	if maxEvents <= 0 {
		maxEvents = 5000
	}
	if maxEvents > 100000 {
		maxEvents = 100000
	}
	d := &Diagnostics{
		path:        filepath.Join(dataDir, "screenshare-diagnostics.jsonl"),
		retention:   time.Duration(retentionDays) * 24 * time.Hour,
		maxEvents:   maxEvents,
		subscribers: make(map[string]map[chan Diagnostic]struct{}),
	}
	_ = os.MkdirAll(filepath.Dir(d.path), 0700)
	d.load()
	d.pruneLocked(time.Now().UTC())
	_ = os.Chmod(d.path, 0600)
	return d
}

func (d *Diagnostics) load() {
	f, err := os.Open(d.path)
	if err != nil {
		return
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 4096), 64*1024)
	for s.Scan() {
		var r diagnosticRecord
		if json.Unmarshal(s.Bytes(), &r) == nil && r.UserID != "" && !r.At.IsZero() {
			d.items = append(d.items, r)
		}
	}
}

func (d *Diagnostics) Record(userID, event, message string) {
	if userID == "" || event == "" {
		return
	}
	if len(message) > 500 {
		message = message[:500]
	}
	r := diagnosticRecord{UserID: userID, Diagnostic: Diagnostic{At: time.Now().UTC(), Event: event, Message: message}}
	d.mu.Lock()
	d.items = append(d.items, r)
	if !d.pruneLocked(r.At) {
		if f, err := os.OpenFile(d.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); err == nil {
			_ = json.NewEncoder(f).Encode(r)
			_ = f.Close()
		}
	}
	for ch := range d.subscribers[userID] {
		select {
		case ch <- r.Diagnostic:
		default:
			// A slow browser should not stall signaling. The stream can reconnect
			// and receive a fresh bounded history snapshot.
		}
	}
	d.mu.Unlock()
}

func (d *Diagnostics) History(userID string, limit int) []Diagnostic {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pruneLocked(time.Now().UTC())
	if limit <= 0 || limit > d.maxEvents {
		limit = d.maxEvents
	}
	result := make([]Diagnostic, 0, limit)
	for i := len(d.items) - 1; i >= 0 && len(result) < limit; i-- {
		if d.items[i].UserID == userID {
			result = append(result, d.items[i].Diagnostic)
		}
	}
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result
}

func (d *Diagnostics) Subscribe(userID string) (<-chan Diagnostic, func()) {
	ch := make(chan Diagnostic, 32)
	d.mu.Lock()
	if d.subscribers[userID] == nil {
		d.subscribers[userID] = make(map[chan Diagnostic]struct{})
	}
	d.subscribers[userID][ch] = struct{}{}
	d.mu.Unlock()
	return ch, func() {
		d.mu.Lock()
		delete(d.subscribers[userID], ch)
		if len(d.subscribers[userID]) == 0 {
			delete(d.subscribers, userID)
		}
		close(ch)
		d.mu.Unlock()
	}
}

func (d *Diagnostics) pruneLocked(now time.Time) bool {
	previousLen := len(d.items)
	cutoff := now.Add(-d.retention)
	kept := make([]diagnosticRecord, 0, len(d.items))
	perUser := make(map[string]int)
	for i := len(d.items) - 1; i >= 0; i-- {
		item := d.items[i]
		if item.At.After(cutoff) && perUser[item.UserID] < d.maxEvents {
			kept = append(kept, item)
			perUser[item.UserID]++
		}
	}
	for i, j := 0, len(kept)-1; i < j; i, j = i+1, j-1 {
		kept[i], kept[j] = kept[j], kept[i]
	}
	d.items = kept
	pruned := len(d.items) != previousLen
	if pruned {
		if f, err := os.OpenFile(d.path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600); err == nil {
			enc := json.NewEncoder(f)
			for _, item := range d.items {
				_ = enc.Encode(item)
			}
			_ = f.Close()
		}
	}
	return pruned
}
