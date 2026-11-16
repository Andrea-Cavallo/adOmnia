// adOmnia: replaces the original provider, which built the engine from a cloud project and its
// branches. The engine of a Code Studio session is created by adapters/design-session.ts.
import { createContext, useContext } from 'react';
import type { EditorEngine } from './engine';

export const EditorEngineContext = createContext<EditorEngine | null>(null);

export const useEditorEngine = () => {
    const ctx = useContext(EditorEngineContext);
    if (!ctx) throw new Error('useEditorEngine must be inside EditorEngineContext');
    return ctx;
};
