import { BsChevronRight } from "react-icons/bs";
import { Button } from "react-bootstrap";
import styles from "../pages/Documents/Documents.module.scss";

export default function NameTag({ node, onSelect }) {
    if (node.parent) {
        return (<div className={styles.breadcrumbGroup}>
            <NameTag node={node.parent} onSelect={onSelect} />
            <span className={styles.breadcrumbSeparator}><BsChevronRight /></span>
            <Button className={styles.breadcrumbButton} variant="outline" onClick={() => onSelect(node)}>{node.data.name}</Button>
        </div>)
    }
    // No parent means this is the root - render it
    return <Button className={styles.breadcrumbButton} variant="outline" onClick={() => onSelect(node)}>{node.data.name}</Button>
}
