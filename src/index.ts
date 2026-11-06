// felt: a WebGL2 engine for card games.
//
// Everything phaser-card-engine did, without Phaser underneath it. The core -
// cards, stacks, hands, faces, courts, shuffles, the tuck box as numbers - is
// re-exported unchanged from `felt/core`, which draws nothing and runs in
// node. Everything else here is the engine: a board, a renderer that draws
// every card on it in one instanced call, the art painted into one atlas, and
// the gestures - throwing, dealing, re-fanning, flipping, riffling.
export * from './core/index.js';

export { Board, createBoard } from './scene/board.js';
export type { BoardOptions, BoardPointer, BoardMesh, TextStyle } from './scene/board.js';
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
export { courtWorkerSupported, disposeCourtWorker } from './art/court-worker.js';
export { renderTuckBox, tuckBoxTextureKey } from './art/tuck-box-art.js';
export type { TuckBoxArt } from './art/tuck-box-art.js';

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
export { TuckBox, supportsTuckBox } from './play/tuck-box.js';
export type { TuckBoxOptions } from './play/tuck-box.js';
export { HandZone, Pile, Table, Zone, createTable } from './table/table.js';
export type {
  Accepts, CanTake, DragOptions, FlickRelease, TableDealOptions, HandOptions, MoveCause, MoveOptions, PileOptions, SyncOptions,
  TableMove, TableOptions, TableTap, ZoneRules,
} from './table/table.js';
