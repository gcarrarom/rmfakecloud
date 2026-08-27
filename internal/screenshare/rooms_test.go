package screenshare

import "testing"

func TestRemoveParticipantDeletesEmptyRoom(t *testing.T) {
	manager := NewRoomManager()
	room := manager.CreateRoom("user", "device")

	manager.RemoveParticipant("device")

	if manager.RoomExists(room.RoomID) {
		t.Fatalf("room %s still exists after its only participant disconnected", room.RoomID)
	}
}
