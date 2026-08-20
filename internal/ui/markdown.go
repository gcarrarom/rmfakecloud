package ui

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ddvk/rmfakecloud/internal/common"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type markdownDocument struct {
	Source      string    `json:"source"`
	UpdatedAt   time.Time `json:"updatedAt"`
	BaseVersion string    `json:"baseVersion,omitempty"`
}

type markdownUpdate struct {
	Source      string `json:"source"`
	BaseVersion string `json:"baseVersion,omitempty"`
}

func newMarkdownArchive(name string) (io.Reader, string, error) {
	docID := uuid.NewString()
	pageID := uuid.NewString()
	now := fmt.Sprintf("%d", time.Now().UnixMilli())

	content := map[string]interface{}{
		"dummyDocument": false,
		"fileType":      "",
		"orientation":   "portrait",
		"pageCount":     1,
		"pages":         []string{pageID},
		"pageTags":      []string{},
		"textScale":     1,
		"lineHeight":    -1,
		"margins":       100,
		"transform": map[string]float32{
			"m11": 1, "m22": 1, "m33": 1,
		},
	}
	metadata := map[string]interface{}{
		"visibleName":      name,
		"type":             common.DocumentType,
		"parent":           "",
		"createdTime":      now,
		"lastModified":     now,
		"lastOpened":       now,
		"version":          1,
		"synced":           true,
		"modified":         true,
		"metadatamodified": true,
	}
	pageMetadata := map[string]interface{}{"layers": []map[string]string{{"name": "Layer 1"}}}
	contentBytes, err := json.Marshal(content)
	if err != nil {
		return nil, "", err
	}
	metadataBytes, err := json.Marshal(metadata)
	if err != nil {
		return nil, "", err
	}
	pageMetadataBytes, err := json.Marshal(pageMetadata)
	if err != nil {
		return nil, "", err
	}
	rmBytes := make([]byte, 51)
	copy(rmBytes, "reMarkable .lines file, version=5          ")
	binary.LittleEndian.PutUint32(rmBytes[43:47], 1) // one empty layer
	// The remaining four bytes are the line count for that layer.

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	files := map[string][]byte{
		docID + ".content":        contentBytes,
		docID + ".metadata":       metadataBytes,
		docID + ".pagedata":       []byte("Blank\n"),
		pageID + ".rm":            rmBytes,
		pageID + "-metadata.json": pageMetadataBytes,
		"0.jpg":                   {},
	}
	for filename, data := range files {
		if err := func() error {
			entry, err := writer.Create(filename)
			if err != nil {
				return err
			}
			_, err = entry.Write(data)
			return err
		}(); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return bytes.NewReader(archive.Bytes()), docID, nil
}

func (app *ReactAppWrapper) markdownPath(uid, docID string) string {
	return filepath.Join(app.cfg.DataDir, "markdown", common.SanitizeUid(uid), common.Sanitize(docID)+".json")
}

func (app *ReactAppWrapper) getMarkdown(c *gin.Context) {
	path := app.markdownPath(userID(c), common.ParamS(docIDParam, c))
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		c.JSON(http.StatusOK, markdownDocument{})
		return
	}
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	var document markdownDocument
	if err := json.Unmarshal(data, &document); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "invalid markdown sidecar"})
		return
	}
	c.JSON(http.StatusOK, document)
}

func (app *ReactAppWrapper) updateMarkdown(c *gin.Context) {
	var update markdownUpdate
	if err := c.ShouldBindJSON(&update); err != nil {
		badReq(c, err.Error())
		return
	}
	document := markdownDocument{
		Source:      update.Source,
		UpdatedAt:   time.Now().UTC(),
		BaseVersion: update.BaseVersion,
	}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	path := app.markdownPath(userID(c), common.ParamS(docIDParam, c))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, document)
}

func (app *ReactAppWrapper) createMarkdown(c *gin.Context) {
	var request struct {
		Name   string `json:"name" binding:"required"`
		Parent string `json:"parent,omitempty"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		badReq(c, err.Error())
		return
	}
	archive, docID, err := newMarkdownArchive(request.Name)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	doc, err := app.getBackend(c).CreateDocument(userID(c), request.Name+".rmdoc", request.Parent, archive)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if doc.ID == "" {
		doc.ID = docID
	}
	source := markdownDocument{UpdatedAt: time.Now().UTC()}
	data, err := json.MarshalIndent(source, "", "  ")
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	path := app.markdownPath(userID(c), doc.ID)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	app.getBackend(c).Sync(userID(c))
	c.JSON(http.StatusOK, gin.H{"id": doc.ID, "name": request.Name, "parent": request.Parent})
}
