import './serve';
import { Director, Scene, defineScene, engine } from 'felt';

// The demo as one page.
//
// Each demo is a scene. On its own page (stacks.html) it runs alone; here
// the index is a scene too, and following a tile changes scene rather than
// navigating. So the engine - its loop, and every piece of art it has
// fetched and painted - lives for the whole visit, and going from one demo to
// the next is a new board on a warm engine instead of a cold page. The hash
// (#/stacks) says which scene is showing, so back, forward and reload work.

// Before any scene module runs: tells them not to start themselves.
(window as unknown as { __feltApp: boolean }).__feltApp = true;

const modules = import.meta.glob<{ scene: Scene<never> }>(
  ['./*.ts', '!./app.ts', '!./code.ts', '!./kit.ts', '!./serve.ts']);
const pages = import.meta.glob<string>('./*.html', { query: '?raw', import: 'default' });
const nameOf = (path: string) => path.replace(/^.*\//, '').replace(/\.(ts|html)$/, '');
const available = new Set(Object.keys(modules).map(nameOf));

/** A page's markup as a scene's: its styles and its body, without its scripts. */
function sceneMarkup(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = [...doc.querySelectorAll('style')].map((style) => style.outerHTML).join('\n');
  for (const script of doc.querySelectorAll('script')) script.remove();
  return `${styles}\n${doc.body.innerHTML}`;
}

// The index, taken from this page: its styles move into the scene so they
// apply only while it is showing, not over every demo.
const indexStyles = [...document.head.querySelectorAll('style')];
const indexHtml = indexStyles.map((style) => style.outerHTML).join('\n') + document.body.innerHTML;
for (const style of indexStyles) style.remove();
document.body.innerHTML = '';

const director = new Director(document.body, [
  defineScene({ name: 'index', title: 'felt', html: indexHtml, create() {} }),
], { hash: true });

const titles = new Map<string, string>();

/** Loads a demo's scene the first time it is wanted, then goes to it. */
async function open(name: string): Promise<void> {
  if (name !== 'index' && !director.has(name)) {
    if (!available.has(name)) return;
    const [module, page] = await Promise.all([modules[`./${name}.ts`](), pages[`./${name}.html`]()]);
    titles.set(name, /<title>([^<]*)<\/title>/.exec(page)?.[1] ?? `felt — ${name}`);
    director.add({ ...module.scene, html: sceneMarkup(page) });
  }
  await director.go(name, undefined, { fade: 120 });
  document.title = titles.get(name) ?? 'felt';
  window.scrollTo(0, 0);
}

// Links between demos become scene changes. Anything else is left alone.
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const link = (event.target as Element).closest('a');
  if (!link || link.origin !== location.origin) return;
  const file = link.pathname.replace(/^.*\//, '');
  const name = file === '' || file === 'index.html' ? 'index' : file.replace(/\.html$/, '');
  if (name !== 'index' && !available.has(name)) return;
  event.preventDefault();
  void open(name);
});

// Back and forward, through the hash.
window.addEventListener('hashchange', () => {
  void open(/^#\/([\w-]+)/.exec(location.hash)?.[1] ?? 'index');
});

void open(/^#\/([\w-]+)/.exec(location.hash)?.[1] ?? 'index');

(window as unknown as { __feltApp: unknown }).__feltApp = { director, engine: engine(), open };
