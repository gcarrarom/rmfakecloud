package ui

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/ddvk/rmfakecloud/internal/archive"
	"github.com/stretchr/testify/require"
)

func TestNewMarkdownArchiveIsReadable(t *testing.T) {
	reader, docID, err := newMarkdownArchive("Meeting notes")
	require.NoError(t, err)
	require.NotEmpty(t, docID)

	data, err := io.ReadAll(reader)
	require.NoError(t, err)

	document := &archive.Zip{}
	require.NoError(t, document.Read(bytes.NewReader(data), int64(len(data))))
	require.Equal(t, docID, document.UUID)
	require.Len(t, document.Pages, 1)
}

func TestUpdateRmdocWithMarkdownAddsPdfPayloadAndPages(t *testing.T) {
	reader, _, err := newMarkdownArchive("Meeting notes")
	require.NoError(t, err)
	original, err := io.ReadAll(reader)
	require.NoError(t, err)

	updated, err := updateRmdocWithMarkdown(original, "# Notes\n\nFirst page\n---\nSecond page")
	require.NoError(t, err)

	document := &archive.Zip{}
	require.NoError(t, document.Read(bytes.NewReader(updated), int64(len(updated))))
	require.Len(t, document.Pages, 2)
	require.NotEmpty(t, document.Payload)
}

func TestUpdateRmdocWithMarkdownRejectsV6PageExpansion(t *testing.T) {
	reader, _, err := newMarkdownArchive("v6 notes")
	require.NoError(t, err)
	original, err := io.ReadAll(reader)
	require.NoError(t, err)

	input, err := zip.NewReader(bytes.NewReader(original), int64(len(original)))
	require.NoError(t, err)
	var v6Archive bytes.Buffer
	writer := zip.NewWriter(&v6Archive)
	for _, entry := range input.File {
		file, openErr := entry.Open()
		require.NoError(t, openErr)
		data, readErr := io.ReadAll(file)
		file.Close()
		require.NoError(t, readErr)
		if strings.HasSuffix(entry.Name, ".rm") {
			data = make([]byte, 51)
			copy(data, "reMarkable .lines file, version=6          ")
		}
		zipEntry, createErr := writer.Create(entry.Name)
		require.NoError(t, createErr)
		_, writeErr := zipEntry.Write(data)
		require.NoError(t, writeErr)
	}
	require.NoError(t, writer.Close())

	_, err = updateRmdocWithMarkdown(v6Archive.Bytes(), "Page one\n---\nPage two")
	require.ErrorContains(t, err, "v6 document")
}
