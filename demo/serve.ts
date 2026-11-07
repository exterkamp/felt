import { setCardAssetBase } from '@exterkamp/felt';

// Where this copy of the demo is served from.
//
// Imported for its effect, first, by every page: it has to run before a board
// loads anything. Vite fills BASE_URL with `/` for the dev server and with
// the project path for the published build, so the same source works at
// localhost and under github.io/felt/ without either one knowing which it is.
setCardAssetBase(`${import.meta.env.BASE_URL}cards`);
