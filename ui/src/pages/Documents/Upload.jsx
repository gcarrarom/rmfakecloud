import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import Spinner from "react-bootstrap/Spinner";
import { toast } from "react-toastify";
import apiservice from "../../services/api.service";

import styles from "./Documents.module.scss";

async function uploadFilesInBatches(files, uploadFolder, onProgress, batchSize = 100) {
  const totalFiles = files.length;
  let uploadedCount = 0;

  while (uploadedCount < totalFiles) {
    const batch = files.slice(uploadedCount, uploadedCount + batchSize);
    try {
      await apiservice.upload(uploadFolder, batch);
      uploadedCount += batch.length;
      onProgress(uploadedCount, totalFiles);
    } catch (e) {
      if (e.status === 409 && e.docId) {
        if (window.confirm(`${e.message}\n\nOverwrite?`)) {
          await apiservice.deleteDocument(e.docId);
          await apiservice.upload(uploadFolder, batch);
          uploadedCount += batch.length;
          onProgress(uploadedCount, totalFiles);
          continue;
        }
        return false;
      }
      console.error("Batch upload error:", e);
      throw e;
    }
  }
  return true;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StyledDropzone({filesUploaded, uploadFolder}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({done: 0, total: 0});
  const [rejectedFiles, setRejectedFiles] = useState([]);
  const [queuedFiles, setQueuedFiles] = useState([]);

  const onDrop = async (acceptedFiles, fileRejections = []) => {
    setRejectedFiles(fileRejections);
    if (!acceptedFiles.length) return;
    setQueuedFiles(acceptedFiles);
    try {
      setUploading(true);
      setProgress({done: 0, total: acceptedFiles.length});
      const completed = await uploadFilesInBatches(acceptedFiles, uploadFolder, (done, total) => setProgress({done, total}));
      if (!completed) return;
      filesUploaded();
      toast.success(`Uploaded ${acceptedFiles.length} ${acceptedFiles.length === 1 ? "file" : "files"}`);
    } catch (e) {
      toast.error("upload error" + e.toString());
    } finally {
      setUploading(false);
    }
  };

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
     accept: {
      "application/pdf":[], 
      "application/zip":[".zip", ".rmdoc"], 
      "application/epub+zip":[],
     },
    onDrop,
    disabled: uploading,
    maxSize: 1 * 1024 * 1024 * 1024, // 1GB
  });

  const className = useMemo(() => {
    return `${styles.upload}
            ${isDragActive ? styles.uploadActive : ""}
            ${isDragAccept ? styles.uploadAccept : ""}
            ${isDragReject ? styles.uploadReject : ""}`;
  }, [isDragActive, isDragReject, isDragAccept]);

  const statusText = uploading
    ? `Uploading ${progress.done} of ${progress.total} files…`
    : isDragReject
      ? "Some files aren’t supported"
      : isDragAccept
        ? "Drop to upload your files"
        : isDragActive
          ? "Drop files here"
          : "Drag files here or click to browse";

  return (
    <div {...getRootProps({className, "aria-label": "Upload files"})} aria-busy={uploading}>
      <input {...getInputProps()} />
      <div className={styles.uploadContent}>
        <div className={styles.uploadIcon} aria-hidden="true">{uploading ? <Spinner animation="border" size="sm" /> : "↑"}</div>
        <strong className={styles.uploadTitle}>{statusText}</strong>
        <span className={styles.uploadHint}>PDF, EPUB, ZIP, and reMarkable documents · up to 1 GB each</span>
        {uploading && <div className={styles.uploadProgress} role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
          <span style={{width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`}} />
        </div>}
        {uploading && <div className={styles.uploadQueue}>
          {queuedFiles.slice(0, 3).map(file => <div className={styles.uploadFile} key={`${file.name}-${file.size}`}><span>{file.name}</span><small>{formatSize(file.size)}</small></div>)}
          {queuedFiles.length > 3 && <small>and {queuedFiles.length - 3} more</small>}
        </div>}
        {!uploading && rejectedFiles.length > 0 && <div className={styles.uploadRejected} role="status">
          {rejectedFiles.map(({file, errors}) => <div key={`${file.name}-${file.size}`}><strong>{file.name}</strong> — {errors.map(error => error.code === "file-too-large" ? "File exceeds the 1 GB limit" : error.message).join(", ")}</div>)}
        </div>}
      </div>
    </div>
  );
}
