package screenshare

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBroadcastWakesOfferWaiter(t *testing.T) {
	manager := NewRoomManager()
	room := manager.CreateRoom("user", "tablet")
	manager.ClearMessages(room.RoomID)
	result := make(chan []Message, 1)
	go func() { result <- manager.WaitForMessages(room.RoomID, 0, time.Second) }()
	manager.AddBroadcast(room.RoomID, "tablet", json.RawMessage(`{"type":"offer"}`))
	select {
	case messages := <-result:
		if len(messages) != 1 || messages[0].Payload == nil {
			t.Fatalf("expected the offer broadcast, got %+v", messages)
		}
	case <-time.After(time.Second):
		t.Fatal("offer broadcast did not wake waiter")
	}
}

func TestRemoveParticipantDeletesEmptyRoom(t *testing.T) {
	manager := NewRoomManager()
	room := manager.CreateRoom("user", "device")

	manager.RemoveParticipant("device")

	if manager.RoomExists(room.RoomID) {
		t.Fatalf("room %s still exists after its only participant disconnected", room.RoomID)
	}
}
