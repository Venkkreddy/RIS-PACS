import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Toolbox } from '@ohif/extension-default';
import PanelSegmentation from './panels/PanelSegmentation';
import ActiveViewportWindowLevel from './components/ActiveViewportWindowLevel';
import PanelMeasurement from './panels/PanelMeasurement';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import i18n from '@ohif/i18n';

const getPanelModule = ({ commandsManager, servicesManager, extensionManager }: withAppTypes) => {
  const { toolbarService } = servicesManager.services;

  const toolSectionMap = {
    [SegmentationRepresentations.Labelmap]: toolbarService.sections.labelMapSegmentationToolbox,
    [SegmentationRepresentations.Contour]: toolbarService.sections.contourSegmentationToolbox,
  };

  const wrappedPanelSegmentation = props => {
    return (
      <PanelSegmentation
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        configuration={{
          ...props?.configuration,
        }}
        segmentationRepresentationTypes={props?.segmentationRepresentationTypes}
      />
    );
  };

  const wrappedPanelSegmentationNoHeader = props => {
    return (
      <PanelSegmentation
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        configuration={{
          ...props?.configuration,
        }}
        segmentationRepresentationTypes={props?.segmentationRepresentationTypes}
      />
    );
  };

  const wrappedPanelSegmentationWithTools = props => {
    const { t } = useTranslation('SegmentationPanel');
    const tKey = `${props.segmentationRepresentationTypes?.[0] ?? 'Segmentation'} tools`;
    const tValue = t(tKey);

    return (
      <>
        <Toolbox
          buttonSectionId={toolSectionMap[props.segmentationRepresentationTypes?.[0]]}
          title={tValue}
        />
        <PanelSegmentation
          commandsManager={commandsManager}
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          configuration={{
            ...props?.configuration,
          }}
          segmentationRepresentationTypes={props?.segmentationRepresentationTypes}
        />
      </>
    );
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   *  WorkstationToolbar — the main right-panel component
   * ═══════════════════════════════════════════════════════════════════════════ */
  const WorkstationToolbar = ({ commandsManager, servicesManager }) => {
    const [studyRecord, setStudyRecord] = useState(null);
    const [activeTool, setActiveTool] = useState(null);
    const [retakeOpen, setRetakeOpen] = useState(false);
    const [layoutOpen, setLayoutOpen] = useState(false);
    const [layoutRows, setLayoutRows] = useState(1);
    const [layoutCols, setLayoutCols] = useState(1);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [retakeReason, setRetakeReason] = useState('Motion Blur');
    const [rejectReason, setRejectReason] = useState('Poor Image Quality');
    const [customRetakeReason, setCustomRetakeReason] = useState('');
    const [customRejectReason, setCustomRejectReason] = useState('');
    const [presetsOpen, setPresetsOpen] = useState(false);
    // Crop state: 'idle' | 'drawing' | 'applied'
    const [cropState, setCropState] = useState('idle');
    // Shutter state: 'idle' | 'drawing' | 'applied'
    const [shutterState, setShutterState] = useState('idle');
    const [expandedSections, setExpandedSections] = useState({
      imageTools: true,
      measurements: true,
      annotations: true,
      sideMarker: true,
      bodyPart: true,
      stitch: true,
      qualityCheck: true,
      actions: true,
    });

    const metadata = studyRecord?.metadata || {};
    const currentSideMarker = metadata.sideMarker || '';
    const currentBodyPart = metadata.bodyPartStamp || '';
    const qcChecklist = metadata.qcChecklist || {
      patientMatch: false,
      correctPositioning: false,
      anatomyCovered: false,
      markerPresent: false,
      noMotionBlur: false,
      noArtifacts: false,
    };
    const isQcPassed = Object.values(qcChecklist).every(Boolean);

    useEffect(() => {
      const handleMessage = (event) => {
        const data = event.data;
        if (data && typeof data === 'object' && data.type === 'TDAI_STUDY_UPDATE') {
          setStudyRecord(data.studyRecord);
          // Trigger viewport resize to initialize Cornerstone Annotation Layer and ToolGroups
          try {
            const { cornerstoneViewportService } = servicesManager.services;
            if (cornerstoneViewportService && typeof cornerstoneViewportService.resize === 'function') {
              setTimeout(() => {
                cornerstoneViewportService.resize();
              }, 300);
              setTimeout(() => {
                cornerstoneViewportService.resize();
              }, 1000);
            }
          } catch (e) {
            console.warn('[TDAI Toolbar] Study update resize error:', e);
          }
        }
      };
      window.addEventListener('message', handleMessage);
      window.parent.postMessage({ type: 'TDAI_TOOLBAR_READY' }, '*');

      // Also trigger a resize shortly after mount to ensure proper viewport setup
      try {
        const { cornerstoneViewportService } = servicesManager.services;
        if (cornerstoneViewportService && typeof cornerstoneViewportService.resize === 'function') {
          setTimeout(() => {
            cornerstoneViewportService.resize();
          }, 800);
        }
      } catch (e) {
        console.warn('[TDAI Toolbar] Initial mount resize error:', e);
      }

      return () => window.removeEventListener('message', handleMessage);
    }, [servicesManager]);

    const patchStudy = (patch) => {
      setStudyRecord(prev => {
        if (!prev) return null;
        return { ...prev, metadata: { ...(prev.metadata || {}), ...patch } };
      });
      window.parent.postMessage({ type: 'TDAI_WORKFLOW_PATCH', patch }, '*');
    };

    const triggerAction = (action, payload?) => {
      window.parent.postMessage({ type: 'TDAI_ACTION', action, payload }, '*');
    };

    const handleToolClick = (toolName, command?, options?) => {
      if (activeTool === toolName) {
        // Toggle tool OFF -> reactivate default WindowLevel tool
        setActiveTool('WindowLevel');
        try {
          commandsManager.runCommand('setToolActiveToolbar', {
            toolName: 'WindowLevel',
            toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
          });
        } catch (err) {
          console.warn('[TDAI Toolbar] Reset tool to WindowLevel error:', err);
        }
        return;
      }
      setActiveTool(toolName);
      try {
        if (command) {
          commandsManager.runCommand(command, options || {});
        } else {
          commandsManager.runCommand('setToolActiveToolbar', {
            toolName,
            toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
          });
        }
      } catch (err) {
        console.warn('[TDAI Toolbar] Tool activation error:', toolName, err);
      }
    };

    /* Toggle tools (Overlay, Scale, Ref Lines) - they use enable/disable, not active */
    const handleToggleTool = (toolName) => {
      setActiveTool(prev => prev === toolName ? null : toolName);
      try {
        commandsManager.runCommand('toggleEnabledDisabledToolbar', { itemId: toolName });
      } catch (err) {
        console.warn('[TDAI Toolbar] Toggle error:', toolName, err);
      }
    };

    /* Action commands (rotate, flip, invert, reset, capture) - fire-and-forget */
    const handleActionCommand = (label, command, options?) => {
      setActiveTool(label);
      try {
        commandsManager.runCommand(command, options || {});
      } catch (err) {
        console.warn('[TDAI Toolbar] Action error:', command, err);
      }
      setTimeout(() => setActiveTool(null), 300);
    };

    /* ═══════════════════════════════════════════════════════════════════
     *  CROP — Pure HTML Canvas Overlay (no Cornerstone annotation system)
     *  1. Click "Crop" → overlay canvas appears, cursor is crosshair
     *  2. User drags to draw a rectangle on the overlay
     *  3. Click "Apply" → viewport zooms exactly to that drawn rectangle
     *  4. Click "Reset" → full image restored
     * ═══════════════════════════════════════════════════════════════════ */
    const cropRectRef = useRef<{x1:number,y1:number,x2:number,y2:number}|null>(null);
    const cropOverlayRef = useRef<HTMLCanvasElement|null>(null);

    const getActiveViewport = () => {
      try {
        const { cornerstoneViewportService, viewportGridService } = servicesManager.services;
        const { activeViewportId } = viewportGridService.getState();
        return cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      } catch { return null; }
    };

    const handleCropDraw = () => {
      const viewport = getActiveViewport();
      if (!viewport?.canvas) return;
      const viewportEl = viewport.canvas.parentElement as HTMLElement;
      if (!viewportEl) return;

      // Remove any previous overlay
      cropOverlayRef.current?.remove();

      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:all;z-index:20;cursor:crosshair;';
      canvas.width = viewport.canvas.clientWidth || viewport.canvas.width;
      canvas.height = viewport.canvas.clientHeight || viewport.canvas.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      viewportEl.style.position = 'relative';
      viewportEl.appendChild(canvas);
      cropOverlayRef.current = canvas;

      const ctx = canvas.getContext('2d')!;
      let drawing = false;
      let sx = 0, sy = 0, ex = 0, ey = 0;

      const getPos = (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };

      const onMouseDown = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const p = getPos(e);
        sx = p.x; sy = p.y; ex = p.x; ey = p.y;
        drawing = true;
      };
      const onMouseMove = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!drawing) return;
        const p = getPos(e);
        ex = p.x; ey = p.y;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw semi-transparent fill + dashed border
        const x = Math.min(sx, ex), y = Math.min(sy, ey);
        const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
        ctx.fillStyle = 'rgba(255,255,0,0.08)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      };
      const onMouseUp = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!drawing) return;
        drawing = false;
        const x1 = Math.min(sx, ex), y1 = Math.min(sy, ey);
        const x2 = Math.max(sx, ex), y2 = Math.max(sy, ey);
        cropRectRef.current = { x1, y1, x2, y2 };
        // Keep the drawn rect visible as guide
      };

      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mouseup', onMouseUp);
      (canvas as any).__tdaiListeners = { onMouseDown, onMouseMove, onMouseUp };

      setCropState('drawing');
      setActiveTool('CropDraw');
      // Disable Cornerstone pointer events on the viewport canvas
      viewport.canvas.style.pointerEvents = 'none';
    };

    const handleCropApply = () => {
      const viewport = getActiveViewport();
      if (!viewport) return;

      const rect = cropRectRef.current;
      if (rect && (rect.x2 - rect.x1) > 10 && (rect.y2 - rect.y1) > 10) {
        const canvas = cropOverlayRef.current;
        const canvasDisplayW = canvas?.getBoundingClientRect().width || viewport.canvas.clientWidth;
        const canvasDisplayH = canvas?.getBoundingClientRect().height || viewport.canvas.clientHeight;
        const csW = viewport.canvas.width;
        const csH = viewport.canvas.height;
        // Scale drawn pixel coords to Cornerstone canvas coords
        const scaleX = csW / canvasDisplayW;
        const scaleY = csH / canvasDisplayH;
        const csX1 = rect.x1 * scaleX, csY1 = rect.y1 * scaleY;
        const csX2 = rect.x2 * scaleX, csY2 = rect.y2 * scaleY;
        const boxW = csX2 - csX1, boxH = csY2 - csY1;
        const camera = viewport.getCamera();
        if (camera?.parallelScale) {
          const newScale = Math.max(
            camera.parallelScale * boxW / csW,
            camera.parallelScale * boxH / csH
          );
          const mid = viewport.canvasToWorld([(csX1 + csX2) / 2, (csY1 + csY2) / 2, 0] as [number,number,number]);
          viewport.setCamera({ parallelScale: newScale, focalPoint: mid });
          viewport.render();
        }
      }

      // Remove drawing overlay, restore pointer events
      if (cropOverlayRef.current) {
        const listeners = (cropOverlayRef.current as any).__tdaiListeners;
        if (listeners) {
          cropOverlayRef.current.removeEventListener('mousedown', listeners.onMouseDown);
          cropOverlayRef.current.removeEventListener('mousemove', listeners.onMouseMove);
          cropOverlayRef.current.removeEventListener('mouseup', listeners.onMouseUp);
        }
        cropOverlayRef.current.remove();
        cropOverlayRef.current = null;
      }
      viewport.canvas.style.pointerEvents = '';
      setCropState('applied');
      setActiveTool(null);
    };

    const handleCropReset = () => {
      const viewport = getActiveViewport();
      if (viewport) {
        viewport.resetCamera();
        viewport.render();
        viewport.canvas.style.pointerEvents = '';
      }
      if (cropOverlayRef.current) {
        cropOverlayRef.current.remove();
        cropOverlayRef.current = null;
      }
      cropRectRef.current = null;
      setCropState('idle');
      setActiveTool(null);
    };

    /* ═══════════════════════════════════════════════════════════════════
     *  SHUTTER — Pure HTML Canvas Overlay (freehand mouse drawing)
     *  1. Click "Shutter" → overlay canvas appears in draw mode
     *  2. User holds mouse and draws a freehand path around the region to KEEP
     *  3. Click "Apply" → permanent black mask covers everything OUTSIDE
     *  4. Click "Clear" → mask removed
     * ═══════════════════════════════════════════════════════════════════ */
    const shutterPathRef = useRef<{x:number,y:number}[]>([]);
    const shutterDrawOverlayRef = useRef<HTMLCanvasElement|null>(null);
    const shutterMaskOverlayRef = useRef<HTMLCanvasElement|null>(null);

    const handleShutterDraw = () => {
      const viewport = getActiveViewport();
      if (!viewport?.canvas) return;
      const viewportEl = viewport.canvas.parentElement as HTMLElement;
      if (!viewportEl) return;

      // Remove any stale draw overlay
      shutterDrawOverlayRef.current?.remove();
      shutterPathRef.current = [];

      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:all;z-index:20;cursor:crosshair;';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.width = viewport.canvas.clientWidth || viewport.canvas.width;
      canvas.height = viewport.canvas.clientHeight || viewport.canvas.height;
      viewportEl.style.position = 'relative';
      viewportEl.appendChild(canvas);
      shutterDrawOverlayRef.current = canvas;

      const ctx = canvas.getContext('2d')!;
      let drawing = false;

      const getPos = (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };

      const onMouseDown = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        drawing = true;
        shutterPathRef.current = [];
        const p = getPos(e);
        shutterPathRef.current.push(p);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.strokeStyle = '#00BFFF';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
      };
      const onMouseMove = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!drawing) return;
        const p = getPos(e);
        shutterPathRef.current.push(p);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      };
      const onMouseUp = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!drawing) return;
        drawing = false;
        // Close the path visually
        if (shutterPathRef.current.length > 1) {
          const first = shutterPathRef.current[0];
          ctx.lineTo(first.x, first.y);
          ctx.stroke();
          // Fill preview
          ctx.fillStyle = 'rgba(0,191,255,0.1)';
          ctx.fill();
        }
      };

      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mouseup', onMouseUp);
      (canvas as any).__tdaiListeners = { onMouseDown, onMouseMove, onMouseUp };

      setShutterState('drawing');
      setActiveTool('ShutterDraw');
      viewport.canvas.style.pointerEvents = 'none';
    };

    const handleShutterApply = () => {
      const viewport = getActiveViewport();
      if (!viewport?.canvas) return;
      const viewportEl = viewport.canvas.parentElement as HTMLElement;
      if (!viewportEl) return;

      const pts = shutterPathRef.current;

      // Remove draw overlay
      if (shutterDrawOverlayRef.current) {
        const listeners = (shutterDrawOverlayRef.current as any).__tdaiListeners;
        if (listeners) {
          shutterDrawOverlayRef.current.removeEventListener('mousedown', listeners.onMouseDown);
          shutterDrawOverlayRef.current.removeEventListener('mousemove', listeners.onMouseMove);
          shutterDrawOverlayRef.current.removeEventListener('mouseup', listeners.onMouseUp);
        }
        shutterDrawOverlayRef.current.remove();
        shutterDrawOverlayRef.current = null;
      }

      // Create permanent mask overlay
      shutterMaskOverlayRef.current?.remove();
      const mask = document.createElement('canvas');
      mask.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:15;';
      mask.style.width = '100%';
      mask.style.height = '100%';
      mask.width = viewport.canvas.clientWidth || viewport.canvas.width;
      mask.height = viewport.canvas.clientHeight || viewport.canvas.height;
      viewportEl.appendChild(mask);
      shutterMaskOverlayRef.current = mask;

      const ctx = mask.getContext('2d')!;
      const w = mask.width, h = mask.height;

      // Fill entire canvas black
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, w, h);

      if (pts.length > 3) {
        // Cut out the drawn region (make it transparent)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      shutterPathRef.current = [];
      viewport.canvas.style.pointerEvents = '';
      setShutterState('applied');
      setActiveTool(null);
    };

    const handleShutterReset = () => {
      const viewport = getActiveViewport();
      if (viewport) viewport.canvas.style.pointerEvents = '';
      shutterDrawOverlayRef.current?.remove();
      shutterDrawOverlayRef.current = null;
      shutterMaskOverlayRef.current?.remove();
      shutterMaskOverlayRef.current = null;
      shutterPathRef.current = [];
      setShutterState('idle');
      setActiveTool(null);
    };

    /* ═══════════════════════════════════════════════════════════════════
     *  SIDE MARKERS — Draggable HTML text labels
     *  Clicking R/L/AP/PA places a bold yellow letter on the image.
     *  The label can be dragged anywhere. Right-click to remove it.
     * ═══════════════════════════════════════════════════════════════════ */
    const placeSideMarkerLabel = (marker: string) => {
      const viewport = getActiveViewport();
      if (!viewport?.canvas) return;
      const viewportEl = viewport.canvas.parentElement as HTMLElement;
      if (!viewportEl) return;
      viewportEl.style.position = 'relative';

      const label = document.createElement('div');
      label.textContent = marker;
      label.setAttribute('data-tdai-marker', marker);
      label.style.cssText = [
        'position:absolute',
        'top:24px',
        'left:24px',
        'color:#FFD700',
        'font-size:32px',
        'font-weight:900',
        'font-family:Arial,Helvetica,sans-serif',
        'cursor:move',
        'z-index:50',
        'user-select:none',
        'line-height:1',
        'pointer-events:all',
        'text-shadow:2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 2px 0 #000,2px 0 0 #000,0 -2px 0 #000,-2px 0 0 #000',
      ].join(';');

      viewportEl.appendChild(label);

      // Drag logic
      let isDragging = false, ox = 0, oy = 0;

      label.addEventListener('mousedown', (e: MouseEvent) => {
        isDragging = true;
        const pRect = viewportEl.getBoundingClientRect();
        const lRect = label.getBoundingClientRect();
        ox = e.clientX - (lRect.left - pRect.left);
        oy = e.clientY - (lRect.top - pRect.top);
        e.preventDefault();
        e.stopPropagation();
      });

      const onMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const pRect = viewportEl.getBoundingClientRect();
        label.style.left = (e.clientX - pRect.left - ox) + 'px';
        label.style.top = (e.clientY - pRect.top - oy) + 'px';
      };
      const onUp = () => { isDragging = false; };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

      // Right-click removes the marker
      label.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        label.remove();
      });
    };

    const handleQcToggle = (key) => {
      const newQc = { ...qcChecklist, [key]: !qcChecklist[key] };
      patchStudy({ qcChecklist: newQc, qcStatus: 'pending', workflowStatus: 'qc-pending' });
    };

    const toggleSection = (section) => {
      setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const SIDE_MARKERS = ['R', 'L', 'AP', 'PA', 'Standing', 'Supine'];
    const BODY_STAMPS = ['Chest', 'Abdomen', 'Spine', 'Femur', 'Foot', 'Knee', 'Cervical Spine'];
    const RETAKE_REASONS = ['Motion Blur', 'Wrong Positioning', 'Anatomy Not Covered', 'Artifact', 'Exposure Issue', 'Other'];
    const REJECT_REASONS = ['Poor Image Quality', 'Wrong Patient', 'Wrong Body Part', 'Duplicate Study', 'Incomplete Study', 'Motion Artifact', 'Other'];

    /* ── Shared styles ── */
    const sectionHeader = (label, section) => (
      <button
        onClick={() => toggleSection(section)}
        className="flex items-center justify-between w-full mb-1.5 pb-1 border-b border-[#2a3345]"
        style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7b8da4' }}
      >
        {label}
        <svg className={`transition-transform ${expandedSections[section] ? 'rotate-180' : ''}`} style={{ width: 10, height: 10 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
      </button>
    );

    /* ── Tool button ── */
    const toolBtn = (label, toolName, iconPath, command?, options?) => {
      const active = activeTool === toolName;
      return (
        <button
          onClick={() => handleToolClick(toolName, command, options)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
            border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
            backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
            borderColor: active ? '#b8ac94' : '#e0d8c8',
            color: active ? '#0c1525' : '#1a2744',
            boxShadow: active ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {typeof iconPath === 'string'
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={iconPath} />
              : iconPath
            }
          </svg>
          <span style={{ fontSize: '8.5px', fontWeight: 600, lineHeight: 1.1, textAlign: 'center' }}>{label}</span>
        </button>
      );
    };

    /* ── Chip button (markers / body part) ── */
    const chipBtn = (label, active, onClick) => (
      <button
        key={label}
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '6px 4px', borderRadius: '6px',
          border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
          fontSize: '9px', fontWeight: 700, textAlign: 'center',
          backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
          borderColor: active ? '#b8ac94' : '#e0d8c8',
          color: active ? '#0c1525' : '#1a2744',
          boxShadow: active ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
        }}
      >
        {label}
      </button>
    );

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        backgroundColor: '#0d1117', color: '#c8d6e5', padding: '10px',
        overflowY: 'auto', userSelect: 'none', gap: '10px',
        scrollbarWidth: 'thin', scrollbarColor: '#1e2533 #0d1117',
      }}>

        {/* ═══════ IMAGE TOOLS (12 tools from benchmark) ═══════ */}
        <div>
          {sectionHeader('Image Tools', 'imageTools')}
          {expandedSections.imageTools && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
              {toolBtn('Zoom', 'Zoom', 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7')}
              {toolBtn('Pan', 'Pan', 'M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 20v-4m0 4h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5')}
              {toolBtn('Window', 'WindowLevel', 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z')}

              {/* Presets dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setPresetsOpen(!presetsOpen)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px', width: '100%',
                    border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                    backgroundColor: presetsOpen ? '#d6cdb8' : '#f0ebe0',
                    borderColor: presetsOpen ? '#b8ac94' : '#e0d8c8',
                    color: presetsOpen ? '#0c1525' : '#1a2744',
                  }}
                >
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Presets</span>
                </button>
                {presetsOpen && (
                  <div style={{
                    position: 'absolute', right: 0, marginTop: '4px', width: '130px',
                    borderRadius: '8px', backgroundColor: '#f0ebe0', border: '1px solid #e0d8c8',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.3)', zIndex: 50, padding: '4px 0',
                  }}>
                    {([
                      ['Soft Tissue', { windowWidth: 400, windowCenter: 40 }],
                      ['Lung', { windowWidth: 1500, windowCenter: -600 }],
                      ['Bone', { windowWidth: 2000, windowCenter: 300 }],
                      ['Brain', { windowWidth: 80, windowCenter: 40 }],
                      ['Abdomen', { windowWidth: 400, windowCenter: 50 }],
                      ['Liver', { windowWidth: 150, windowCenter: 30 }],
                    ] as const).map(([label, wl]) => (
                      <button key={label as string} onClick={() => { commandsManager.runCommand('setWindowLevel', wl); setPresetsOpen(false); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '5px 10px', fontSize: '10px', fontWeight: 600,
                          color: '#1a2744', backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#e0d8c8')}
                        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >{label as string}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Rotate, Flip, Invert — action commands (fire-and-forget, not interactive tools) */}
              {(() => {
                const items = [
                  { label: 'Rotate ↻', id: 'rotate-right', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9', cmd: 'rotateViewportCW' },
                  { label: 'Rotate ↺', id: 'rotate-left', icon: 'M20 4v5h-.581m-15.357 2A8.001 8.001 0 0119.42 9m0 0H15', cmd: 'rotateViewportCCW' },
                  { label: 'Flip H', id: 'flipHorizontal', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', cmd: 'flipViewportHorizontal' },
                  { label: 'Flip V', id: 'flipVertical', icon: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4', cmd: 'flipViewportVertical' },
                  { label: 'Invert', id: 'invert', icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z', cmd: 'invertViewport' },
                ];
                return items.map(item => (
                  <button key={item.id}
                    onClick={() => handleActionCommand(item.id, item.cmd)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: activeTool === item.id ? '#d6cdb8' : '#f0ebe0',
                      borderColor: activeTool === item.id ? '#b8ac94' : '#e0d8c8',
                      color: activeTool === item.id ? '#0c1525' : '#1a2744',
                      boxShadow: activeTool === item.id ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
                    }}
                  >
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={item.icon} />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600, lineHeight: 1.1, textAlign: 'center' }}>{item.label}</span>
                  </button>
                ));
              })()}

              {/* ── SHUTTER: two-step Draw → Apply ── */}
              {shutterState === 'idle' && (
                <button onClick={handleShutterDraw} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                  border: '1px solid #e0d8c8', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: '#f0ebe0', color: '#1a2744',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth="1.8" /></svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Shutter</span>
                </button>
              )}
              {shutterState === 'drawing' && (
                <button onClick={handleShutterApply} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                  border: '1px solid #60a5fa', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: '#1e3a5f', color: '#93c5fd', boxShadow: '0 0 6px rgba(96,165,250,0.4)',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 700 }}>Apply✓</span>
                </button>
              )}
              {shutterState === 'applied' && (
                <button onClick={handleShutterReset} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                  border: '1px solid #f87171', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: '#3b1f1f', color: '#fca5a5',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 700 }}>Clear✕</span>
                </button>
              )}

              {/* ── CROP: two-step Draw → Apply ── */}
              {cropState === 'idle' && (
                <button onClick={handleCropDraw} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                  border: '1px solid #e0d8c8', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: '#f0ebe0', color: '#1a2744',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 3v4M3 7h4m10 0h4m-4 0V3m0 14v4m4-4h-4M7 17H3m4 0v4M7 7h10v10H7z" />
                  </svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Crop</span>
                </button>
              )}
              {cropState === 'drawing' && (
                <button onClick={handleCropApply} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                  border: '1px solid #60a5fa', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: '#1e3a5f', color: '#93c5fd', boxShadow: '0 0 6px rgba(96,165,250,0.4)',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 700 }}>Apply✓</span>
                </button>
              )}
              {cropState === 'applied' && (
                <button onClick={handleCropReset} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                  border: '1px solid #f87171', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: '#3b1f1f', color: '#fca5a5',
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 700 }}>Reset✕</span>
                </button>
              )}

              {toolBtn('Magnify', 'Magnify',
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </>
              )}

              {/* Overlay — toggle enabled/disabled */}
              {(() => {
                const active = activeTool === 'ImageOverlayViewer';
                return (
                  <button
                    onClick={() => handleToggleTool('ImageOverlayViewer')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Overlay</span>
                  </button>
                );
              })()}
              {/* Reset — action command */}
              {(() => {
                const active = activeTool === 'Reset';
                return (
                  <button
                    onClick={() => handleActionCommand('Reset', 'resetViewport')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Reset</span>
                  </button>
                );
              })()}

              {/* Capture */}
              {(() => {
                const active = activeTool === 'Camera';
                return (
                  <button
                    onClick={() => handleToolClick('Camera', 'showDownloadViewportModal')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Capture</span>
                  </button>
                );
              })()}

              {/* Cine */}
              {(() => {
                const active = activeTool === 'Cine';
                return (
                  <button
                    onClick={() => handleToolClick('Cine', 'toggleCine')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Cine</span>
                  </button>
                );
              })()}

              {toolBtn('Scroll', 'StackScroll', 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10')}

              {/* Layout — grid selector dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setLayoutOpen(!layoutOpen)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px', width: '100%',
                    border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                    backgroundColor: layoutOpen ? '#d6cdb8' : '#f0ebe0',
                    borderColor: layoutOpen ? '#b8ac94' : '#e0d8c8',
                    color: layoutOpen ? '#0c1525' : '#1a2744',
                  }}
                >
                  <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Layout</span>
                </button>
                {layoutOpen && (
                  <div style={{
                    position: 'absolute', right: 0, marginTop: '4px', width: '120px',
                    borderRadius: '8px', backgroundColor: '#f0ebe0', border: '1px solid #e0d8c8',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.3)', zIndex: 50, padding: '6px',
                  }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: '#1a2744', marginBottom: '4px', textAlign: 'center' }}>Select Grid</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px' }}>
                      {Array.from({ length: 12 }, (_, i) => {
                        const r = Math.floor(i / 4) + 1;
                        const c = (i % 4) + 1;
                        const isHover = layoutRows >= r && layoutCols >= c;
                        return (
                          <button
                            key={`${r}-${c}`}
                            onMouseEnter={() => { setLayoutRows(r); setLayoutCols(c); }}
                            onClick={() => {
                              commandsManager.runCommand('setViewportGridLayout', { numRows: r, numCols: c });
                              setLayoutOpen(false);
                            }}
                            style={{
                              width: '22px', height: '22px', borderRadius: '3px',
                              border: '1px solid #c8bba8', cursor: 'pointer',
                              backgroundColor: isHover ? '#1a2744' : '#e0d8c8',
                            }}
                          />
                        );
                      })}
                    </div>
                    <div style={{ fontSize: '8px', fontWeight: 600, color: '#1a2744', marginTop: '4px', textAlign: 'center' }}>
                      {layoutRows} × {layoutCols}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ═══════ MEASUREMENT TOOLS (12 tools from benchmark) ═══════ */}
        <div>
          {sectionHeader('Measurement Tools', 'measurements')}
          {expandedSections.measurements && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
              {toolBtn('Distance', 'Length', 'M4 20L20 4M4 20l3-1m-3 1l1-3m15-13l-3 1m3-1l-1 3')}
              {toolBtn('Bidir.', 'Bidirectional', 'M8 7h12M8 17h12M4 7l4 5-4 5')}
              {toolBtn('Angle', 'Angle', 'M20 20H4V4m0 16L16 8')}
              {toolBtn('Cobb', 'CobbAngle', 'M4 8h16M4 16h16')}

              {/* Circle ROI */}
              {(() => {
                const active = activeTool === 'CircleROI';
                return (
                  <button
                    onClick={() => handleToolClick('CircleROI')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth="1.8" /></svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Circle</span>
                  </button>
                );
              })()}

              {/* Rectangle ROI */}
              {(() => {
                const active = activeTool === 'RectangleROI';
                return (
                  <button
                    onClick={() => handleToolClick('RectangleROI')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2" strokeWidth="1.8" /></svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Rect.</span>
                  </button>
                );
              })()}

              {/* Ellipse ROI */}
              {(() => {
                const active = activeTool === 'EllipticalROI';
                return (
                  <button
                    onClick={() => handleToolClick('EllipticalROI')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                    }}
                  >
                    <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><ellipse cx="12" cy="12" rx="10" ry="7" strokeWidth="1.8" /></svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Ellipse</span>
                  </button>
                );
              })()}

              {toolBtn('Freehand', 'PlanarFreehandROI', 'M3 17c2-4 4-2 6-6s2-6 6-4 4 6 6 2')}
              {toolBtn('Spline', 'SplineROI', 'M4 20Q8 4 12 12T20 4')}
              {toolBtn('HU', 'Probe', 'M12 4v4m0 8v4m8-8h-4M8 12H4m13.66-5.66l-2.83 2.83M10.17 13.17l-2.83 2.83m11.32 0l-2.83-2.83M10.17 10.83L7.34 7.99')}
              {toolBtn('Calibrate', 'CalibrationLine', 'M6 12h12M6 12l2-2m-2 2l2 2m10-2l-2-2m2 2l-2 2')}
              {toolBtn('Polyline', 'LivewireContour', 'M4 16l4-4 4 4 4-8 4 4')}
            </div>
          )}
          {/* Tip for drawing tools */}
          {expandedSections.measurements && (activeTool === 'PlanarFreehandROI' || activeTool === 'SplineROI' || activeTool === 'LivewireContour') && (
            <div style={{
              marginTop: '6px', fontSize: '8px', color: 'rgba(251, 191, 36, 0.8)',
              backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '4px', padding: '4px 8px',
            }}>
              💡 Double-click to finish drawing. Right-click to cancel.
            </div>
          )}
        </div>

        {/* ═══════ ANNOTATION TOOLS ═══════ */}
        <div>
          {sectionHeader('Annotation Tools', 'annotations')}
          {expandedSections.annotations && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
              {/* Arrow annotation — activates ArrowAnnotate (draws arrow + prompts for text) */}
              {toolBtn('Arrow', 'ArrowAnnotate', 'M14 5l7 7m0 0l-7 7m7-7H3')}

              {/* Text annotation — uses Probe tool as marker + immediately shows text dialog */}
              {(() => {
                const active = activeTool === 'TextAnnotation';
                return (
                  <button
                    onClick={() => {
                      setActiveTool('TextAnnotation');
                      try {
                        // Activate ArrowAnnotate which will prompt for text via arrowTextCallback
                        commandsManager.runCommand('setToolActiveToolbar', {
                          toolName: 'ArrowAnnotate',
                          toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
                        });
                      } catch (err) {
                        console.warn('[TDAI Toolbar] Text annotation error:', err);
                      }
                    }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                      border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                      borderColor: active ? '#b8ac94' : '#e0d8c8',
                      color: active ? '#0c1525' : '#1a2744',
                      boxShadow: active ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
                    }}
                  >
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6h16M8 6v12m8-12v12M6 18h4m4 0h4" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Text</span>
                  </button>
                );
              })()}

              {/* Scale — toggle */}
              {(() => {
                const active = activeTool === 'ScaleOverlay';
                return (
                  <button onClick={() => handleToggleTool('ScaleOverlay')} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                    border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                    backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                    borderColor: active ? '#b8ac94' : '#e0d8c8',
                    color: active ? '#0c1525' : '#1a2744',
                  }}>
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 20h16M4 20v-2m4 2v-4m4 4v-2m4 4v-4m4 4v-2" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Scale</span>
                  </button>
                );
              })()}

              {/* Info — toggle image overlay */}
              {(() => {
                const active = activeTool === 'InfoOverlay';
                return (
                  <button onClick={() => { setActiveTool(prev => prev === 'InfoOverlay' ? null : 'InfoOverlay'); try { commandsManager.runCommand('toggleEnabledDisabledToolbar', { itemId: 'ImageOverlayViewer' }); } catch(e) { console.warn(e); } }} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                    border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                    backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                    borderColor: active ? '#b8ac94' : '#e0d8c8',
                    color: active ? '#0c1525' : '#1a2744',
                  }}>
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Info</span>
                  </button>
                );
              })()}

              {/* DICOM Tag Browser — action command */}
              {(() => {
                const active = activeTool === 'TagBrowser';
                return (
                  <button onClick={() => handleActionCommand('TagBrowser', 'openDICOMTagViewer')} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                    border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                    backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                    borderColor: active ? '#b8ac94' : '#e0d8c8',
                    color: active ? '#0c1525' : '#1a2744',
                  }}>
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>DICOM</span>
                  </button>
                );
              })()}

              {/* Reference Lines — toggle */}
              {(() => {
                const active = activeTool === 'ReferenceLines';
                return (
                  <button onClick={() => handleToggleTool('ReferenceLines')} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', borderRadius: '6px', padding: '5px 2px', minHeight: '44px',
                    border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                    backgroundColor: active ? '#d6cdb8' : '#f0ebe0',
                    borderColor: active ? '#b8ac94' : '#e0d8c8',
                    color: active ? '#0c1525' : '#1a2744',
                  }}>
                    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Ref Lines</span>
                  </button>
                );
              })()}
            </div>
          )}
        </div>

        {/* ═══════ SIDE MARKER ═══════ */}
        <div>
          {sectionHeader('Side Marker', 'sideMarker')}
          {expandedSections.sideMarker && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
                {SIDE_MARKERS.map(marker => (
                  <button
                    key={marker}
                    onClick={() => {
                      patchStudy({ sideMarker: marker });
                      placeSideMarkerLabel(marker);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '6px 4px', borderRadius: '6px',
                      border: '1px solid #e0d8c8', cursor: 'pointer', transition: 'all 150ms',
                      fontSize: '11px', fontWeight: 700, textAlign: 'center',
                      backgroundColor: currentSideMarker === marker ? '#d6cdb8' : '#f0ebe0',
                      borderColor: currentSideMarker === marker ? '#b8ac94' : '#e0d8c8',
                      color: currentSideMarker === marker ? '#0c1525' : '#1a2744',
                    }}
                  >
                    {marker}
                  </button>
                ))}
              </div>
              <div style={{
                marginTop: '4px', fontSize: '8px', color: 'rgba(156, 163, 175, 0.8)',
                borderRadius: '4px', padding: '2px 4px',
              }}>
                Click to place on image. Drag to move. Right-click to remove.
              </div>
            </>
          )}
        </div>

        {/* ═══════ BODY PART (2 per row) ═══════ */}
        <div>
          {sectionHeader('Body Part', 'bodyPart')}
          {expandedSections.bodyPart && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px' }}>
              {BODY_STAMPS.map(part => chipBtn(part, currentBodyPart === part, () => patchStudy({ bodyPartStamp: part })))}
            </div>
          )}
        </div>

        {/* ═══════ STITCH / AUTO STITCH ═══════ */}
        <div>
          {sectionHeader('Stitch', 'stitch')}
          {expandedSections.stitch && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px' }}>
              {/* Manual Stitch */}
              <button
                onClick={() => {
                  setActiveTool('Stitch');
                  try { commandsManager.runCommand('activateStitch'); } catch (e) {
                    console.warn('[TDAI] activateStitch error:', e);
                  }
                }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '3px', borderRadius: '6px', padding: '7px 4px', minHeight: '44px',
                  border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: activeTool === 'Stitch' ? '#d6cdb8' : '#f0ebe0',
                  borderColor: activeTool === 'Stitch' ? '#b8ac94' : '#e0d8c8',
                  color: activeTool === 'Stitch' ? '#0c1525' : '#1a2744',
                  boxShadow: activeTool === 'Stitch' ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6h16M4 12h8m-8 6h16" />
                </svg>
                <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Stitch</span>
              </button>

              {/* Auto Stitch */}
              <button
                onClick={() => {
                  setActiveTool('AutoStitch');
                  try { commandsManager.runCommand('activateAutoStitch'); } catch (e) {
                    console.warn('[TDAI] activateAutoStitch error:', e);
                  }
                }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '3px', borderRadius: '6px', padding: '7px 4px', minHeight: '44px',
                  border: '1px solid', cursor: 'pointer', transition: 'all 150ms',
                  backgroundColor: activeTool === 'AutoStitch' ? '#d6cdb8' : '#f0ebe0',
                  borderColor: activeTool === 'AutoStitch' ? '#b8ac94' : '#e0d8c8',
                  color: activeTool === 'AutoStitch' ? '#0c1525' : '#1a2744',
                  boxShadow: activeTool === 'AutoStitch' ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                </svg>
                <span style={{ fontSize: '8.5px', fontWeight: 600 }}>Auto Stitch</span>
              </button>
            </div>
          )}
        </div>

        {/* ═══════ QUALITY CHECK ═══════ */}
        <div>
          {sectionHeader('Quality Check', 'qualityCheck')}
          {expandedSections.qualityCheck && (
            <div style={{
              backgroundColor: '#161b22', border: '1px solid #2a3345',
              borderRadius: '8px', padding: '10px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #1e2533',
              }}>
                <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#8899b0', letterSpacing: '0.08em' }}>Checklist</span>
                <span style={{
                  fontSize: '8px', fontWeight: 900, padding: '2px 8px', borderRadius: '20px',
                  backgroundColor: isQcPassed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                  color: isQcPassed ? '#34d399' : '#fbbf24',
                }}>
                  {isQcPassed ? 'PASS' : 'PENDING'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {([
                  ['patientMatch', 'Patient Match'],
                  ['correctPositioning', 'Correct Positioning'],
                  ['anatomyCovered', 'Anatomy Covered'],
                  ['markerPresent', 'Side Marker Present'],
                  ['noMotionBlur', 'No Motion Blur'],
                  ['noArtifacts', 'No Artifacts'],
                ] as const).map(([key, label]) => (
                  <label key={key} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    fontSize: '10px', color: '#c8d6e5', cursor: 'pointer', userSelect: 'none',
                  }}>
                    <input type="checkbox" checked={qcChecklist[key]} onChange={() => handleQcToggle(key)}
                      style={{ width: 14, height: 14, accentColor: '#0ea5e9', cursor: 'pointer' }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══════ ACTIONS ═══════ */}
        <div>
          {sectionHeader('Actions', 'actions')}
          {expandedSections.actions && (
            <>
              {/* Retake reason panel */}
              {retakeOpen && (
                <div style={{
                  backgroundColor: '#161b22', border: '1px solid rgba(249, 115, 22, 0.3)',
                  borderRadius: '8px', padding: '10px', marginBottom: '6px',
                  display: 'flex', flexDirection: 'column', gap: '6px',
                }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#fb923c' }}>Retake — Select Reason</div>
                  <select value={retakeReason} onChange={(e) => setRetakeReason(e.target.value)}
                    style={{
                      width: '100%', backgroundColor: '#0d1117', border: '1px solid #2a3345',
                      borderRadius: '6px', padding: '5px 8px', fontSize: '10px', color: '#c8d6e5',
                    }}>
                    {RETAKE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {retakeReason === 'Other' && (
                    <input type="text" placeholder="Enter reason..." value={customRetakeReason} onChange={(e) => setCustomRetakeReason(e.target.value)}
                      style={{
                        width: '100%', backgroundColor: '#0d1117', border: '1px solid #2a3345',
                        borderRadius: '6px', padding: '5px 8px', fontSize: '10px', color: '#c8d6e5',
                      }} />
                  )}
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setRetakeOpen(false)} style={{
                      padding: '5px 10px', fontSize: '10px', fontWeight: 600, color: '#8899b0',
                      backgroundColor: '#1e2533', border: 'none', borderRadius: '6px', cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={() => { const r = retakeReason === 'Other' ? customRetakeReason.trim() : retakeReason; if (r) { triggerAction('retake', { reason: r }); setRetakeOpen(false); setCustomRetakeReason(''); } }}
                      style={{
                        padding: '5px 10px', fontSize: '10px', fontWeight: 700, color: '#fff',
                        backgroundColor: '#ea580c', border: 'none', borderRadius: '6px', cursor: 'pointer',
                      }}>Confirm</button>
                  </div>
                </div>
              )}

              {/* Reject reason panel */}
              {rejectOpen && (
                <div style={{
                  backgroundColor: '#161b22', border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px', padding: '10px', marginBottom: '6px',
                  display: 'flex', flexDirection: 'column', gap: '6px',
                }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#f87171' }}>Reject — Select Reason</div>
                  <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    style={{
                      width: '100%', backgroundColor: '#0d1117', border: '1px solid #2a3345',
                      borderRadius: '6px', padding: '5px 8px', fontSize: '10px', color: '#c8d6e5',
                    }}>
                    {REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {rejectReason === 'Other' && (
                    <input type="text" placeholder="Enter reason..." value={customRejectReason} onChange={(e) => setCustomRejectReason(e.target.value)}
                      style={{
                        width: '100%', backgroundColor: '#0d1117', border: '1px solid #2a3345',
                        borderRadius: '6px', padding: '5px 8px', fontSize: '10px', color: '#c8d6e5',
                      }} />
                  )}
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setRejectOpen(false)} style={{
                      padding: '5px 10px', fontSize: '10px', fontWeight: 600, color: '#8899b0',
                      backgroundColor: '#1e2533', border: 'none', borderRadius: '6px', cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={() => { const r = rejectReason === 'Other' ? customRejectReason.trim() : rejectReason; if (r) { triggerAction('reject', { reason: r }); setRejectOpen(false); setCustomRejectReason(''); } }}
                      style={{
                        padding: '5px 10px', fontSize: '10px', fontWeight: 700, color: '#fff',
                        backgroundColor: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer',
                      }}>Confirm</button>
                  </div>
                </div>
              )}

              {!retakeOpen && !rejectOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px' }}>
                  {/* Approve — green */}
                  <button onClick={() => triggerAction('approve')} disabled={!studyRecord || !isQcPassed}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      padding: '8px 4px', fontSize: '9px', fontWeight: 700, borderRadius: '6px',
                      border: 'none', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: '#16a34a', color: '#fff',
                      opacity: (!studyRecord || !isQcPassed) ? 0.3 : 1,
                      pointerEvents: (!studyRecord || !isQcPassed) ? 'none' : 'auto',
                    }}>
                    <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                    Approve
                  </button>
                  {/* Reject — red */}
                  <button onClick={() => setRejectOpen(true)} disabled={!studyRecord}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      padding: '8px 4px', fontSize: '9px', fontWeight: 700, borderRadius: '6px',
                      border: 'none', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: '#dc2626', color: '#fff',
                      opacity: !studyRecord ? 0.3 : 1,
                      pointerEvents: !studyRecord ? 'none' : 'auto',
                    }}>
                    <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                    Reject
                  </button>
                  {/* Retake — amber/orange */}
                  <button onClick={() => setRetakeOpen(true)} disabled={!studyRecord}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      padding: '8px 4px', fontSize: '9px', fontWeight: 700, borderRadius: '6px',
                      border: 'none', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: '#ea580c', color: '#fff',
                      opacity: !studyRecord ? 0.3 : 1,
                      pointerEvents: !studyRecord ? 'none' : 'auto',
                    }}>
                    <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9" /></svg>
                    Retake
                  </button>
                  {/* Complete — blue */}
                  <button onClick={() => triggerAction('complete')} disabled={!studyRecord || !isQcPassed}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      padding: '8px 4px', fontSize: '9px', fontWeight: 700, borderRadius: '6px',
                      border: 'none', cursor: 'pointer', transition: 'all 150ms',
                      backgroundColor: '#2563eb', color: '#fff',
                      opacity: (!studyRecord || !isQcPassed) ? 0.3 : 1,
                      pointerEvents: (!studyRecord || !isQcPassed) ? 'none' : 'auto',
                    }}>
                    <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Complete
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const wrappedPanelWorkstationTools = props => {
    return (
      <WorkstationToolbar
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        {...props}
      />
    );
  };

  return [
    {
      name: 'panelWorkstationTools',
      iconName: 'tool-more-menu',
      iconLabel: 'Toolbar',
      label: 'Toolbar',
      component: wrappedPanelWorkstationTools,
    },
    {
      name: 'activeViewportWindowLevel',
      component: () => {
        return <ActiveViewportWindowLevel servicesManager={servicesManager} />;
      },
    },
    {
      name: 'panelMeasurement',
      iconName: 'tab-linear',
      iconLabel: 'Measure',
      label: 'Measurement',
      component: PanelMeasurement,
    },
    {
      name: 'panelSegmentation',
      iconName: 'tab-segmentation',
      iconLabel: 'Segmentation',
      label: 'Segmentation',
      component: wrappedPanelSegmentation,
    },
    {
      name: 'panelSegmentationNoHeader',
      iconName: 'tab-segmentation',
      iconLabel: 'Segmentation',
      label: 'Segmentation',
      component: wrappedPanelSegmentationNoHeader,
    },
    {
      name: 'panelSegmentationWithToolsLabelMap',
      iconName: 'tab-segmentation',
      iconLabel: 'Segmentation',
      label: i18n.t('SegmentationPanel:Labelmap'),
      component: props =>
        wrappedPanelSegmentationWithTools({
          ...props,
          segmentationRepresentationTypes: [
            SegmentationRepresentations.Labelmap,
            SegmentationRepresentations.Surface,
          ],
        }),
    },
    {
      name: 'panelSegmentationWithToolsContour',
      iconName: 'tab-contours',
      iconLabel: 'Segmentation',
      label: i18n.t('SegmentationPanel:Contour'),
      component: props =>
        wrappedPanelSegmentationWithTools({
          ...props,
          segmentationRepresentationTypes: [SegmentationRepresentations.Contour],
        }),
    },
  ];
};

export default getPanelModule;
