package fs

import (
	"testing"

	"github.com/ddvk/rmfakecloud/internal/storage/models"
)

func TestOrderedV6PageHashesUsesContentOrder(t *testing.T) {
	files := []*models.HashEntry{
		{EntryName: "page-b.rm", Hash: "hash-b"},
		{EntryName: "page-a.rm", Hash: "hash-a"},
	}

	got := orderedV6PageHashes(files, []string{"page-a.rm", "page-b"})
	if want := "hash-a,hash-b"; joinHashes(got) != want {
		t.Fatalf("ordered hashes = %q, want %q", joinHashes(got), want)
	}
}

func TestOrderedV6PageHashesDoesNotReverseNumericFallback(t *testing.T) {
	files := []*models.HashEntry{
		{EntryName: "2.rm", Hash: "hash-2"},
		{EntryName: "0.rm", Hash: "hash-0"},
		{EntryName: "1.rm", Hash: "hash-1"},
	}

	got := orderedV6PageHashes(files, nil)
	if want := "hash-0,hash-1,hash-2"; joinHashes(got) != want {
		t.Fatalf("ordered hashes = %q, want %q", joinHashes(got), want)
	}
}

func joinHashes(hashes []string) string {
	result := ""
	for i, hash := range hashes {
		if i > 0 {
			result += ","
		}
		result += hash
	}
	return result
}
