package exporter

import (
	"bytes"
	"fmt"
	"io"
	"math"

	rmcexport "github.com/joagonca/rmc-go/export"
	rmcparser "github.com/joagonca/rmc-go/parser"
)

// ExportV6ToPdfNative converts v6 .rm file to PDF using rmc-go library (in-process)
// This uses the Cairo renderer for native PDF generation
func ExportV6ToPdfNative(rmData []byte, output io.Writer) error {
	tree, err := parseAndNormalizeV6SceneTree(rmData)
	if err != nil {
		return fmt.Errorf("failed to parse v6 rm file: %w", err)
	}

	if err := rmcexport.ExportToPDF(tree, output, false); err != nil {
		return fmt.Errorf("failed to export v6 rm to PDF: %w", err)
	}

	return nil
}

// ExportV6ToSvgNative converts v6 .rm file to SVG using rmc-go library
func ExportV6ToSvgNative(rmData []byte, output io.Writer) error {
	tree, err := parseAndNormalizeV6SceneTree(rmData)
	if err != nil {
		return fmt.Errorf("failed to parse v6 rm file: %w", err)
	}

	if err := rmcexport.ExportToSVG(tree, output); err != nil {
		return fmt.Errorf("failed to export v6 rm to SVG: %w", err)
	}

	return nil
}

// ExportV6MultiPageToPdfNative converts multiple v6 .rm pages to a single PDF
func ExportV6MultiPageToPdfNative(pages [][]byte, output io.Writer) error {
	if len(pages) == 0 {
		return fmt.Errorf("no pages provided")
	}

	trees := make([]*rmcparser.SceneTree, 0, len(pages))
	for _, page := range pages {
		tree, err := parseAndNormalizeV6SceneTree(page)
		if err != nil {
			return fmt.Errorf("failed to parse v6 page: %w", err)
		}
		trees = append(trees, tree)
	}

	buf := &bytes.Buffer{}
	if err := rmcexport.ExportToMultipagePDF(trees, buf, false); err != nil {
		return fmt.Errorf("failed to export multiple v6 pages to PDF: %w", err)
	}

	_, err := io.Copy(output, bytes.NewReader(buf.Bytes()))
	return err
}

func parseAndNormalizeV6SceneTree(rmData []byte) (*rmcparser.SceneTree, error) {
	tree, err := rmcparser.ReadSceneTree(bytes.NewReader(rmData))
	if err != nil {
		return nil, err
	}

	normalizeSceneTreeForExport(tree)
	return tree, nil
}

func normalizeSceneTreeForExport(tree *rmcparser.SceneTree) {
	if tree == nil || tree.Root == nil {
		return
	}

	var walk func(item any)
	walk = func(item any) {
		switch v := item.(type) {
		case *rmcparser.Group:
			if v.Children == nil {
				return
			}
			for _, child := range v.Children.Items {
				walk(child.Value)
			}
		case *rmcparser.Line:
			normalizeLineForExport(v)
		}
	}

	walk(tree.Root)
	if tree.RootText != nil && tree.RootText.Items != nil {
		for _, child := range tree.RootText.Items.Items {
			walk(child.Value)
		}
	}
}

func normalizeLineForExport(line *rmcparser.Line) {
	if line == nil {
		return
	}

	// rmc-go's calligraphy width formula can go near-zero or negative for valid v6
	// point streams, which creates visible gaps in exported handwriting.
	if line.Tool != rmcparser.PenCalligraphy {
		return
	}

	for i := range line.Points {
		minWidth := minimumCalligraphyPointWidth(line.Points[i])
		if line.Points[i].Width < minWidth {
			line.Points[i].Width = minWidth
		}
	}
}

func minimumCalligraphyPointWidth(point rmcparser.Point) uint16 {
	tilt := float64(point.Direction) * (math.Pi * 2) / 255.0
	minWidth := uint16(math.Ceil((0.3*tilt + 1.0) * 4.0))
	if minWidth < 12 {
		return 12
	}
	return minWidth
}
