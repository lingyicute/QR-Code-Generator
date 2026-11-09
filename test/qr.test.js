'use strict';
// Dependency-free tests. Run with:  node --test test/
// The encoder lives inside index.html, so the inline script is extracted and evaluated
// up to (but excluding) the DOM-bound "App" section.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const cut = js.indexOf('/* =====================================================================\n *  App');
assert.ok(cut > 0, 'App section marker not found');
const { QR, toSVG, TYPES, cleanPhone } =
  new Function(js.slice(0, cut) + '\nreturn { QR, toSVG, TYPES, cleanPhone };')();

const bytesOf = s => Array.from(new TextEncoder().encode(s));
const rep = (ch, n) => Array.from({ length: n }, () => ch.charCodeAt(0));
const ECC_BITS_TO_LEVEL = { 1: 0, 0: 1, 3: 2, 2: 3 };

// remainder of a polynomial division over GF(2)
function gf2mod(value, poly, polyBits) {
  for (let i = 31 - Math.clz32(value); i >= polyBits - 1; i--) {
    if ((value >>> i) & 1) value ^= poly << (i - (polyBits - 1));
  }
  return value;
}

test('format information is a valid BCH codeword in both copies', () => {
  for (let ecc = 0; ecc < 4; ecc++) {
    for (const text of ['A', 'hello world', '0123456789', '中文测试'.repeat(8)]) {
      const qr = QR.encode(bytesOf(text), ecc), n = qr.size, m = qr.modules;
      const bit = (x, y) => (m[y][x] ? 1 : 0);
      let a = 0, b = 0;
      const posA = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
      posA.forEach(([x, y], i) => { a |= bit(x, y) << i; });
      for (let i = 0; i < 8; i++) b |= bit(n - 1 - i, 8) << i;
      for (let i = 8; i < 15; i++) b |= bit(8, n - 15 + i) << i;
      assert.equal(a, b, 'both copies must match');
      const raw = a ^ 0x5412;
      assert.equal(gf2mod(raw, 0x537, 11), 0, 'BCH(15,5) check');
      assert.equal(ECC_BITS_TO_LEVEL[raw >>> 13], ecc);
      assert.equal((raw >>> 10) & 7, qr.mask);
      assert.equal(m[n - 8][8], true, 'dark module');
    }
  }
});

test('version information is valid for versions 7 and up', () => {
  let checked = 0;
  for (const len of [150, 400, 1200, 2900]) {
    const qr = QR.encode(rep('a', len), 0), n = qr.size;
    if (qr.version < 7) continue;
    let v1 = 0, v2 = 0;
    for (let i = 0; i < 18; i++) {
      v1 |= (qr.modules[Math.floor(i / 3)][n - 11 + (i % 3)] ? 1 : 0) << i;
      v2 |= (qr.modules[n - 11 + (i % 3)][Math.floor(i / 3)] ? 1 : 0) << i;
    }
    assert.equal(v1, v2);
    assert.equal(v1 >>> 12, qr.version);
    assert.equal(gf2mod(v1, 0x1F25, 13), 0);
    checked++;
  }
  assert.ok(checked >= 3);
});

test('finder, timing and alignment patterns are in place', () => {
  for (const len of [1, 30, 120, 700]) {
    const qr = QR.encode(rep('x', len), 1), n = qr.size, m = qr.modules;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[oy + y][ox + x], d !== 2, `finder at ${ox},${oy}`);
      }
    }
    for (let i = 8; i < n - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0);
      assert.equal(m[i][6], i % 2 === 0);
    }
  }
  // alignment pattern centres for a few well-known versions (grow the payload until the version is hit)
  const centres = { 2: [6, 18], 7: [6, 22, 38], 14: [6, 26, 46, 66], 32: [6, 34, 60, 86, 112, 138], 40: [6, 30, 58, 86, 114, 142, 170] };
  for (const [ver, cs] of Object.entries(centres)) {
    // smallest payload that needs this version (binary search; the version is monotonic in the length)
    let lo = 1, hi = 2953;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (QR.encode(rep('a', mid), 0).version >= +ver) hi = mid; else lo = mid + 1;
    }
    const qr = QR.encode(rep('a', lo), 0);
    assert.equal(qr.version, +ver);
    const last = cs[cs.length - 1];
    for (const cy of cs) for (const cx of cs) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cy === 6 && cx === last)) continue;
      assert.equal(qr.modules[cy][cx], true, `centre ${cx},${cy} v${ver}`);
      assert.equal(qr.modules[cy][cx + 1], false);
      assert.equal(qr.modules[cy + 2][cx + 2], true);
    }
  }
});

test('mode selection and sizes for well-known inputs', () => {
  const num = QR.encode(bytesOf('01234567'), 1);   // ISO/IEC 18004 annex example
  assert.equal(num.version, 1);
  assert.equal(num.mode, 'num');
  assert.equal(num.used, 6);
  assert.equal(num.capacity, 16);
  assert.equal(QR.encode(bytesOf('HELLO WORLD'), 1).mode, 'alnum');
  assert.equal(QR.encode(bytesOf('hello'), 1).mode, 'byte');
  assert.equal(QR.encode(bytesOf('ID 123456789012345 abc'), 1).mode, 'mixed');
  assert.equal(QR.encode(bytesOf('中'), 3).mode, 'byte');
});

test('maximum capacities per mode and level, and TOO_LONG beyond', () => {
  const caps = {
    byte:  { 0: 2953, 1: 2331, 2: 1663, 3: 1273 },
    alnum: { 0: 4296, 1: 3391, 2: 2420, 3: 1852 },
    num:   { 0: 7089, 1: 5596, 2: 3993, 3: 3057 }
  };
  const fill = { byte: 'a', alnum: 'A', num: '7' };
  for (const [mode, byLevel] of Object.entries(caps)) {
    for (const [ecc, max] of Object.entries(byLevel)) {
      const ok = QR.encode(rep(fill[mode], max), +ecc);
      assert.equal(ok.version, 40, `${mode} ecc${ecc} max`);
      assert.equal(ok.mode, mode);
      assert.throws(() => QR.encode(rep(fill[mode], max + 1), +ecc), /TOO_LONG/);
    }
  }
});

test('version grows monotonically with the payload', () => {
  for (let ecc = 0; ecc < 4; ecc++) {
    let last = 0;
    for (let len = 1; len <= 1200; len += 7) {
      const v = QR.encode(rep('q', len), ecc).version;
      assert.ok(v >= last);
      last = v;
    }
  }
});

test('content builders', () => {
  const b = (type, v) => TYPES[type].build(v);
  assert.equal(b('text', { text: '   ' }), '');
  assert.equal(b('text', { text: ' hi ' }), ' hi ');
  assert.equal(b('wifi', { ssid: '' }), '');
  assert.equal(b('wifi', { ssid: 'My;Net', pass: 'p:a"s\\s', enc: 'WPA', hidden: true }),
    'WIFI:T:WPA;S:My\\;Net;P:p\\:a\\"s\\\\s;H:true;;');
  assert.equal(b('wifi', { ssid: 'Open', pass: 'ignored', enc: 'nopass' }), 'WIFI:T:nopass;S:Open;;');
  assert.equal(b('email', { to: '' }), '');
  assert.equal(b('email', { to: ' a@b.com ; c@d.com, e@f.com', subject: 'Hi there', body: 'a&b\nc' }),
    'mailto:a@b.com,c@d.com,e@f.com?subject=Hi%20there&body=a%26b%0Ac');
  assert.equal(cleanPhone(' +86 (010) 1234-5678 '), '+8601012345678');
  assert.equal(cleanPhone('（010）８８８８－9999'), '01088889999');
  assert.equal(b('tel', { tel: '' }), '');
  assert.equal(b('tel', { tel: '+1 555.123.4567' }), 'tel:+15551234567');
  assert.equal(b('sms', { tel: '555 1234', msg: 'a:b' }), 'SMSTO:5551234:a:b');
  assert.equal(b('vcard', {}), '');
  assert.equal(b('vcard', { org: 'ACME, Inc.' }),
    'BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nFN:ACME\\, Inc.\nORG:ACME\\, Inc.\nEND:VCARD');
});

test('SVG output', () => {
  const qr = QR.encode(bytesOf('hello'), 1), n = qr.size;
  const base = { px: 512, margin: 4, fg: '#112233', bg: '#ffeedd', transparent: false };
  const sq = toSVG(qr, { ...base, style: 'square' });
  assert.match(sq, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
  assert.match(sq, /<rect width="\d+" height="\d+" fill="#ffeedd"\/>/);
  assert.match(sq, /shape-rendering="crispEdges"/);
  assert.ok(sq.includes('fill="#112233"'));
  assert.ok(!toSVG(qr, { ...base, style: 'square', transparent: true }).includes('<rect'));
  // rounded modules: no hairline gaps, one closed sub-path per dark module outside the finders
  const rounded = toSVG(qr, { ...base, style: 'rounded' });
  assert.ok(!/NaN|undefined/.test(rounded));
  const finderless = qr.modules.flat().filter(Boolean).length -
    [[0, 0], [n - 7, 0], [0, n - 7]].reduce((t, [ox, oy]) => t + qr.modules.slice(oy, oy + 7).reduce((c, r) => c + r.slice(ox, ox + 7).filter(Boolean).length, 0), 0);
  assert.equal((rounded.split('<path')[1].match(/z/g) || []).length, finderless);
  for (const style of ['rounded', 'dots']) {
    const s = toSVG(qr, { ...base, style });
    assert.ok(s.includes('fill-rule="evenodd"'), 'finder patterns are drawn separately');
    assert.ok(!/NaN|undefined/.test(s));
  }
  // total length of the square-style runs equals the number of dark modules
  const dark = qr.modules.flat().filter(Boolean).length;
  let area = 0;
  for (const m of sq.matchAll(/M\d+ \d+h(\d+)v1h-\d+z/g)) area += +m[1];
  assert.equal(area, dark);
});
