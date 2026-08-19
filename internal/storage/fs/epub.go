package fs

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/ddvk/rmfakecloud/internal/storage"
)

func epubResource(payload []byte, resourcePath string) (io.ReadCloser, string, error) {
	resourcePath = path.Clean(strings.TrimPrefix(resourcePath, "/"))
	if resourcePath == "." || strings.HasPrefix(resourcePath, "../") {
		return nil, "", fmt.Errorf("invalid EPUB resource path")
	}
	archive, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, "", err
	}
	for _, entry := range archive.File {
		if path.Clean(entry.Name) != resourcePath {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			return nil, "", err
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			return nil, "", err
		}
		return io.NopCloser(bytes.NewReader(data)), epubContentType(resourcePath), nil
	}
	return nil, "", fmt.Errorf("EPUB resource not found: %s", resourcePath)
}

func epubContentType(resourcePath string) string {
	switch strings.ToLower(path.Ext(resourcePath)) {
	case ".xhtml", ".html", ".htm":
		return "application/xhtml+xml"
	case ".css":
		return "text/css"
	case ".svg":
		return "image/svg+xml"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	default:
		return "application/octet-stream"
	}
}

func (fs *FileSystemStorage) ExportLegacyEpubResource(uid, docID, resourcePath string) (io.ReadCloser, string, error) {
	payload, err := fs.ExportDocument(uid, docID, "epub", storage.ExportWithAnnotations)
	if err != nil {
		return nil, "", err
	}
	data, err := io.ReadAll(payload)
	payload.Close()
	if err != nil {
		return nil, "", err
	}
	return epubResource(data, resourcePath)
}
