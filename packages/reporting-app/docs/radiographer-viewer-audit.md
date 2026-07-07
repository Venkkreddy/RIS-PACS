# Radiographer Viewer Audit (Current State)

Date: 2026-06-26

## What Is Present Now
- Radiographer workstation embeds OHIF via iframe in `frontend/src/components/OhifViewerEmbed.tsx`.
- Exam workflow panel supports:
  - QC checklist persistence (`qcChecklist`, `qcStatus`, `workflowStatus`)
  - approve/reject/retake/complete actions
  - side marker and body-part stamp metadata patching
- Worklist + study linkage is active in `frontend/src/components/RadiographerWorkstation.tsx`.

## Viewer UX Changes Applied Today
- Removed external image-tool sidebars from radiographer page (left patient panel + right custom tools panel).
- Default viewer is now full-width/full-height with maximum imaging area.
- Removed duplicate wrapper header above OHIF and replaced it with a minimal back control overlay.
- Removed eye-icon workflow drawer from the radiographer wrapper to avoid duplicate side sliders.
- Moved tool ownership back inside OHIF viewer UI (no external pseudo-toolbar controls).

## OHIF Customization Applied Today
- Basic mode top toolbar section is hidden (`TOOLBAR_SECTIONS.primary = []`).
- Bottom-middle viewport action menu cleared (removes extra middle controls).
- Bottom-left action menu cleared.
- Core tools reassigned to right-middle viewport action menu:
  - WindowLevel, Zoom, Pan, MeasurementTools, MoreTools, Capture, Layout, Crosshairs.
- Viewport action corners set to always visible (no hover-only gating).

## Still Partial / Needs Product-Ready Hardening
- Side markers and body-part stamps are metadata-level today; not yet persisted as DICOM PR/GSPS overlays.
- Print path is not full DICOM Print SCU workflow yet.
- Crop/shutter/stitching still require dedicated OHIF extension work.
- End-to-end role validation and regression tests for radiographer workflows need formal test coverage.
- UX validation required across browser widths and multi-monitor radiographer setups.

## Files Changed Today
- `frontend/src/components/RadiographerWorkstation.tsx`
- `modes/basic/src/index.tsx`
- `extensions/cornerstone/src/components/OHIFViewportActionCorners.tsx`

## Recommended Validation Checklist
- Open radiographer workstation -> select exam -> confirm OHIF occupies max area by default.
- Confirm no external left/right tool overlays in workstation viewer surface.
- Confirm OHIF tools appear in right-side in-viewport icon menu.
- Confirm no bottom-middle extra controls/advertisement block.
- Confirm QC + retake actions still update backend fields correctly.
- Confirm worklist status transitions still function from scheduled -> in-progress -> qc -> ready-for-reporting.
