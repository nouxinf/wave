// Turns src/index.html into one data URI. Run: node build.mjs
//   SAFE=1 node build.mjs   skip terser's "unsafe" transforms
//   ROAD=0 node build.mjs   skip roadroller (npm i roadroller to enable it)
//   ROAD=2 node build.mjs   slower, tighter roadroller search
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { minify } from "terser";

const LIMIT = 3072;
const SAFE = process.env.SAFE === "1";
const ROAD = process.env.ROAD ?? "1";
const src = readFileSync("src/index.html", "utf8");

// Squeeze shaders written as glsl`...` (terser leaves strings alone).
function glsl(code) {
  return code
    .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([-+*\/=<>(){}\[\];,!&|?:])\s*/g, "$1")
    .replace(/\b0\.(\d)/g, ".$1") // 0.5 -> .5
    .replace(/(\d)\.0(?![\w.])/g, "$1.") // 1.0 -> 1.
    .replace(/;}/g, "}")
    .trim();
}

const TERSER = {
  toplevel: true,
  ecma: 2022,
  compress: {
    passes: 10,
    keep_fargs: false,
    pure_getters: true,
    hoist_funs: true,
    ...(SAFE
      ? {}
      : {
          unsafe: true,
          unsafe_arrows: true,
          unsafe_comps: true,
          unsafe_math: true,
          unsafe_methods: true,
          unsafe_proto: true,
          unsafe_regexp: true,
          unsafe_undefined: true,
        }),
  },
  mangle: {
    toplevel: true,
    // Opt-in: rename your own props by prefixing them with _ (this._x -> this.a)
    // properties: { regex: /^_/ },
  },
  format: { comments: false },
};

// Drop everything the HTML parser would invent anyway.
const markup = (s) =>
  s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "") // note: this puts the page in quirks mode
    .replace(/<\/?(html|head|body)>/gi, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/=(["'])([\w-]+)\1/g, "=$2") // id="c" -> id=c
    .trim();

const chunks = []; // strings of html/css, or { js }
for (const part of src.split(
  /(<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>)/,
)) {
  if (part.startsWith("<script>")) {
    const js = part
      .slice(8, -9)
      .replace(/glsl`([^`]*)`/g, (_, s) => JSON.stringify(glsl(s)));
    chunks.push({ js: (await minify(js, TERSER)).code });
  } else if (part.startsWith("<style>")) {
    chunks.push(
      part
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*([{};:,>])\s*/g, "$1")
        .replace(/;}/g, "}"),
    );
  } else {
    chunks.push(markup(part));
  }
}

const finish = (html) => {
  // EOF closes an open <style>, but an unterminated <script> is never executed.
  html = html.replace(/<\/style>$/, "");
  if (!/[^\x00-\x7f]/.test(html))
    html = html.replace(/<meta charset=[^>]*>/gi, ""); // pointless for pure ASCII
  return html;
};

const build = async (pack) => {
  let html = "";
  for (const c of chunks)
    html +=
      typeof c === "string" ? c : "<script>" + (await pack(c.js)) + "</script>";
  return finish(html);
};

async function roll(js) {
  const { Packer } = await import("roadroller");
  const packer = new Packer([{ data: js, type: "js", action: "eval" }], {});
  await packer.optimize(Number(ROAD) || 1);
  const { firstLine, secondLine } = packer.makeDecoder();
  return firstLine + "\n" + secondLine;
}

// Browsers leave a "%" alone unless two hex digits follow it, so only escape those.
// "#" must always be escaped (it starts the fragment). Control characters (newlines,
// and the \x1c bytes roadroller emits) get mangled or dropped in URLs, so escape them.
const uriOf = (html) =>
  "data:text/html," +
  html
    .replace(/%(?=[\da-f]{2})/gi, "%25")
    .replace(/#/g, "%23")
    .replace(
      /[\x00-\x1f\x7f]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
    );

const variants = { plain: await build((js) => js) };
if (ROAD !== "0") {
  try {
    variants.roadroller = await build(roll);
  } catch (e) {
    console.log("roadroller skipped: " + String(e.message).split("\n")[0]);
  }
}

let name, html, uri;
let bytes = Infinity;
for (const [n, h] of Object.entries(variants)) {
  const u = uriOf(h);
  const b = Buffer.byteLength(u);
  console.log(n + ": " + b + " bytes");
  if (b < bytes) [name, html, uri, bytes] = [n, h, u, b];
}

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
writeFileSync("dist/uri.txt", uri);

const esc = (uri.match(/%(?:23|25|0A)/g) || []).length;
console.log(
  "using " + name + "; " + esc + " escapes cost " + esc * 2 + " bytes",
);
console.log(
  bytes +
    " / " +
    LIMIT +
    " bytes, " +
    (bytes > LIMIT ? bytes - LIMIT + " over" : LIMIT - bytes + " left"),
);
