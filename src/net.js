// Bun's fetch races IPv4 and IPv6 per connection, so back-to-back requests to one host can
// leave from different addresses on a dual-stack machine. Stream hosts bind tokens to the
// client IP (vidsrc signs the v4 address or v6 /64 into both its api token and its segment
// token), so a family flip between scraping and playback — or mid-playback — is a 403.
// This pins every outbound fetch to IPv4, which is what a v4-only host or Docker network
// does anyway. Imported first by index.js so providers and p-stream all go through it.
import { isIP } from "node:net";

const nativeFetch = globalThis.fetch;
const MAX_REDIRECTS = 10;

async function ipv4(hostname) {
  try {
    const [first] = await Bun.dns.lookup(hostname, { family: 4 });
    return first?.address || null;
  } catch {
    return null;
  }
}

async function pinnedFetch(input, init = {}) {
  // Request objects carry their own body/headers; nothing in this app builds them
  if (input instanceof Request) return nativeFetch(input, init);

  let url = new URL(String(input));
  let { method = "GET", body } = init;
  const follow = (init.redirect ?? "follow") === "follow";

  for (let hop = 0; ; hop++) {
    const host = url.hostname;
    const address = isIP(host) || !/^https?:$/.test(url.protocol) ? null : await ipv4(host);
    let res;
    if (!address) {
      res = await nativeFetch(url, { ...init, method, body, redirect: "manual" });
    } else {
      const target = new URL(url);
      target.hostname = address;
      const headers = new Headers(init.headers);
      headers.set("Host", url.host);
      res = await nativeFetch(target, {
        ...init,
        method,
        body,
        headers,
        redirect: "manual",
        // certificate is still verified, against the real hostname
        tls: { ...init.tls, serverName: host },
      });
    }

    const location = res.headers.get("location");
    const isRedirect = location && res.status >= 300 && res.status < 400 && res.status !== 304;
    if (isRedirect && init.redirect === "error") throw new TypeError("fetch failed: unexpected redirect");
    if (!follow || !isRedirect) {
      Object.defineProperty(res, "url", { value: url.href });
      if (hop) Object.defineProperty(res, "redirected", { value: true });
      return res;
    }
    if (hop >= MAX_REDIRECTS) throw new TypeError("fetch failed: too many redirects");
    res.body?.cancel();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
    url = new URL(location, url);
  }
}

globalThis.fetch = pinnedFetch;
