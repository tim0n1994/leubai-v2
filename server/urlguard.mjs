// URL validation for user-supplied upstream endpoints.
// Allowed: loopback HTTP/HTTPS (intentional local testing) and public HTTPS.
// Forbidden: credentials in URL, query/hash, other schemes, and after
// canonicalization any private, reserved, multicast, link-local/metadata or
// unspecified host (including IPv4-mapped IPv6 in dotted or hex form).

export class UpstreamUrlError extends Error {
  constructor(code) {
    super(code);
    this.name = "UpstreamUrlError";
    this.code = code;
  }
}

export function stripBrackets(hostname) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function isLoopbackHostname(hostname) {
  const h = stripBrackets(hostname);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (h === "::1") return true;
  if (h.startsWith("::ffff:")) {
    const mapped = ipv4FromMapped(h);
    if (mapped) return isLoopbackIpv4(mapped);
  }
  return false;
}

function isBlockedHost(hostname) {
  const h = stripBrackets(hostname);
  // IPv4-mapped IPv6, both dotted (::ffff:169.254.169.254) and canonical hex
  // (::ffff:a9fe:a9fe) forms produced by WHATWG URL normalization.
  if (h.startsWith("::ffff:")) {
    const mapped = ipv4FromMapped(h);
    if (mapped) {
      if (isLoopbackIpv4(mapped)) return false; // intentional loopback stays allowed
      return isPrivateOrReservedIpv4(mapped);
    }
    return true; // malformed mapped form: fail closed
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    if (isLoopbackIpv4(octets)) return false;
    return isPrivateOrReservedIpv4(octets);
  }
  if (h.includes(":")) {
    if (h === "::") return true; // unspecified
    if (/^f[cd]/.test(h)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  }
  return false;
}

function isLoopbackIpv4(octets) {
  return octets[0] === 127;
}

function isPrivateOrReservedIpv4([a, b]) {
  if (a === 0) return true; // this-network / unspecified
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv4FromMapped(h) {
  const tail = h.slice("::ffff:".length);
  if (tail.includes(".")) {
    const parts = tail.split(".").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return parts;
    }
    return null;
  }
  const groups = tail.split(":");
  if (groups.length !== 2) return null;
  if (groups.some((g) => g.length === 0 || g.length > 4 || /[^0-9a-f]/.test(g))) return null;
  const a = parseInt(groups[0], 16);
  const b = parseInt(groups[1], 16);
  return [a >> 8, a & 0xff, b >> 8, b & 0xff];
}

export function validateUpstreamUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new UpstreamUrlError("invalid_url");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    const retry = bracketUnbracketedIpv6Host(raw);
    if (!retry) throw new UpstreamUrlError("invalid_url");
    try {
      url = new URL(retry);
    } catch {
      throw new UpstreamUrlError("invalid_url");
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UpstreamUrlError("invalid_url");
  }
  if (url.username || url.password) throw new UpstreamUrlError("credentials_in_url");
  if (url.search) throw new UpstreamUrlError("query_not_allowed");
  if (url.hash) throw new UpstreamUrlError("hash_not_allowed");
  if (isBlockedHost(url.hostname)) throw new UpstreamUrlError("blocked_host");
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new UpstreamUrlError("https_required");
  }
  return url;
}

export function validateCandidate(candidate) {
  const errors = [];
  const protocol = candidate && candidate.protocol;
  if (protocol !== "anthropic" && protocol !== "openai") {
    errors.push({ field: "protocol", code: "protocol_invalid" });
  }
  const urls = {};
  for (const field of ["baseUrl", "messagesUrl", "modelsUrl"]) {
    try {
      urls[field] = validateUpstreamUrl(candidate ? candidate[field] : undefined);
    } catch (err) {
      errors.push(field + ":" + (err.code || "invalid_url"));
    }
  }
  const model = candidate && candidate.model;
  if (typeof model !== "string" || model.trim().length === 0 || model.length > 200) {
    errors.push("model:model_required");
  }
  if (urls.baseUrl && urls.messagesUrl && urls.baseUrl.origin !== urls.messagesUrl.origin) {
    errors.push("messagesUrl:origin_mismatch");
  }
  if (urls.baseUrl && urls.modelsUrl && urls.baseUrl.origin !== urls.modelsUrl.origin) {
    errors.push("modelsUrl:origin_mismatch");
  }
  return { ok: errors.length === 0, errors };
}

function bracketUnbracketedIpv6Host(raw) {
  const schemeEnd = raw.indexOf("://");
  if (schemeEnd < 0) return null;
  const rest = raw.slice(schemeEnd + 3);
  const slash = rest.search(/[/?#]/);
  const host = slash < 0 ? rest : rest.slice(0, slash);
  if (!host || host.includes("[") || host.includes("]")) return null;
  const colons = (host.match(/:/g) || []).length;
  if (colons < 2) return null;
  const tail = slash < 0 ? "" : rest.slice(slash);
  return raw.slice(0, schemeEnd + 3) + "[" + host + "]" + tail;
}
