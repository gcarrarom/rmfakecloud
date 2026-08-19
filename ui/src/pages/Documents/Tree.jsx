import { Tree } from 'react-arborist';
import FileIcon from './FileIcon';

import styles from "./Documents.module.scss"

const DocumentTree = ({ selection, onSelect, treeRef, term, entries, height = 700 }) => {
  const onTreeSelect = (sel) => {
    if (sel.length > 0) {
      const node = sel[0];
      if (node.id === selection?.id) {
        if (!node.isLeaf) {
          node.toggle();
        }
        return;
      }
      onSelect(node);
    }
  }

  function Node({ node, style, dragHandle }) {
    return (
      <div
        style={style}
        ref={dragHandle}
        className={ node.isSelected ? styles.selected : ""}
      >
        <div className={itemClassName(node.data)}>
          <FileIcon file={node.data} />
          <span>{node.data.name}</span>
          {!node.data.isFolder && node.data.currentPage > 0 && (
            <small style={{ marginLeft: "auto", opacity: 0.7 }}>
              {node.data.pageCount > 0
                ? `${node.data.currentPage}/${node.data.pageCount}`
                : `p. ${node.data.currentPage}`}
            </small>
          )}
        </div>
      </div>
    );
  }

  function Cursor({ top, left }) {
    return <div style={{ top, left }}></div>;
  }

  const itemClassName = (item) => {
    if (item.isFolder) return "treeitem-nodename is-folder";
    return "treeitem-nodename";
  }

  if (entries && !entries.length) {
    return <div>No documents</div>;
  }
  return (
    <div>
      <Tree
        ref={(arg) => {
          if (treeRef.current == null) {
            if (arg) treeRef.current = arg
          }

          return treeRef.current
        }}
        data={entries}
        selection={selection?.id}
        rowHeight={36}
        indent={36}
        width="100%"
        height={height}
        renderCursor={Cursor}
        searchTerm={term}
        onSelect={onTreeSelect}
        className="documents-tree"
        disableEdit={true}
        disableDrag={true}
        disableDrop={true}
        openByDefault={false}
      >
        {Node}
      </Tree>
    </div>
  )
}
export default DocumentTree;
