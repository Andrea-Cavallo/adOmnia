import { useEditorEngine } from '@ve-client/components/store/editor';
import type { ClickRectState } from '@ve-client/components/store/editor/overlay/state';
import { EditorAttributes } from '@onlook/constants';
import { EditorMode } from '@onlook/models';
import { cn } from '@onlook/ui/utils';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { MeasurementOverlay } from './elements/measurement';
import { ClickRect } from './elements/rect/click';
import { HoverRect } from './elements/rect/hover';
import { InsertRect } from './elements/rect/insert';
import { SnapGuidelines } from './elements/snap-guidelines';

export const Overlay = observer(() => {
    const editorEngine = useEditorEngine();
    const overlayState = editorEngine.overlay.state;
    const isSingleSelection = editorEngine.elements.selected.length === 1;
    const isTextEditing = editorEngine.text.isEditing;

    const clickRectsElements = useMemo(
        () =>
            overlayState.clickRects.map((rectState: ClickRectState) => (
                <ClickRect
                    key={rectState.id}
                    width={rectState.width}
                    height={rectState.height}
                    top={rectState.top}
                    left={rectState.left}
                    isComponent={rectState.isComponent}
                    styles={rectState.styles}
                    shouldShowResizeHandles={isSingleSelection}
                />
            )),
        [overlayState.clickRects, isSingleSelection],
    );

    return (
        <div
            id={EditorAttributes.OVERLAY_CONTAINER_ID}
            className={cn(
                'absolute top-0 left-0 h-0 w-0 pointer-events-none',
                editorEngine.state.shouldHideOverlay ? 'opacity-0' : 'opacity-100 transition-opacity duration-150',
                editorEngine.state.editorMode === EditorMode.PREVIEW && 'hidden',
            )}
        >
            {!isTextEditing && overlayState.hoverRect && (
                <HoverRect
                    rect={overlayState.hoverRect.rect}
                    isComponent={overlayState.hoverRect.isComponent}
                />
            )}
            {overlayState.insertRect && (
                <InsertRect rect={overlayState.insertRect} />
            )}
            {!isTextEditing && clickRectsElements}
            {overlayState.measurement && (
                <MeasurementOverlay
                    fromRect={overlayState.measurement.fromRect}
                    toRect={overlayState.measurement.toRect}
                />
            )}
            <SnapGuidelines />
        </div>
    );
});
