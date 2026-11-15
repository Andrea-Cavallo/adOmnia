// Modified for adOmnia: composes only the transplanted managers. Branches, frames, canvas and
// theme come from adOmnia adapters; chat, fonts, images, pages, screenshots, sandbox and
// telemetry of the original engine are not part of the transplant.
import { makeAutoObservable } from 'mobx';

import { CanvasManager, ThemeManager, type Analytics } from '@/features/visual-editor/adapters/host';
import type { WorkspaceCodeEditor } from '@/features/visual-editor/adapters/file-system';
import { ActionManager } from './action';
import { AstManager } from './ast';
import { BranchManager } from './branch/manager';
import { CodeManager } from './code';
import { CopyManager } from './copy';
import { ElementsManager } from './element';
import { FrameEventManager } from './frame-events';
import { FramesManager } from './frames';
import { GroupManager } from './group';
import { IdeManager } from './ide';
import { InsertManager } from './insert';
import { MoveManager } from './move';
import { OverlayManager } from './overlay';
import { SnapManager } from './snap';
import { StateManager } from './state';
import { StyleManager } from './style';
import { TextEditingManager } from './text';

export class EditorEngine {
    readonly projectId: string;
    readonly posthog: Analytics;
    readonly branches: BranchManager;

    get history() {
        return this.branches.activeHistory;
    }

    get fileSystem(): WorkspaceCodeEditor {
        return this.branches.activeCodeEditor;
    }

    readonly state: StateManager = new StateManager();
    readonly canvas: CanvasManager = new CanvasManager();
    readonly text: TextEditingManager = new TextEditingManager(this);
    readonly elements: ElementsManager = new ElementsManager(this);
    readonly overlay: OverlayManager = new OverlayManager(this);
    readonly insert: InsertManager = new InsertManager(this);
    readonly move: MoveManager = new MoveManager(this);
    readonly copy: CopyManager = new CopyManager(this);
    readonly group: GroupManager = new GroupManager(this);
    readonly ast: AstManager = new AstManager(this);
    readonly action: ActionManager = new ActionManager(this);
    readonly style: StyleManager = new StyleManager(this);
    readonly code: CodeManager = new CodeManager(this);
    readonly theme: ThemeManager = new ThemeManager();
    readonly frames: FramesManager = new FramesManager();
    readonly frameEvent: FrameEventManager = new FrameEventManager(this);
    readonly snap: SnapManager = new SnapManager(this);
    readonly ide: IdeManager = new IdeManager(this);

    constructor(projectId: string, posthog: Analytics, codeEditor: WorkspaceCodeEditor) {
        this.projectId = projectId;
        this.posthog = posthog;
        this.branches = new BranchManager(this, projectId, codeEditor);
        makeAutoObservable(this);
    }

    async init() {
        this.overlay.init();
        this.frameEvent.init();
        this.style.init();
    }

    clear() {
        this.elements.clear();
        this.frames.clear();
        this.action.clear();
        this.overlay.clear();
        this.ast.clear();
        this.text.clean();
        this.insert.clear();
        this.move.clear();
        this.style.clear();
        this.copy.clear();
        this.group.clear();
        this.canvas.clear();
        this.theme.clear();
        this.code.clear();
        this.branches.clear();
        this.frameEvent.clear();
        this.snap.hideSnapLines();
    }

    clearUI() {
        this.overlay.clearUI();
        this.elements.clear();
        this.frames.deselectAll();
        this.snap.hideSnapLines();
    }

    async refreshLayers() {
        for (const frame of this.frames.getAll()) {
            if (!frame.view) {
                console.error('No frame view found');
                continue;
            }
            await frame.view.processDom();
        }
    }
}
