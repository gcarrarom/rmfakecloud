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
	annotationBytes, err := io.ReadAll(annotations)
	if err != nil {
		return fmt.Errorf("failed to read annotation PDF: %w", err)
	}
	annotationBytes, err = transformAnnotationPDF(annotationBytes, placement, conf)
	if err != nil {
		return fmt.Errorf("failed to transform annotation PDF: %w", err)
	}
	wm, err := api.PDFMultiWatermarkForReadSeeker(bytes.NewReader(annotationBytes), 1, 1, "pos:bl, scale:1 abs, rot:0", true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to create annotation overlay: %w", err)
	}
	wm.Dx = placement.X
	wm.Dy = placement.Y
	if err := api.AddWatermarks(bytes.NewReader(backgroundBytes), output, nil, wm, conf); err != nil {
		return fmt.Errorf("failed to overlay annotations: %w", err)
	}
	return nil
}

type artworkPlacement struct {
	X, Y          float64
	Width, Height float64
}

var pdfImageTransform = regexp.MustCompile(`(?m)([-+]?\d*\.?\d+)\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+cm\s*/[^\s]+\s+Do`)

func transformAnnotationPDF(annotation []byte, placement artworkPlacement, conf *model.Configuration) ([]byte, error) {
	dims, err := api.PageDims(bytes.NewReader(annotation), conf)
	if err != nil {
		return nil, err
	}
	if len(dims) == 0 || dims[0].Width <= 0 || dims[0].Height <= 0 {
		return nil, fmt.Errorf("annotation PDF has no usable page dimensions")
	}
	ctx, err := api.ReadAndValidate(bytes.NewReader(annotation), conf)
	if err != nil {
		return nil, err
	}
	page, _, _, err := ctx.XRefTable.PageDict(1, false)
	if err != nil {
		return nil, err
	}
	content, err := ctx.XRefTable.PageContent(page, 1)
	if err != nil {
		return nil, err
	}
	transformed := fmt.Sprintf("q %g 0 0 %g 0 0 cm\n%s\nQ\n",
		placement.Width/dims[0].Width,
		placement.Height/dims[0].Height,
		content)
	stream, err := ctx.XRefTable.NewStreamDictForBuf([]byte(transformed))
	if err != nil {
		return nil, err
	}
	if err := stream.Encode(); err != nil {
		return nil, err
	}
	streamRef, err := ctx.XRefTable.IndRefForNewObject(*stream)
	if err != nil {
		return nil, err
	}
	page["Contents"] = *streamRef
	page.Update("MediaBox", types.Array{
		types.Integer(0), types.Integer(0),
		types.Float(placement.Width), types.Float(placement.Height),
	})

	var output bytes.Buffer
	if err := api.Write(ctx, &output, conf); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

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
