package exporter

import (
	"bytes"
	"fmt"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// OverlayPDF applies the annotation pages on top of the matching background
// pages without changing the background document's page count or content.
func OverlayPDF(background, annotations io.ReadSeeker, output io.Writer) error {
	if background == nil || annotations == nil || output == nil {
		return fmt.Errorf("missing PDF overlay stream")
	}
	// The service container may not have a writable home directory. pdfcpu's
	// default config loader exits the process when it cannot create one.
	api.DisableConfigDir()
	backgroundBytes, err := io.ReadAll(background)
	if err != nil {
		return fmt.Errorf("failed to read PDF background: %w", err)
	}
	// pdfcpu does not recognize the C2PA associated-file relationship even
	// though it is valid PDF metadata. Normalize that optional name so the
	// source document can still be stamped without changing its page content.
	backgroundBytes = normalizePDFForPDFCPU(backgroundBytes)
	conf := model.NewDefaultConfiguration()
	wm, err := api.PDFMultiWatermarkForReadSeeker(annotations, 1, 1, "pos:bc, scale:1, rot:0", true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to create annotation overlay: %w", err)
	}
	if err := api.AddWatermarks(bytes.NewReader(backgroundBytes), output, nil, wm, conf); err != nil {
		return fmt.Errorf("failed to overlay annotations: %w", err)
	}
	return nil
}

func normalizePDFForPDFCPU(pdf []byte) []byte {
	return bytes.ReplaceAll(pdf, []byte("/C2PA_Manifest"), []byte("/Unspecified   "))
}
