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
	"strconv"
	"strings"
	"time"

	"github.com/ddvk/rmfakecloud/internal/common"
	"github.com/ddvk/rmfakecloud/internal/storage/exporter"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jung-kurt/gofpdf"
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
	rmBytes := emptyRmPage()

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

func emptyRmPage() []byte {
	data := make([]byte, 51)
	copy(data, "reMarkable .lines file, version=5          ")
	binary.LittleEndian.PutUint32(data[43:47], 1) // one empty layer
	return data
}

func renderMarkdownPDF(source string) ([]byte, int, error) {
	pdf := gofpdf.New("P", "pt", "", "")
	pdf.SetTitle("Markdown document", false)
	pdf.SetMargins(32, 32, 32)
	pdf.SetAutoPageBreak(true, 32)
	pageSources := strings.Split(source, "\n---\n")
	if len(pageSources) == 0 {
		pageSources = []string{""}
	}

	for _, pageSource := range pageSources {
		pdf.AddPageFormat("P", gofpdf.SizeType{Wd: 445, Ht: 594})
		inCode := false
		for _, rawLine := range strings.Split(strings.ReplaceAll(pageSource, "\r\n", "\n"), "\n") {
			line := strings.TrimRight(rawLine, "\r")
			if strings.HasPrefix(strings.TrimSpace(line), "```") {
				inCode = !inCode
				continue
			}
			if inCode {
				pdf.SetFont("Courier", "", 8)
				pdf.MultiCell(381, 11, line, "", "L", false)
				continue
			}

			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				pdf.Ln(8)
				continue
			}
			fontSize := 11.0
			fontStyle := ""
			if strings.HasPrefix(trimmed, "### ") {
				fontSize, fontStyle, trimmed = 14, "B", strings.TrimPrefix(trimmed, "### ")
			} else if strings.HasPrefix(trimmed, "## ") {
				fontSize, fontStyle, trimmed = 17, "B", strings.TrimPrefix(trimmed, "## ")
			} else if strings.HasPrefix(trimmed, "# ") {
				fontSize, fontStyle, trimmed = 21, "B", strings.TrimPrefix(trimmed, "# ")
			} else if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
				trimmed = "- " + strings.TrimSpace(trimmed[2:])
			} else if len(trimmed) > 2 && trimmed[0] >= '0' && trimmed[0] <= '9' {
				if dot := strings.Index(trimmed, ". "); dot > 0 {
					if _, err := strconv.Atoi(trimmed[:dot]); err == nil {
						trimmed = trimmed[:dot+2] + trimmed[dot+2:]
					}
				}
			}
			trimmed = strings.ReplaceAll(trimmed, "**", "")
			trimmed = strings.ReplaceAll(trimmed, "`", "")
			pdf.SetFont("Helvetica", fontStyle, fontSize)
			pdf.MultiCell(381, fontSize+4, trimmed, "", "L", false)
		}
	}

	var output bytes.Buffer
	if err := pdf.Output(&output); err != nil {
		return nil, 0, err
	}
	return output.Bytes(), len(pageSources), nil
}

func updateRmdocWithMarkdown(data []byte, source string) ([]byte, error) {
	pdfData, pageCount, err := renderMarkdownPDF(source)
	if err != nil {
		return nil, err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	contentEntryIndex := -1
	var content map[string]interface{}
	for index, entry := range reader.File {
		if strings.HasSuffix(entry.Name, ".content") {
			contentEntryIndex = index
			file, openErr := entry.Open()
			if openErr != nil {
				return nil, openErr
			}
			contentBytes, readErr := io.ReadAll(file)
			file.Close()
			if readErr != nil {
				return nil, readErr
			}
			if err := json.Unmarshal(contentBytes, &content); err != nil {
				return nil, err
			}
			break
		}
	}
	if contentEntryIndex < 0 {
		return nil, errors.New("rmdoc: no content file found")
	}

	docID := strings.TrimSuffix(filepath.Base(reader.File[contentEntryIndex].Name), ".content")
	archiveVersion := exporter.VersionUnknown
	for _, entry := range reader.File {
		if !strings.HasSuffix(entry.Name, ".rm") {
			continue
		}
		file, openErr := entry.Open()
		if openErr != nil {
			return nil, openErr
		}
		header := make([]byte, exporter.HeaderSizeV6)
		_, readErr := io.ReadFull(file, header)
		file.Close()
		if readErr != nil {
			return nil, fmt.Errorf("rmdoc: cannot read page header: %w", readErr)
		}
		archiveVersion, readErr = exporter.DetectRmVersionFromBytes(header)
		if readErr != nil {
			return nil, fmt.Errorf("rmdoc: invalid .rm page header in %s: %w", entry.Name, readErr)
		}
		break
	}
	pageIDs := make([]string, 0, pageCount)
	if existing, ok := content["pages"].([]interface{}); ok {
		for _, page := range existing {
			if pageID, ok := page.(string); ok && pageID != "" && len(pageIDs) < pageCount {
				pageIDs = append(pageIDs, pageID)
			}
		}
	}
	existingPageCount := len(pageIDs)
	if archiveVersion == exporter.VersionV6 && pageCount > existingPageCount {
		return nil, errors.New("rmdoc: cannot add Markdown pages to a v6 document without a v6 page encoder")
	}
	for len(pageIDs) < pageCount {
		pageIDs = append(pageIDs, uuid.NewString())
	}
	content["fileType"] = "pdf"
	content["pageCount"] = pageCount
	content["pages"] = pageIDs
	contentBytes, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}

	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for index, entry := range reader.File {
		if index == contentEntryIndex || strings.HasSuffix(entry.Name, ".pdf") {
			continue
		}
		file, err := entry.Open()
		if err != nil {
			return nil, err
		}
		fileData, readErr := io.ReadAll(file)
		file.Close()
		if readErr != nil {
			return nil, readErr
		}
		if strings.HasSuffix(entry.Name, ".pagedata") && pageCount > existingPageCount {
			fileData = append(fileData, []byte(strings.Repeat("Blank\n", pageCount-existingPageCount))...)
		}
		if err := writeZipFile(writer, entry.Name, fileData); err != nil {
			return nil, err
		}
	}
	if err := writeZipFile(writer, reader.File[contentEntryIndex].Name, contentBytes); err != nil {
		return nil, err
	}
	if err := writeZipFile(writer, docID+".pdf", pdfData); err != nil {
		return nil, err
	}
	for index := existingPageCount; index < pageCount; index++ {
		pageID := pageIDs[index]
		if err := writeZipFile(writer, pageID+".rm", emptyRmPage()); err != nil {
			return nil, err
		}
		metadata, _ := json.Marshal(map[string]interface{}{"layers": []map[string]string{{"name": "Layer 1"}}})
		if err := writeZipFile(writer, pageID+"-metadata.json", metadata); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func writeZipFile(writer *zip.Writer, filename string, data []byte) error {
	entry, err := writer.Create(filename)
	if err != nil {
		return err
	}
	_, err = entry.Write(data)
	return err
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
	uid := userID(c)
	docID := common.ParamS(docIDParam, c)
	archive, err := app.getBackend(c).Export(uid, docID, "rmdoc", 0)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Markdown tablet sync requires sync 1.5"})
		return
	}
	archiveData, err := io.ReadAll(archive)
	archive.Close()
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	updatedArchive, err := updateRmdocWithMarkdown(archiveData, update.Source)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := app.getBackend(c).UpdateRmDoc(uid, docID, bytes.NewReader(updatedArchive)); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
	path := app.markdownPath(uid, docID)
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
