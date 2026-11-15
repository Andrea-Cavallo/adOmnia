// Stands in for the original virtual file-system package: the engine only needs the element
// index type and the code editor facade, both backed by the adOmnia workspace.
export type { JsxElementMetadata } from '../../vendor/packages/file-system/src/index-cache'
export type { WorkspaceCodeEditor as CodeFileSystem } from '../file-system'
