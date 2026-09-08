package exporter

import (
	"bytes"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"github.com/stretchr/testify/require"
)

func TestOverlayPDFNormalizesC2PAAssociatedFileRelationship(t *testing.T) {
	background := []byte("/AFRelationship /C2PA_Manifest")

	background = normalizePDFForPDFCPU(background)

	require.Equal(t, "/AFRelationship /Unspecified   ", string(background))
}

func TestOverlayPDFUsesZeroRotation(t *testing.T) {
	wm, err := api.PDFMultiWatermarkForReadSeeker(bytes.NewReader(nil), 1, 1, "pos:bc, scale:1, rot:0", true, false, types.POINTS)

	require.NoError(t, err)
	require.Equal(t, float64(0), wm.Rotation)
	require.Equal(t, model.NoDiagonal, wm.Diagonal)
	require.Equal(t, types.BottomCenter, wm.Pos)
}
