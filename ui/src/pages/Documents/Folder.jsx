import { useState } from "react";
import Navbar from 'react-bootstrap/Navbar';
import { Button, InputGroup, Form } from "react-bootstrap";
import Modal from 'react-bootstrap/Modal';
import { BsFillGridFill } from "react-icons/bs";
import { FaList } from "react-icons/fa";
import { ToggleButton, ToggleButtonGroup } from "react-bootstrap";

import apiservice from "../../services/api.service"
import styles from "./Documents.module.scss"

import Upload from "./Upload"
import FileList from "./FileList";
import NameTag from "../../components/NameTag"
import { toast } from "react-toastify";

export default function Folder({ selection, onSelect, onUpdate, folders = [] }) {
  const [listStyle, setListStyle] = useState("list");
  const [folderName, setFolderName] = useState("");
  const [showCreateFileModal, setShowCreateFolder] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showRename, setShowRename] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [newName, setNewName] = useState("");
  const [destination, setDestination] = useState("root");
  const [contextItem, setContextItem] = useState(null);

  const folder = selection

  const onCreateFolderClick = async () => {
    const res = await apiservice.createFolder({ name: folderName, parentId: selection.id });
    console.log("created folder with id", res.ID);
    setFolderName("");
    setShowCreateFolder(false);

    onUpdate();
  }

  const onDeleteClick = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete the selected item(s)?`)) return;
    for (const id of selectedIds) {
      const file = folder.children.find(f => f.id === id);
      const name = file?.data?.name || id;
      try {
        await apiservice.deleteDocument(id);
        toast.success(`Deleted ${name}`);
      } catch (e) {
        toast.error(`Failed to delete ${name}`);
      }
    }
    setSelectedIds([]);
    onUpdate();
  }

  const fileUploaded = () => {
    onUpdate();
  }

  const handleSelectItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedItems = selectedIds.map((id) => folder.children.find((item) => item.id === id)).filter(Boolean);
  const renameTarget = selectedItems.length === 1
    ? selectedItems[0]
    : selection.id !== "root" && selection.id !== "trash" ? selection : null;
  const descendants = new Set();
  const collectDescendants = (item) => {
    (item.children || []).forEach((child) => {
      descendants.add(child.id);
      collectDescendants(child);
    });
  };
  selectedItems.filter((item) => item.data?.isFolder).forEach(collectDescendants);
  const moveTargets = folders.filter((item) =>
    item.id !== "trash" && !selectedIds.includes(item.id) && !descendants.has(item.id)
  );

  const rename = async () => {
    if (!renameTarget || !newName.trim()) return;
    try {
      await apiservice.updateDocument(renameTarget.id, newName.trim(), renameTarget.data.parent || (renameTarget === selection ? selection.parent?.id || "root" : selection.id));
      toast.success(`Renamed ${renameTarget.data.name}`);
      setShowRename(false);
      onUpdate();
    } catch (e) {
      toast.error(`Failed to rename: ${e.message}`);
    }
  };

  const move = async () => {
    if (!selectedItems.length) return;
    try {
      for (const item of selectedItems) {
        await apiservice.updateDocument(item.id, item.data.name, destination);
      }
      toast.success(`Moved ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`);
      setSelectedIds([]);
      setShowMove(false);
      onUpdate();
    } catch (e) {
      toast.error(`Failed to move: ${e.message}`);
    }
  };

  const openContextMenu = (event, item) => {
    setContextItem(item);
    setSelectedIds([item.id]);
    const touch = event?.touches?.[0];
    if (event?.clientX != null || touch) {
      setContextMenuPosition({ x: event.clientX ?? touch.clientX, y: event.clientY ?? touch.clientY });
    }
  };

  const [contextMenuPosition, setContextMenuPosition] = useState(null);

  // this should generally not happen, but just in case
  if (!folder) {
    return "nothing selected"
  }
  return (
    <>
      <Navbar className={styles.breadcrumbBar}>
        { folder && (<div><NameTag node={folder} onSelect={onSelect} /></div>) }
      </Navbar>

      <Navbar className={`${styles.filedivider} ${styles.toolbar}`}>
        <Button size="sm" variant="outline" onClick={() => setShowCreateFolder(true)}>Create Folder</Button>
        <div className={styles.toolbarRight}>
           <Button size="sm" onClick={() => { setNewName(renameTarget?.data?.name || ""); setShowRename(true); }} disabled={!renameTarget}>Rename</Button>
           <Button size="sm" onClick={() => setShowMove(true)} disabled={!selectedItems.length}>Move</Button>
           <Button size="sm" onClick={onDeleteClick} disabled={selectedIds.length === 0}>Delete</Button>
          <ToggleButtonGroup value={listStyle} onChange={(v) => setListStyle(v)} name="abc">
            <ToggleButton id="grid" name="grid" size="sm" value="grid" variant="outline">
              <BsFillGridFill />
            </ToggleButton>
            <ToggleButton id="list" name="list" size="sm" value="list" variant="outline">
              <FaList />
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
      </Navbar>

      <Upload filesUploaded={fileUploaded} uploadFolder={selection.id}></Upload>
      <FileList
        listStyle={listStyle}
        files={folder.children}
        onSelect={onSelect}
        selectedIds={selectedIds}
        onSelectItem={handleSelectItem}
        onItemContextMenu={openContextMenu}
      />

      <Modal show={showCreateFileModal} onHide={() => setShowCreateFolder(false)}>
        <Modal.Header closeButton>
          Create a new folder
        </Modal.Header>

        <Modal.Body>
          <InputGroup className="mb-3">
            <Form.Control autoFocus={true} type="text" value={folderName} onChange={(e) => setFolderName(e.currentTarget.value)} />

            <Button variant="primary" onClick={onCreateFolderClick}>Create</Button>

          </InputGroup>
        </Modal.Body>
      </Modal>
      <Modal show={showRename} onHide={() => setShowRename(false)}>
        <Modal.Header closeButton><Modal.Title>Rename</Modal.Title></Modal.Header>
        <Modal.Body><Form.Control autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} /></Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowRename(false)}>Cancel</Button><Button onClick={rename} disabled={!newName.trim()}>Rename</Button></Modal.Footer>
      </Modal>
      <Modal show={showMove} onHide={() => setShowMove(false)}>
        <Modal.Header closeButton><Modal.Title>Move</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Label htmlFor="move-destination">Destination folder</Form.Label>
          <Form.Select id="move-destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="root">My Files</option>
            {moveTargets.filter((item) => item.id !== "root").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Form.Select>
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowMove(false)}>Cancel</Button><Button onClick={move}>Move</Button></Modal.Footer>
      </Modal>
      {contextMenuPosition && contextItem && (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          onMouseLeave={() => setContextMenuPosition(null)}
        >
          <Button variant="link" onClick={() => { setNewName(contextItem.data.name); setShowRename(true); setContextMenuPosition(null); }}>Rename</Button>
          <Button variant="link" onClick={() => { setShowMove(true); setContextMenuPosition(null); }}>Move</Button>
          <Button variant="link" onClick={() => { setContextMenuPosition(null); onDeleteClick(); }}>Delete</Button>
        </div>
      )}
    </>
  );
}
