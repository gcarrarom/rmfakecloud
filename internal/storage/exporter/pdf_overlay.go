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
	annotationBytes, err := io.ReadAll(annotations)
	if err != nil {
		return fmt.Errorf("failed to read annotation PDF: %w", err)
	}
	annotationBytes, err = transformAnnotationPDF(annotationBytes, backgroundBytes, conf)
	if err != nil {
		return fmt.Errorf("failed to transform annotation PDF: %w", err)
	}
	wm, err := api.PDFMultiWatermarkForReadSeeker(bytes.NewReader(annotationBytes), 1, 1, "pos:bl, scale:1 abs, rot:0", true, false, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to create annotation overlay: %w", err)
	}
	if err := api.AddWatermarks(bytes.NewReader(backgroundBytes), output, nil, wm, conf); err != nil {
		return fmt.Errorf("failed to overlay annotations: %w", err)
	}
	return nil
}

var pdfImageTransform = regexp.MustCompile(`(?m)([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+cm\s*/[^\s]+\s+Do`)

func transformAnnotationPDF(annotation, background []byte, conf *model.Configuration) ([]byte, error) {
	annotationDims, err := api.PageDims(bytes.NewReader(annotation), conf)
	if err != nil {
		return nil, err
	}
	backgroundDims, err := api.PageDims(bytes.NewReader(background), conf)
	if err != nil {
		return nil, err
	}
	if len(annotationDims) == 0 || annotationDims[0].Width <= 0 || annotationDims[0].Height <= 0 || len(backgroundDims) == 0 {
		return nil, fmt.Errorf("PDF overlay has no usable page dimensions")
	}
	backgroundCtx, err := api.ReadContext(bytes.NewReader(background), conf)
	if err != nil {
		return nil, err
	}
	backgroundPage, _, _, err := backgroundCtx.XRefTable.PageDict(1, false)
	if err != nil {
		return nil, err
	}
	content, err := backgroundCtx.XRefTable.PageContent(backgroundPage, 1)
	if err != nil {
		return nil, err
	}
	m := pdfImageTransform.FindSubmatch(content)
	if len(m) != 7 {
		return nil, fmt.Errorf("background PDF has no image placement transform")
	}
	values := make([]float64, 6)
	for i := range values {
		values[i], err = strconv.ParseFloat(string(m[i+1]), 64)
		if err != nil {
			return nil, err
		}
	}

	annotationCtx, err := api.ReadContext(bytes.NewReader(annotation), conf)
	if err != nil {
		return nil, err
	}
	annotationPage, annotationPageRef, _, err := annotationCtx.XRefTable.PageDict(1, false)
	if err != nil {
		return nil, err
	}
	annotationContent, err := annotationCtx.XRefTable.PageContent(annotationPage, 1)
	if err != nil {
		return nil, err
	}
	transformed := fmt.Sprintf("q %g 0 0 %g %g %g cm\n%s\nQ\n",
		values[0]/annotationDims[0].Width,
		values[3]/annotationDims[0].Height,
		values[4], values[5], annotationContent)
	stream, err := annotationCtx.XRefTable.NewStreamDictForBuf([]byte(transformed))
	if err != nil {
		return nil, err
	}
	streamObj, err := annotationCtx.XRefTable.InsertObject(*stream)
	if err != nil {
		return nil, err
	}
	annotationPage["Contents"] = *types.NewIndirectRef(streamObj, 0)
	annotationPage["MediaBox"] = types.Array{types.Integer(0), types.Integer(0), types.Float(backgroundDims[0].Width), types.Float(backgroundDims[0].Height)}
	annotationCtx.XRefTable.Table[annotationPageRef.ObjectNumber.Value()].Object = annotationPage

	var output bytes.Buffer
	if err := api.Write(annotationCtx, &output, conf); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func normalizePDFForPDFCPU(pdf []byte) []byte {
	return bytes.ReplaceAll(pdf, []byte("/C2PA_Manifest"), []byte("/Unspecified   "))
}
