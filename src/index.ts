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
export type { TweenConfig } from './scene/tweens.js';
export { easeOf } from './scene/ease.js';
export type { Ease } from './scene/ease.js';

export { Atlas } from './gl/atlas.js';
export type { Region, Painter } from './gl/atlas.js';
export { Renderer } from './gl/renderer.js';
export { lensDistance, project, cardRotation, unprojectOntoPlane } from './gl/lens.js';

export { CardSprite } from './art/card-sprite.js';
export type { CardStyle } from './art/card-sprite.js';
export {
  CardArt, STANDARD_SUIT_ART, loadCardArt, preloadCardArt, suitTexture, ensureArt,
} from './art/card-art.js';
export type { CardArtOptions } from './art/card-art.js';
export { courtTextureKey, renderCourt, renderCourts } from './art/court-art.js';
export type { RenderCourtsOptions } from './art/court-art.js';
export { courtWorkerSupported, disposeCourtWorker } from './art/court-worker.js';
export { renderTuckBox, tuckBoxTextureKey } from './art/tuck-box-art.js';
export type { TuckBoxArt } from './art/tuck-box-art.js';

export {
  dealCards, flightDuration, landingsFor, shortestTurn, spinTarget, throwCard, throwLanding,
} from './play/flight.js';
export type { DealOptions, Movable, ThrowOptions, ThrowTarget, TweenHost } from './play/flight.js';
export { layHand, orderStack } from './play/order.js';
export type { LayHandOptions } from './play/order.js';
export { flipCard } from './play/flip.js';
export type { FlipOptions } from './play/flip.js';
export { RIFFLE_DEPTH, RIFFLE_HAND_DEPTH, riffleShuffle } from './play/riffle.js';
export type { RiffleOptions } from './play/riffle.js';
export { TuckBox, supportsTuckBox } from './play/tuck-box.js';
export type { TuckBoxOptions } from './play/tuck-box.js';
