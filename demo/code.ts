import type { SceneContext } from 'felt';

// The code a demo is running, on the demo.
//
// Not copies: each demo's own source, fetched as text, and the parts of it
// between `// #region Title` and `// #endregion` shown in a panel - so a
// snippet cannot drift from what the page does. Names the demo imports from
// 'felt' are picked out, since they are the engine's part.
//
// A "Code" button by the Demos link (bottom left, on a phone) opens it; on a wide screen it starts open
// beside the board.

const sources = import.meta.glob<string>(['./*.ts', '!./app.ts', '!./code.ts', '!./kit.ts', '!./serve.ts'],
  { query: '?raw', import: 'default' });

export interface Snippet {
  title: string;
  code: string;
}

/** The marked regions of a source file, dedented, with nested markers dropped. */
export function snippetsOf(source: string): Snippet[] {
  const out: Snippet[] = [];
  const open: { title: string; lines: string[] }[] = [];
  for (const line of source.split('\n')) {
    const start = /^\s*\/\/\s*#region\s+(.*)$/.exec(line);
    if (start) { open.push({ title: start[1].trim(), lines: [] }); continue; }
    if (/^\s*\/\/\s*#endregion/.test(line)) {
      const done = open.pop();
      if (done) out.push({ title: done.title, code: dedent(done.lines) });
      continue;
    }
    for (const region of open) region.lines.push(line);
  }
  return out;
}

function dedent(lines: string[]): string {
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

/** What a source imports from 'felt'. */
function feltNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'felt'/g)) {
    for (const name of m[1].split(',')) {
      const n = name.replace(/^\s*type\s+/, '').split(/\s+as\s+/).pop()!.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

const KEYWORDS = new Set(('const let var function return if else for of in while do break continue new class '
  + 'extends import export from as type interface async await void typeof instanceof true false null '
  + 'undefined this switch case default try catch finally throw readonly private public static').split(' '));

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A little TypeScript highlighting: enough to read, not a parser. */
function highlight(code: string, api: Set<string>): string {
  const token = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g;
  let html = '';
  let last = 0;
  for (const m of code.matchAll(token)) {
    html += escape(code.slice(last, m.index));
    last = m.index! + m[0].length;
    const text = escape(m[0]);
    if (m[1]) html += `<span class="c">${text}</span>`;
    else if (m[2]) html += `<span class="s">${text}</span>`;
    else if (m[3]) html += `<span class="n">${text}</span>`;
    else if (api.has(m[0])) html += `<span class="api">${text}</span>`;
    else if (KEYWORDS.has(m[0])) html += `<span class="k">${text}</span>`;
    else html += text;
  }
  return html + escape(code.slice(last));
}

const STYLE = `
.felt-code-toggle {
  position: fixed; top: 0.55rem; left: 5.6rem; z-index: 20;
  font-family: 'Cinzel', Georgia, serif; font-size: 0.66rem; letter-spacing: 0.05em; text-transform: uppercase;
  color: #fdfdfd; background: #17594a; border: 1px solid #cfead0; border-radius: 4px;
  padding: 0.28rem 0.5rem; line-height: 1; cursor: pointer;
}
.felt-code-toggle:hover, .felt-code-toggle:focus-visible, .felt-code-toggle[aria-expanded=true] { border-color: #ffd166; color: #ffd166; }
.felt-code {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 19; box-sizing: border-box;
  width: min(100vw, clamp(22rem, calc(50vw - 260px), 40rem));
  padding: 4.2rem 0.8rem 0.8rem; overflow: auto; overscroll-behavior: contain;
  background: rgba(8, 26, 20, 0.96); border-left: 1px solid #24594a; color: #cfead0;
  font-family: 'Jost', system-ui, sans-serif; text-align: left;
}
.felt-code[hidden] { display: none; }
.felt-code h2 {
  font-family: 'Cinzel', Georgia, serif; font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase;
  color: #fdfdfd; margin: 0 0 0.2rem;
}
.felt-code > p { font-size: 0.72rem; color: #9fc4a4; margin: 0 0 0.8rem; text-align: left; max-width: none; }
.felt-code details { margin: 0 0 0.6rem; border: 1px solid #24594a; border-radius: 4px; background: #0b2119; }
.felt-code summary {
  cursor: pointer; padding: 0.35rem 0.55rem; font-size: 0.74rem; color: #ffd166; list-style-position: inside;
}
.felt-code pre {
  margin: 0; padding: 0.55rem 0.7rem 0.7rem; overflow-x: auto; border-top: 1px solid #1a4438;
  font: 0.7rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: #dfeee0; tab-size: 2;
}
.felt-code .c { color: #6f9a7a; font-style: italic; }
.felt-code .s { color: #f2b880; }
.felt-code .n { color: #c9a8ff; }
.felt-code .k { color: #7fc8d8; }
.felt-code .api { color: #ffd166; font-weight: 600; }
/* A phone has no room beside the title: the corner below instead. */
@media (max-width: 700px) {
  .felt-code-toggle { top: auto; bottom: 0.55rem; left: 0.6rem; }
  .felt-code { width: 100vw; border-left: 0; }
}
`;

/** Wide enough to show the code beside a demo's board without covering it. */
const WIDE = '(min-width: 1180px)';

/**
 * Puts the code panel on a demo: its marked regions, from its own source.
 * Everything it adds is inside the scene's root, so it goes with the scene.
 */
export function showCode(ctx: SceneContext, name = ctx.name): void {
  const load = sources[`./${name}.ts`];
  if (!load) return;
  const style = document.createElement('style');
  style.textContent = STYLE;
  const toggle = document.createElement('button');
  toggle.className = 'felt-code-toggle';
  toggle.type = 'button';
  toggle.textContent = '</> Code';
  const panel = document.createElement('aside');
  panel.className = 'felt-code';
  panel.setAttribute('aria-label', 'The code this demo runs');
  panel.id = `felt-code-${name}`;
  toggle.setAttribute('aria-controls', panel.id);
  const open = (shown: boolean) => {
    panel.hidden = !shown;
    toggle.setAttribute('aria-expanded', String(shown));
  };
  open(matchMedia(WIDE).matches);
  ctx.listen(toggle, 'click', () => open(panel.hidden));
  ctx.root.append(style, toggle, panel);

  void load().then((source) => {
    if (!panel.isConnected) return;
    const api = feltNames(source);
    const snippets = snippetsOf(source);
    panel.innerHTML = `<h2>The code</h2><p>From <code>demo/${name}.ts</code>, as it runs on this page.`
      + ' Gold names are felt\'s.</p>'
      + snippets.map((s, i) => `<details${i < 3 ? ' open' : ''}><summary>${escape(s.title)}</summary>`
        + `<pre><code>${highlight(s.code, api)}</code></pre></details>`).join('');
  });
}
