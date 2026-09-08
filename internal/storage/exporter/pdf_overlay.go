package exporter

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strconv"

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
	placement, err := inspectArtworkPlacement(backgroundBytes, conf)
	if err != nil {
		return fmt.Errorf("failed to inspect PDF artwork placement: %w", err)
	}
	wm, err := api.PDFMultiWatermarkForReadSeeker(annotations, 1, 1, "pos:bl, scale:1 abs, rot:0", true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to create annotation overlay: %w", err)
	}
	wm.Dx = placement.X
	wm.Dy = placement.Y
	// The reMarkable canvas origin used by the native renderer is offset from
	// the PDF artwork origin by this small amount after pdfcpu places the stamp.
	wm.Dx += annotationOffsetX
	wm.Dy += annotationOffsetY
	if err := api.AddWatermarks(bytes.NewReader(backgroundBytes), output, nil, wm, conf); err != nil {
		return fmt.Errorf("failed to overlay annotations: %w", err)
	}
	return nil
}

type artworkPlacement struct {
	X, Y          float64
	Width, Height float64
}

const (
	annotationOffsetX = 10
	annotationOffsetY = 28
)

var pdfImageTransform = regexp.MustCompile(`(?m)([-+]?\d*\.?\d+)\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+cm\s*/[^\s]+\s+Do`)

func inspectArtworkPlacement(background []byte, conf *model.Configuration) (artworkPlacement, error) {
	ctx, err := api.ReadAndValidate(bytes.NewReader(background), conf)
	if err != nil {
		return artworkPlacement{}, err
	}
	page, _, _, err := ctx.XRefTable.PageDict(1, false)
	if err != nil {
		return artworkPlacement{}, err
	}
	content, err := ctx.XRefTable.PageContent(page, 1)
	if err != nil {
		return artworkPlacement{}, err
	}
	match := pdfImageTransform.FindSubmatch(content)
	if len(match) != 5 {
		return artworkPlacement{}, fmt.Errorf("background PDF has no image placement transform")
	}
	values := make([]float64, 4)
	for i := range values {
		values[i], err = strconv.ParseFloat(string(match[i+1]), 64)
		if err != nil {
			return artworkPlacement{}, err
		}
	}
	return artworkPlacement{Width: values[0], Height: values[1], X: values[2], Y: values[3]}, nil
}

func normalizePDFForPDFCPU(pdf []byte) []byte {
	return bytes.ReplaceAll(pdf, []byte("/C2PA_Manifest"), []byte("/Unspecified   "))
}
