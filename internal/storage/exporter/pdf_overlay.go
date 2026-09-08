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
	pageDims, err := api.PageDims(bytes.NewReader(backgroundBytes), conf)
	if err != nil {
		return fmt.Errorf("failed to read PDF page dimensions: %w", err)
	}
	if len(pageDims) == 0 || pageDims[0].Width <= 0 {
		return fmt.Errorf("PDF background has no usable page dimensions")
	}
	wm, err := api.PDFMultiWatermarkForReadSeeker(annotations, 1, 1, "scale:1 abs, rot:0", true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to create annotation overlay: %w", err)
	}
	// rmc-go exports in reMarkable screen points. Scale by the destination
	// width so documents such as Letter pages do not fit by height and drift
	// toward the bottom-right edge.
	wm.Scale = pageDims[0].Width / (1404.0 * 72.0 / 226.0)
	wm.ScaleAbs = true
	if err := api.AddWatermarks(bytes.NewReader(backgroundBytes), output, nil, wm, conf); err != nil {
		return fmt.Errorf("failed to overlay annotations: %w", err)
	}
	return nil
}

func normalizePDFForPDFCPU(pdf []byte) []byte {
	return bytes.ReplaceAll(pdf, []byte("/C2PA_Manifest"), []byte("/Unspecified   "))
}
