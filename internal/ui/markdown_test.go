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
