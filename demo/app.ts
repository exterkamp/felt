
// The demo as one page.
//
// Each demo is a scene. On its own page (stacks.html) it runs alone; here
// the index is a scene too, and following a tile changes scene rather than
// navigating. So the engine - its loop, and every piece of art it has
// fetched and painted - lives for the whole visit, and going from one demo to
// the next is a new board on a warm engine instead of a cold page.
//
// The router says which scene a URL is: `/felt/stacks` is the stacks demo,
// with no `#` in it, so back, forward, reload and a pasted link all land on
// the same scene. Any page can start this: index.html does, and so does a
// demo's own page reached at its clean path (GitHub Pages serves
// stacks.html for /stacks) - see standalone() in kit.ts.

import './serve';
import { Director, Route, Scene, createRouter, defineScene, engine } from '@exterkamp/felt';

// Before any scene module runs: tells them not to start themselves.
(window as unknown as { __feltApp: unknown }).__feltApp = true;

const modules = import.meta.glob<{ scene: Scene<never> }>(
  ['./*.ts', '!./app.ts', '!./code.ts', '!./kit.ts', '!./serve.ts', '!./bench-core.ts']);
const pages = import.meta.glob<string>('./*.html', { query: '?raw', import: 'default' });
const nameOf = (path: string) => path.replace(/^.*\//, '').replace(/\.(ts|html)$/, '');

/** A page's markup as a scene's: its styles and its body, without its scripts. */
function sceneMarkup(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = [...doc.querySelectorAll('style')].map((style) => style.outerHTML).join('\n');
  for (const script of doc.querySelectorAll('script')) script.remove();
  return `${styles}\n${doc.body.innerHTML}`;
}

const titleOf = (html: string, name: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? `felt — ${name}`;

/** A demo page as a scene, its markup and title from its own .html. */
async function demoScene(name: string, load: () => Promise<{ scene: Scene<never> }>): Promise<Scene<never>> {
  const [module, page] = await Promise.all([load(), pages[`./${name}.html`]()]);
  titles.set(name, titleOf(page, name));
  return { ...module.scene, html: sceneMarkup(page) };
}

const titles = new Map<string, string>();

export async function startApp(): Promise<void> {
  // The index from this document when it is the index - at once, nothing to
  // fetch - and from its own file when the app was started by a demo's page.
  const here = !!document.querySelector('a.demo');
  const index = here
    ? [...document.head.querySelectorAll('style')].map((style) => style.outerHTML).join('\n') + document.body.innerHTML
    : sceneMarkup(await pages['./index.html']());
  titles.set('index', here ? document.title : titleOf(await pages['./index.html'](), 'index'));
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  document.body.innerHTML = '';

  const director = new Director(document.body, [
    defineScene({ name: 'index', html: index, create() {} }),
  ]);

  // #region Routes
  const routes: Route[] = [
    { path: '/', scene: 'index', title: () => titles.get('index')! },
    // One route a demo, loaded the first time it is wanted. A demo's .html
    // name still works, for links from before the paths were clean.
    ...Object.entries(modules).flatMap(([path, load]): Route[] => {
      const name = nameOf(path);
      if (!pages[`./${name}.html`]) return [];
      return [
        { path: `/${name}`, scene: () => demoScene(name, load), title: () => titles.get(name) ?? `felt — ${name}` },
        { path: `/${name}.html`, redirect: `/${name}` },
      ];
    }),
    { path: '/index.html', redirect: '/' },
    { path: '*', redirect: '/' },
  ];
  const router = createRouter(director, { base: import.meta.env.BASE_URL, routes, fade: 120 });
  await router.start();
  // #endregion

  (window as unknown as { __feltApp: unknown }).__feltApp = { director, router, engine: engine() };
}
