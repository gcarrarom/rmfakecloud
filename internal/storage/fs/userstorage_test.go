package fs

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ddvk/rmfakecloud/internal/config"
)

func TestGetStorageUsage(t *testing.T) {
	dataDir := t.TempDir()
	storage := NewStorage(&config.Config{DataDir: dataDir})
	userDir := filepath.Join(dataDir, "users", "user")
	if err := os.MkdirAll(filepath.Join(userDir, "sync"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userDir, ".userprofile"), []byte("1234"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userDir, "sync", "blob"), []byte("123456"), 0600); err != nil {
		t.Fatal(err)
	}

	usage, err := storage.GetStorageUsage("user")
	if err != nil {
		t.Fatal(err)
	}
	if usage != 10 {
		t.Fatalf("usage = %d, want 10", usage)
	}
}
