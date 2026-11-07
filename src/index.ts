// felt: a WebGL2 engine for card games.
//
// Everything phaser-card-engine did, without Phaser underneath it. The core -
// cards, stacks, hands, faces, courts, shuffles - is
// re-exported unchanged from `felt/core`, which draws nothing and runs in
// node. Everything else here is the engine: a board, a renderer that draws
// every card on it in one instanced call, the art painted into one atlas, and
// the gestures - throwing, dealing, re-fanning, flipping, riffling.
export * from './core/index.js';

export { Board, createBoard } from './scene/board.js';
export type { BoardOptions, BoardPointer, TextStyle } from './scene/board.js';
export { Node } from './scene/node.js';
export { Sprite } from './scene/sprite.js';
export type { SpriteOptions } from './scene/sprite.js';
export { Tween, Tweens } from './scene/tweens.js';
export { fpsMeter } from './scene/fps.js';
export { PickUp } from './scene/pick-up.js';
export type { Liftable, PickUpOptions } from './scene/pick-up.js';
export { Engine, createEngine, engine, serviceOf } from './runtime/engine.js';
export type { EngineEvent, EngineMember, EngineOptions } from './runtime/engine.js';
export { ManualClock, RafClock } from './runtime/clock.js';
export type { Clock } from './runtime/clock.js';
export { Disposables } from './runtime/disposables.js';
export type { Dispose } from './runtime/disposables.js';
export { PageLifecycle } from './runtime/lifecycle.js';
export { Director, defineScene } from './runtime/scene.js';
export { Rng, Simulation } from './runtime/simulation.js';
export type { Rules, Snapshot, Stamped, StepContext, SimulationOptions } from './runtime/simulation.js';
export type { DirectorOptions, GoOptions, Scene, SceneContext } from './runtime/scene.js';
export type { LifecycleEvent, LifecycleHost } from './runtime/lifecycle.js';
export { CONTEXT_RESTORE_WAIT_MS } from './scene/board.js';
export type { FpsMeter } from './scene/fps.js';
export type { TweenConfig } from './scene/tweens.js';
export { easeOf } from './scene/ease.js';
export type { Ease } from './scene/ease.js';

export { Atlas } from './gl/atlas.js';
export type { Region, Painter } from './gl/atlas.js';
export { Renderer } from './gl/renderer.js';
export { lensDistance, project, cardRotation, unprojectOntoPlane } from './gl/lens.js';
// Lighting and materials for the 3D cards.
export {
  DEFAULT_LIGHT, Lighting, MATERIALS, MATERIAL_SLOTS, MAX_SHADOW_REACH, MIN_ELEVATION, SHEEN_POWER,
  defineMaterial, diffuseShade, lightDirection, packMaterial, projectOntoTable, restingShadowHeight,
  shadowOffset, shadowReach, shadowSpread, specularAt,
} from './gl/lighting.js';
export type { CardMaterial, Light, LightOptions, LightingUniforms } from './gl/lighting.js';

export { CardSprite } from './art/card-sprite.js';
export { cardsReady, loadingReport } from './art/loading.js';
export { PERSISTED_ART_VERSION, PersistedArt } from './art/persisted-art.js';
export type { LoadingReport, LoadingStage, LoadingStageId } from './art/loading.js';
export type { ArtKind, ArtStatus } from './art/card-art.js';
export { BackSheet, CardSheets, FaceSheet, resolveStyle } from './art/card-sheets.js';
export type { CardStyle, ResolvedStyle } from './art/card-sheets.js';
export {
  ArtStore, CardArt, STANDARD_SUIT_ART, loadCardArt, preloadCardArt, suitTexture, ensureArt,
} from './art/card-art.js';
export type { CardArtOptions, CourtCaches } from './art/card-art.js';
export { courtTextureKey, renderCourt, renderCourts } from './art/court-art.js';
export type { RenderCourtsOptions } from './art/court-art.js';
export { FELT_INKS, FeltPaint, loadSvg, paintFelt, paintFeltSvg } from './art/felt-paint.js';
export { BORDER_PATTERNS, border, paintFeltFrame } from './art/felt-borders.js';
export type { BorderOptions, BorderPattern, FrameOptions } from './art/felt-borders.js';
export type {
  DrawMark, FeltInk, FeltPaintOptions, ImageMark, Mark, PathMark, ShapeMark, TextMark,
} from './art/felt-paint.js';
export { courtWorkerSupported, disposeCourtWorker } from './art/court-worker.js';

export { flickCard, simulateFlick } from './play/flick.js';
export type { FlickOptions, FlickPath, FlickStep, Magnet } from './play/flick.js';
export {
  dealCards, flightDuration, landingsFor, popCard, shortestTurn, spinTarget, throwCard, throwLanding,
} from './play/flight.js';
export { Animator, animatorOf, zeroOffset } from './scene/animator.js';
export type { Canned, Offset, Policy } from './scene/animator.js';
export type { DealOptions, Movable, ThrowOptions, ThrowTarget, TweenHost } from './play/flight.js';
export { layHand, layPlaces, orderStack } from './play/order.js';
export type { LayHandOptions } from './play/order.js';
export { flipCard } from './play/flip.js';
export type { FlipOptions } from './play/flip.js';
export { RIFFLE_DEPTH, RIFFLE_HAND_DEPTH, riffleShuffle } from './play/riffle.js';
export type { RiffleOptions } from './play/riffle.js';
export { HandZone, Pile, Table, Zone, createTable } from './table/table.js';
export type {
  Accepts, CanTake, DragOptions, FlickRelease, TableDealOptions, HandOptions, MoveCause, MoveOptions, PileOptions, SyncOptions,
  TableMove, TableOptions, TableTap, ZoneRules,
} from './table/table.js';
export { HIGHLIGHT_STYLES, Highlights, highlights } from './table/highlight.js';
export type { Highlight, HighlightLook, HighlightOptions, HighlightStyle, HighlightTarget } from './table/highlight.js';
export { SelectionSet, decideTap, hintMove, legalMoves, legalTargets } from './table/moves.js';
export type {
  Carded, HintOptions, LegalMove, LegalMovesOptions, RuleZone, SelectionChange, Tap, TapAction, TapRules,
} from './table/moves.js';
export { Selection, selectable } from './table/selection.js';
export type { SelectableOptions, SelectionMove, ShowHintOptions } from './table/selection.js';
export {
  captureTable, cloneState, diffStates, isTableState, restoreTable, sameState, stateFits, tableFits,
} from './table/state.js';
export type { LooseCard, RestoreOptions, StateDiff, TableState } from './table/state.js';
export { History, createHistory, isSavedHistory } from './table/history.js';
export type {
  GameState, HistoryChange, HistoryOptions, HistoryStep, MoveRecord, SavedHistory,
} from './table/history.js';
export { GameSave, SAVE_FORMAT, autosave, createSave, decodeSave, encodeSave, memoryStore } from './table/save.js';
export type { AutosaveOptions, GameSaveOptions, SaveProblem, SaveRead, SaveStore, SavedGame } from './table/save.js';

// On-board readouts, toasts over the table and screen-reader announcements.
export { Readout, readout } from './ui/readout.js';
export type { ReadoutHost, ReadoutOptions } from './ui/readout.js';
export { GlyphCache, alignOffset, cssFont, glyphsOf, layoutLine, lineHeightOf } from './ui/glyphs.js';
export type { Glyph, GlyphCacheOptions, GlyphHost, GlyphPlace, GlyphStyle, LineLayout } from './ui/glyphs.js';
export { formatClock, formatNumber, parseColor } from './ui/format.js';
export type { ClockFormat, NumberFormat } from './ui/format.js';
export { Toaster, toastsOf } from './ui/toast.js';
export type { FloatOptions, ToastHandle, ToastOptions, ToasterOptions } from './ui/toast.js';
export { ToastQueue, durationFor } from './ui/toast-queue.js';
export type { ToastPhase, ToastPlace, ToastPolicy, ToastSpec, ToastState } from './ui/toast-queue.js';
export { AnnounceQueue, Announcer, announce, announcerOf } from './ui/announce.js';
export type { AnnounceOptions, AnnouncePolicy, Announcement, Politeness } from './ui/announce.js';
export { prefersReducedMotion } from './ui/motion.js';
export * from './pieces/index.js';
