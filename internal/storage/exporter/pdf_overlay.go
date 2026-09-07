package exporter

import (
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
	wm, err := api.PDFMultiWatermarkForReadSeeker(annotations, 1, 1, "scale:1", true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to create annotation overlay: %w", err)
	}
	if err := api.AddWatermarks(background, output, nil, wm, model.NewDefaultConfiguration()); err != nil {
		return fmt.Errorf("failed to overlay annotations: %w", err)
	}
	return nil
}
