export function extractTextContent(el: HTMLElement): string {
    const read = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent ?? '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }
        if ((node as Element).localName === 'br') {
            return '\n';
        }
        return Array.from(node.childNodes, read).join('');
    };
    return read(el);
}
