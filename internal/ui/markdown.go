package ui

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ddvk/rmfakecloud/internal/common"
	"github.com/gin-gonic/gin"
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

func (app *ReactAppWrapper) markdownPath(uid, docID string) string {
	return filepath.Join(app.cfg.DataDir, "markdown", common.SanitizeUid(uid), common.Sanitize(docID)+".json")
}

func (app *ReactAppWrapper) getMarkdown(c *gin.Context) {
	path := app.markdownPath(userID(c), common.ParamS(docIDParam, c))
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		c.JSON(http.StatusOK, markdownDocument{Source: "# " + common.ParamS(docIDParam, c)})
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
