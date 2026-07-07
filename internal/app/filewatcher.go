package app

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	log "github.com/sirupsen/logrus"
)

const (
	debounceDelay  = 500 * time.Millisecond
	rescanInterval = 30 * time.Second
)

// SyncNotifier sends sync notifications for a user.
type SyncNotifier interface {
	NotifySync(uid, deviceID string) string
}

// FileWatcher watches user data directories for external changes
// and triggers sync notifications to connected tablets.
type FileWatcher struct {
	watcher   *fsnotify.Watcher
	notifier  SyncNotifier
	dataDir   string

	mu         sync.Mutex
	debouncers map[string]*time.Timer
	userDirs   map[string]string // uid -> sync dir path
	stop       chan struct{}
}

// NewFileWatcher creates a file watcher that monitors user sync directories.
func NewFileWatcher(dataDir string, notifier SyncNotifier) (*FileWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	fw := &FileWatcher{
		watcher:   w,
		notifier:  notifier,
		dataDir:   dataDir,
		debouncers: make(map[string]*time.Timer),
		userDirs:  make(map[string]string),
		stop:      make(chan struct{}),
	}

	go fw.loop()
	go fw.rescanLoop()
	return fw, nil
}

// AddUser starts watching a user's sync directory.
func (fw *FileWatcher) AddUser(uid, syncDir string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	if _, exists := fw.userDirs[uid]; exists {
		return
	}

	if err := fw.watcher.Add(syncDir); err != nil {
		log.Warnf("filewatcher: cannot watch %s: %v", syncDir, err)
		return
	}

	fw.userDirs[uid] = syncDir
	log.Debugf("filewatcher: watching %s for user %s", syncDir, uid)
}

// RemoveUser stops watching a user's sync directory.
func (fw *FileWatcher) RemoveUser(uid string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	syncDir, exists := fw.userDirs[uid]
	if !exists {
		return
	}

	fw.watcher.Remove(syncDir)
	delete(fw.userDirs, uid)
	log.Debugf("filewatcher: stopped watching %s for user %s", syncDir, uid)
}

// Stop shuts down the file watcher.
func (fw *FileWatcher) Stop() {
	close(fw.stop)
	fw.watcher.Close()
}

func (fw *FileWatcher) loop() {
	for {
		select {
		case <-fw.stop:
			return
		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}
			fw.handleEvent(event)
		case err, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}
			log.Warn("filewatcher: error:", err)
		}
	}
}

// rescanLoop periodically checks for new users.
func (fw *FileWatcher) rescanLoop() {
	ticker := time.NewTicker(rescanInterval)
	defer ticker.Stop()

	for {
		select {
		case <-fw.stop:
			return
		case <-ticker.C:
			fw.discoverUsers()
		}
	}
}

func (fw *FileWatcher) discoverUsers() {
	usersDir := filepath.Join(fw.dataDir, "users")
	entries, err := os.ReadDir(usersDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		uid := entry.Name()
		syncDir := filepath.Join(usersDir, uid, "sync")
		if _, err := os.Stat(syncDir); err == nil {
			fw.AddUser(uid, syncDir)
		}
	}
}

func (fw *FileWatcher) handleEvent(event fsnotify.Event) {
	// Only care about writes and creates to the root blob
	if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
		return
	}

	base := filepath.Base(event.Name)

	// Watch the root blob file and the history file
	if base != "root" && base != ".root.history" {
		return
	}

	uid := fw.uidFromPath(event.Name)
	if uid == "" {
		return
	}

	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Debounce: reset timer if one is already pending
	if timer, exists := fw.debouncers[uid]; exists {
		timer.Stop()
	}

	fw.debouncers[uid] = time.AfterFunc(debounceDelay, func() {
		log.Infof("filewatcher: change detected for %s, notifying tablets", uid)
		fw.notifier.NotifySync(uid, "filewatcher")
	})
}

// uidFromPath extracts the user ID from a file path like
// /data/users/<uid>/sync/root.
func (fw *FileWatcher) uidFromPath(path string) string {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	for uid, syncDir := range fw.userDirs {
		if filepath.Dir(path) == syncDir {
			return uid
		}
	}
	return ""
}
