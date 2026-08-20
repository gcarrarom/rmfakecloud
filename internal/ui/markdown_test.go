package ui

import (
	"bytes"
	"io"
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
