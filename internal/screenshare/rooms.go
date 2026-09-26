package screenshare

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
)

type RoomManager struct {
	mu          sync.RWMutex
	rooms       map[string]*Room
	diagnostics *Diagnostics
}

type Room struct {
	RoomID       string
	CreatedAt    time.Time
	lastActivity time.Time
	participants map[string]*RoomClient
	ownerUserID  string
	messages     []Message
	notify       chan struct{}
}

type RoomClient struct {
	ClientID string `json:"clientId"`
	UserID   string `json:"userId"`
	IsOwner  bool   `json:"isOwner"`
}

type Message struct {
	Type           string          `json:"type"`
	SenderClientID string          `json:"clientId,omitempty"`
	TargetClientID string          `json:"targetClientId,omitempty"`
	Payload        json.RawMessage `json:"payload"`
}

const roomTimeout = 60 * time.Second

func NewRoomManager() *RoomManager {
	dataDir, err := os.MkdirTemp("", "rmfakecloud-screenshare-")
	if err != nil {
		dataDir = filepath.Join(os.TempDir(), "rmfakecloud-screenshare")
	}
	return NewRoomManagerWithDiagnostics(dataDir, 7, 5000)
}

func NewRoomManagerWithDiagnostics(dataDir string, retentionDays, maxEvents int) *RoomManager {
	rm := &RoomManager{
		rooms:       make(map[string]*Room),
		diagnostics: NewDiagnostics(dataDir, retentionDays, maxEvents),
	}
	log.Infof("Screenshare diagnostics retention_days=%d max_events_per_user=%d", int(rm.diagnostics.Retention()/(24*time.Hour)), rm.diagnostics.maxEvents)
	go rm.expireLoop()
	return rm
}

func (rm *RoomManager) expireLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		rm.mu.Lock()
		now := time.Now().UTC()
		for id, room := range rm.rooms {
			if now.Sub(room.lastActivity) > roomTimeout {
				rm.diagnostics.Record(room.ownerUserID, "room_expired", "Screen-share room expired after 60 seconds without activity")
				delete(rm.rooms, id)
				log.Infof("Screenshare: expired room=%s (no keepalive for %s)", id, roomTimeout)
			}
		}
		rm.mu.Unlock()
		rm.diagnostics.PruneExpired()
	}
}

func (rm *RoomManager) Keepalive(roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if room, exists := rm.rooms[roomID]; exists {
		room.lastActivity = time.Now().UTC()
	}
}

func (rm *RoomManager) CreateRoom(userID, deviceID string) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	roomID := uuid.New().String()
	now := time.Now().UTC()
	room := &Room{
		RoomID:       roomID,
		CreatedAt:    now,
		lastActivity: now,
		participants: make(map[string]*RoomClient),
		ownerUserID:  userID,
		notify:       make(chan struct{}, 1),
	}
	room.participants[deviceID] = &RoomClient{
		ClientID: deviceID,
		UserID:   userID,
		IsOwner:  true,
	}
	rm.rooms[roomID] = room
	rm.diagnostics.Record(userID, "room_created", "Tablet started a screen-share session")
	log.Infof("Screenshare: created room=%s user=%s device=%s", roomID, userID, deviceID)
	return room
}

func (rm *RoomManager) GetRoom(roomID string) *Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.rooms[roomID]
}

func (rm *RoomManager) GetClients(roomID string) []RoomClient {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil
	}
	clients := make([]RoomClient, 0, len(room.participants))
	for _, c := range room.participants {
		clients = append(clients, *c)
	}
	return clients
}

func (rm *RoomManager) AddBroadcast(roomID, senderClientID string, payload json.RawMessage) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}
	// New broadcast clears old messages to prevent stale signaling on reconnect
	room.messages = nil
	room.messages = append(room.messages, Message{
		Type:           "broadcast",
		SenderClientID: senderClientID,
		Payload:        payload,
	})
	select {
	case room.notify <- struct{}{}:
	default:
	}
	log.Debugf("Screenshare: broadcast in room=%s from=%s", roomID, senderClientID)
}

func (rm *RoomManager) ClearMessages(roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if room, exists := rm.rooms[roomID]; exists {
		room.messages = nil
		select {
		case <-room.notify:
		default:
		}
	}
}

func (rm *RoomManager) AddDirect(roomID, senderClientID, targetClientID string, payload json.RawMessage) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}
	room.messages = append(room.messages, Message{
		Type:           "direct",
		SenderClientID: senderClientID,
		TargetClientID: targetClientID,
		Payload:        payload,
	})
	select {
	case room.notify <- struct{}{}:
	default:
	}
	log.Debugf("Screenshare: direct in room=%s from=%s to=%s", roomID, senderClientID, targetClientID)
}

func (rm *RoomManager) WaitForMessages(roomID string, after int, timeout time.Duration) []Message {
	rm.mu.RLock()
	room, exists := rm.rooms[roomID]
	rm.mu.RUnlock()
	if !exists {
		return nil
	}

	deadline := time.After(timeout)
	for {
		if !rm.RoomExists(roomID) {
			return nil
		}
		msgs := rm.GetMessages(roomID, after)
		if len(msgs) > 0 {
			// Wait briefly for additional messages (ICE candidates follow the offer)
			time.Sleep(200 * time.Millisecond)
			return rm.GetMessages(roomID, after)
		}
		select {
		case <-room.notify:
		case <-deadline:
			return nil
		}
	}
}

func (rm *RoomManager) GetMessages(roomID string, after int) []Message {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil
	}
	if after >= len(room.messages) {
		return nil
	}
	msgs := make([]Message, len(room.messages)-after)
	copy(msgs, room.messages[after:])
	return msgs
}

func (rm *RoomManager) AddParticipant(roomID, clientID, userID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return
	}
	room.participants[clientID] = &RoomClient{
		ClientID: clientID,
		UserID:   userID,
		IsOwner:  false,
	}
	rm.diagnostics.Record(userID, "tablet_joined_room", "Tablet joined the screen-share room")
	log.Debugf("Screenshare: added participant to room=%s client=%s user=%s total=%d",
		roomID, clientID, userID, len(room.participants))
}

func (rm *RoomManager) RemoveParticipant(clientID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	for roomID, room := range rm.rooms {
		if participant, exists := room.participants[clientID]; exists {
			rm.diagnostics.Record(participant.UserID, "tablet_left_room", "Tablet left the screen-share room")
			delete(room.participants, clientID)
			log.Debugf("Screenshare: removed participant from room=%s client=%s remaining=%d",
				roomID, clientID, len(room.participants))

			if len(room.participants) == 0 {
				select {
				case room.notify <- struct{}{}:
				default:
				}
				delete(rm.rooms, roomID)
				log.Infof("Screenshare: removed empty room=%s", roomID)
			}
			return
		}
	}
}

func (rm *RoomManager) RecordDiagnostic(userID, event, message string) {
	rm.diagnostics.Record(userID, event, message)
}

func (rm *RoomManager) DiagnosticHistory(userID string, limit int) []Diagnostic {
	return rm.diagnostics.History(userID, limit)
}

func (rm *RoomManager) SubscribeDiagnostics(userID string) (<-chan Diagnostic, func()) {
	return rm.diagnostics.Subscribe(userID)
}

func (rm *RoomManager) DiagnosticsRetention() time.Duration {
	return rm.diagnostics.Retention()
}

func (rm *RoomManager) DeleteAllForUser(userID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for id, room := range rm.rooms {
		if room.ownerUserID == userID {
			select {
			case room.notify <- struct{}{}:
			default:
			}
			delete(rm.rooms, id)
			log.Infof("Screenshare: deleted room=%s for user=%s", id, userID)
		}
	}
}

func (rm *RoomManager) DeleteRoom(roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if room, exists := rm.rooms[roomID]; exists {
		select {
		case room.notify <- struct{}{}:
		default:
		}
	}
	delete(rm.rooms, roomID)
	log.Infof("Screenshare: deleted room=%s", roomID)
}

func (rm *RoomManager) FindActiveRoom(userID string) string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	var newest *Room
	for _, room := range rm.rooms {
		if room.ownerUserID == userID {
			if newest == nil || room.CreatedAt.After(newest.CreatedAt) {
				newest = room
			}
		}
	}
	if newest != nil {
		return newest.RoomID
	}
	return ""
}

func (rm *RoomManager) RoomExists(roomID string) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	_, exists := rm.rooms[roomID]
	return exists
}
