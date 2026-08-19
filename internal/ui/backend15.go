package ui

import (
	"io"

	"github.com/ddvk/rmfakecloud/internal/app/hub"
	"github.com/ddvk/rmfakecloud/internal/storage"
	"github.com/ddvk/rmfakecloud/internal/ui/viewmodel"
	"github.com/google/uuid"
)

type backend15 struct {
	blobHandler blobHandler
	h           *hub.Hub
}

func (b *backend15) GetDocumentTree(uid string) (tree *viewmodel.DocumentTree, err error) {
	hashTree, err := b.blobHandler.GetCachedTree(uid)
	if err != nil {
		return nil, err
	}

	return viewmodel.DocTreeFromHashTree(hashTree), nil
}
func (b *backend15) Export(uid, docid, exporttype string, opt storage.ExportOption) (r io.ReadCloser, err error) {
	if exporttype == "rmdoc" {
		return b.blobHandler.ExportRmDoc(uid, docid)
	}
	if exporttype == "epub" {
		return b.blobHandler.ExportPayload(uid, docid)
	}
	r, err = b.blobHandler.Export(uid, docid)
	return
}

func (b *backend15) GetReadingProgress(uid, docID string) (*viewmodel.ReadingProgress, error) {
	tree, err := b.blobHandler.GetCachedTree(uid)
	if err != nil {
		return nil, err
	}
	doc, err := tree.FindDoc(docID)
	if err != nil {
		return nil, err
	}
	currentPage := 0
	if doc.WebReadingPage > 0 {
		currentPage = doc.WebReadingPage
	} else if doc.LastOpened != "" {
		currentPage = doc.LastOpenedPage + 1
	}
	return &viewmodel.ReadingProgress{CurrentPage: currentPage, PageCount: viewmodel.PageCountForUI(doc.PageCount, doc.WebPageCount)}, nil
}

func (b *backend15) ExportEpubResource(uid, docID, resourcePath string) (io.ReadCloser, string, error) {
	return b.blobHandler.ExportEpubResource(uid, docID, resourcePath)
}

func (b *backend15) UpdateReadingProgress(uid, docID string, page, pageCount int) error {
	if err := b.blobHandler.UpdateBlobDocumentReadingPosition(uid, docID, page-1, pageCount); err != nil {
		return err
	}
	b.Sync(uid)
	return nil
}

func (b *backend15) CreateDocument(uid, filename, parent string, stream io.Reader) (doc *storage.Document, err error) {
	doc, err = b.blobHandler.CreateBlobDocument(uid, filename, parent, stream)
	return
}

func (b *backend15) UpdateDocument(uid, docID, name, parent string) (err error) {
	return b.blobHandler.UpdateBlobDocument(uid, docID, name, parent)
}
func (b *backend15) CreateFolder(uid, name, parent string) (doc *storage.Document, err error) {
	return b.blobHandler.CreateBlobFolder(uid, name, parent)
}

func (b *backend15) DeleteDocument(uid, docID string) (err error) {
	return b.blobHandler.DeleteBlobDocument(uid, docID)
}

func (b *backend15) UpdateRmDoc(uid, docID string, stream io.Reader) (err error) {
	return b.blobHandler.UpdateBlobDocumentFromRmDoc(uid, docID, stream)
}

func (b *backend15) Sync(uid string) {
	b.h.NotifySync(uid, uuid.NewString())
}
