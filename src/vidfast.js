import vm from "node:vm";
import { Window } from "happy-dom";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidfast.vc";
const TIMEOUT = 20000;
const SOFT_TIMEOUT = 6000;
const REACT_ID = 2115;
const JSX_ID = 5155;
const NAV_ID = 63;

const scriptCache = new Map();

function getScript(path) {
  if (!scriptCache.has(path)) {
    if (scriptCache.size > 40) scriptCache.clear();
    const p = fetch(BASE + path, { headers: { "User-Agent": UA, Referer: BASE + "/" } })
      .then((r) => {
        if (!r.ok) throw new Error("chunk " + r.status);
        return r.text();
      })
      .then((code) => new vm.Script(code, { filename: path }));
    p.catch(() => scriptCache.delete(path));
    scriptCache.set(path, p);
  }
  return scriptCache.get(path);
}

function parsePage(html) {
  const chunks = [...html.matchAll(/<script src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)]
    .map((m) => m[1])
    .filter((p) => !/\/(webpack|polyfills|main-app)-/.test(p));
  let rsc = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { rsc += JSON.parse(m[1]); } catch {}
  }
  const rows = new Map();
  for (const line of rsc.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) rows.set(line.slice(0, i), line.slice(i + 1));
  }
  let props = null;
  let moduleId = null;
  for (const val of rows.values()) {
    if (!val.includes('"en":')) continue;
    try {
      const arr = JSON.parse(val);
      if (!arr?.[3]?.en) continue;
      props = arr[3];
      const ref = rows.get(String(arr[1]).replace(/^\$L/, ""));
      const im = ref?.match(/^I\[(\d+),(\[.*?\])/);
      if (im) {
        moduleId = Number(im[1]);
        const list = JSON.parse(im[2]);
        for (let k = 1; k < list.length; k += 2) {
          const p = "/_next/" + list[k];
          if (!chunks.includes(p)) chunks.push(p);
        }
      }
      break;
    } catch {}
  }
  if (!props || moduleId == null) throw new Error("player props not found");
  for (const k in props) if (props[k] === "$undefined") props[k] = undefined;
  return { props, moduleId, chunks };
}

function sameDeps(a, b) {
  return a && b && a.length === b.length && a.every((d, k) => Object.is(d, b[k]));
}

function runPlayer(pagePath, page, scripts) {
  return new Promise((resolve) => {
    const win = new Window({ url: BASE + pagePath });
    const streams = [];
    let servers = null;
    let pendingServers = 0;
    let finished = false;
    let frozen = false;
    let idleTimer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      setTimeout(() => { try { win.happyDOM.abort(); win.close(); } catch {} }, 0);
      resolve(streams);
    };
    const hardTimer = setTimeout(finish, TIMEOUT);
    const serverDone = () => {
      pendingServers--;
      if (servers && pendingServers <= 0) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, 300);
      }
    };

    const ctx = {};
    for (const k of Object.getOwnPropertyNames(globalThis)) {
      try { ctx[k] = globalThis[k]; } catch {}
    }
    for (const k of Object.getOwnPropertyNames(win)) {
      if (k in ctx && !/^(HTML|Event|Node|Element|Document|Custom|Mutation|Storage|Media)/.test(k)) continue;
      try { if (win[k] !== undefined) ctx[k] = win[k]; } catch {}
    }
    const noop = () => {};
    Object.assign(ctx, {
      console: { log: noop, info: noop, warn: noop, error: noop, debug: noop, table: noop, clear: noop, trace: noop, dir: noop },
      document: win.document,
      location: win.location,
      localStorage: win.localStorage,
      sessionStorage: win.sessionStorage,
      parent: { postMessage: noop },
      navigator: {
        userAgent: UA, language: "en-US", languages: ["en-US"], platform: "Linux x86_64",
        vendor: "Google Inc.", maxTouchPoints: 0, cookieEnabled: true, webdriver: false,
        plugins: { length: 0, namedItem: () => null },
      },
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24 },
      innerWidth: 1920,
      innerHeight: 1080,
    });
    ctx.window = ctx;
    ctx.self = ctx;
    ctx.top = ctx;
    ctx.globalThis = ctx;
    ctx.fetch = async (input, opts = {}) => {
      if (finished) throw new Error("aborted");
      let url = typeof input === "string" ? input : input?.url || String(input);
      if (url.startsWith("/")) url = BASE + url;
      const h = new Headers(opts.headers);
      h.set("User-Agent", UA);
      if (!h.has("Referer")) h.set("Referer", BASE + pagePath);
      const srv = servers && servers.find((s) => !s.seen && s.data && url.endsWith("/" + s.data));
      const isStream = !!srv;
      if (srv) srv.seen = true;
      try {
        const r = await fetch(url, { ...opts, signal: undefined, headers: h });
        if (isStream && r.status !== 200) serverDone();
        if (!servers && r.status >= 400) {
          if (r.status === 429) console.log("[vidfast] rate limited");
          setTimeout(() => { if (!servers) finish(); }, 1000);
        }
        return r;
      } catch (e) {
        if (isStream) serverDone();
        throw e;
      }
    };

    const hooks = [];
    let hi = 0;
    let pending = [];
    let queued = false;
    let renders = 0;
    let comp = null;

    const onStream = (v) => {
      if (!v.url || streams.some((s) => s.url === v.url)) return serverDone();
      streams.push(v);
      serverDone();
    };

    const fanOut = () => {
      pendingServers = servers.length;
      setTimeout(() => { if (streams.length) finish(); }, SOFT_TIMEOUT);
      const h = hooks[servers.hook];
      for (let k = 0; k < servers.length; k++) {
        h.v = servers.map((s, j) => ({ ...s, selected: j === k, failed: false }));
        render(true);
      }
    };

    const React = {
      useState(init) {
        const i = hi++;
        if (!(i in hooks)) hooks[i] = { v: typeof init === "function" ? init() : init };
        const h = hooks[i];
        h.set ||= (nv) => {
          if (frozen) return;
          const v = typeof nv === "function" ? nv(h.v) : nv;
          if (Object.is(v, h.v)) return;
          h.v = v;
          if (!servers && Array.isArray(v) && v.length && v.every((s) => s && typeof s.data === "string" && "name" in s)) {
            servers = v.map((s) => ({ ...s }));
            servers.hook = i;
            frozen = true;
            setTimeout(fanOut, 0);
            return;
          }
          queue();
        };
        return [h.v, h.set];
      },
      useReducer(red, init, fn) {
        const [s, set] = React.useState(fn ? () => fn(init) : init);
        return [s, (a) => set((p) => red(p, a))];
      },
      useRef(init) {
        const i = hi++;
        if (!(i in hooks)) {
          let cur = init === undefined ? win.document.createElement("video") : init;
          hooks[i] = {
            get current() { return cur; },
            set current(v) {
              if (v && typeof v === "object" && typeof v.url === "string" && "tmdbId" in v) onStream(v);
              cur = v;
            },
          };
        }
        return hooks[i];
      },
      useEffect(fn, deps) {
        const i = hi++;
        const p = hooks[i];
        if (!p || !deps || !sameDeps(deps, p.deps)) pending.push(fn);
        hooks[i] = { deps };
      },
      useLayoutEffect(fn, deps) { React.useEffect(fn, deps); },
      useInsertionEffect() {},
      useCallback(fn) { hi++; return fn; },
      useMemo(fn, deps) {
        const i = hi++;
        const p = hooks[i];
        if (!p || !deps || !sameDeps(deps, p.deps)) hooks[i] = { v: fn(), deps };
        return hooks[i].v;
      },
      useContext(c) { return c?._v ?? {}; },
      useId() { return ":r0:"; },
      useSyncExternalStore(s, g) { return g(); },
      useTransition() { return [false, (f) => f()]; },
      useDeferredValue(v) { return v; },
      createContext(v) { return { _v: v, Provider: () => null, Consumer: () => null }; },
      forwardRef: (f) => f,
      memo: (f) => f,
      lazy: () => () => null,
      createElement: () => null,
      cloneElement: () => null,
      isValidElement: () => false,
      Fragment: "F",
      Suspense: "S",
      Children: { map: () => [], toArray: () => [], only: (x) => x, count: () => 0, forEach() {} },
      startTransition: (f) => f(),
      Component: class {},
      PureComponent: class {},
      version: "19.0.0",
    };
    React.default = React;

    function queue() {
      if (queued || frozen || finished) return;
      queued = true;
      setTimeout(() => render(false), 0);
    }

    function render(force) {
      queued = false;
      if (finished || (frozen && !force) || ++renders > 80) return;
      hi = 0;
      try { comp(page.props); } catch {}
      const p = pending;
      pending = [];
      for (const fn of p) {
        try { fn(); } catch {}
      }
    }

    try {
      const vctx = vm.createContext(ctx);
      const mods = {};
      ctx.webpackChunk_N_E = { push: ([, m]) => Object.assign(mods, m) };
      for (const s of scripts) s.runInContext(vctx, { timeout: 15000 });

      const overrides = {
        [REACT_ID]: React,
        [JSX_ID]: { jsx: () => null, jsxs: () => null, Fragment: "F" },
        [NAV_ID]: {
          useRouter: () => ({ push: noop, replace: noop, back: noop, prefetch: noop, refresh: noop }),
          usePathname: () => pagePath,
          useSearchParams: () => new URLSearchParams(),
          useParams: () => ({}),
        },
      };
      const cache = {};
      const stub = new Proxy(function () {}, { get: (t, k) => (k === "__esModule" ? false : stub), apply: () => stub });
      const req = (id) => {
        if (id in overrides) return overrides[id];
        if (cache[id]) return cache[id].exports;
        const mod = (cache[id] = { exports: {} });
        if (!mods[id]) return (mod.exports = stub);
        mods[id].call(mod.exports, mod, mod.exports, req);
        return mod.exports;
      };
      req.d = (e, t) => {
        for (const k in t) if (!Object.prototype.hasOwnProperty.call(e, k)) Object.defineProperty(e, k, { enumerable: true, get: t[k] });
      };
      req.r = (e) => Object.defineProperty(e, "__esModule", { value: true });
      req.n = (e) => { const g = e && e.__esModule ? () => e.default : () => e; req.d(g, { a: g }); return g; };
      req.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t);
      req.g = ctx;
      req.e = () => Promise.resolve();
      req.t = (v) => v;

      const exp = req(page.moduleId);
      comp = exp?.default || exp;
      if (typeof comp !== "function") throw new Error("player component not found");
      render(false);
    } catch (e) {
      console.log("[vidfast] sandbox error:", e.message);
      finish();
    }
  });
}

export async function vidfastExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const pagePath = isTV ? `/tv/${tmdbId}/${season}/${episode}` : `/movie/${tmdbId}`;
    const resp = await fetch(BASE + pagePath, { headers: { "User-Agent": UA } });
    if (!resp.ok) throw new Error("page " + resp.status);
    const page = parsePage(await resp.text());
    const scripts = await Promise.all(page.chunks.map(getScript));
    const found = await runPlayer(pagePath, page, scripts);

    return found.map((s) => ({
      url: s.url,
      type: s.mp4 || /\.mp4(\?|$)/i.test(s.url) ? "file" : "hls",
      provider: "vidfast",
      providerName: "VidFast",
      ...(s.noReferrer ? {} : { headers: { Referer: BASE + "/", Origin: BASE } }),
    }));
  } catch (e) {
    console.log("[vidfast] error:", e.message);
    return [];
  }
}
