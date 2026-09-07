package exporter

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOverlayPDFNormalizesC2PAAssociatedFileRelationship(t *testing.T) {
	background := []byte("/AFRelationship /C2PA_Manifest")

	background = normalizePDFForPDFCPU(background)

	require.Equal(t, "/AFRelationship /Unspecified   ", string(background))
}
