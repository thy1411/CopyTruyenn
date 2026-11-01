const $ = (id) => document.getElementById(id);
let stopFlag = false;
let fileName = 'truyen';

// Thông báo của khu vực Bản thảo (sao chép, chuyển lô, nhảy tới chỗ sửa): dòng riêng, KHÔNG dùng chung với dòng tiến trình lấy chương (#status)
let sheetMsgTimer = 0;
function sheetMsg(text, sticky) {
  const el = $('sheetMsg');
  el.textContent = text;
  clearTimeout(sheetMsgTimer);
  if (!sticky) sheetMsgTimer = setTimeout(() => { el.textContent = ''; }, 8000);
}

// Nhãn ngắn của chương từ link (vd "chuong-87"), dùng trong thông báo
const chapLabel = (u) => (String(u).match(/(?:[a-z]+-\d+-)?(?:chuong|chapter)-?\d+/i) || [String(u)])[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sstruyen.pics: link chương dạng /doc-truyen/ten-truyen-chuong-12-10214912 (số chương, rồi mã số chương);
// ngoại truyện có thể là .../ten-truyen-ngoai-truyen-1-10214950
const SST_RE = /\/doc-truyen\/(.+?)-(chuong|ngoai-truyen|phien-ngoai)-(\d+)-(\d+)\/?(?:[?#].*)?$/i;
const SIDE_RE_SRC = '(?:ngoại\\s*truyện|phiên\\s*ngoại)';
const SIDE_TITLE_RE = new RegExp('^\\s*' + SIDE_RE_SRC + '(?![\\p{L}])', 'iu');   // tên chương là ngoại truyện
const isSst = (u) => { try { return /(^|\.)sstruyen\.pics$/i.test(new URL(u).hostname); } catch (e) { return false; } };

function textLen(el) {
  let n = 0;
  el.childNodes.forEach((c) => {
    if (c.nodeType === 3) n += c.textContent.trim().length;
    else if (c.nodeName === 'P') n += c.textContent.trim().length;
  });
  return n;
}

// Bỏ khối <ip_reminder>...</ip_reminder> (và các thẻ *_reminder tương tự), kể cả khi mất thẻ
function stripReminder(text) {
  return String(text)
    .replace(/<([a-z_]*reminder)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/This is an automated reminder\.[\s\S]*?(?:shown to the person by default\.?|$)/gi, '')
    .replace(/<\/?[a-z_]*reminder\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Nhật ký các chỗ đã xóa/sửa (để người dùng xem lại, phát hiện xóa nhầm)
let removedLog = [];   // [{ ch: tên chương, kind: loại, before: dòng gốc, after: dòng sau khi sửa }]
let _rm = null;        // bộ thu thập trong lúc parsePage đang chạy
const rmPush = (kind, before, after, extra) => { if (_rm) _rm.push({ kind, before: String(before).trim(), after: String(after || '').trim(), ...(extra || {}) }); };
const rmPushAll = (arr) => { if (_rm) arr.forEach((e) => _rm.push(e)); };

// Bỏ quảng cáo/tên trang: "truyen full", "truyenfull", "truyenfullvn", "truyenfulllive", "Truyện Full"... kèm đường dẫn
const FOOTER_LINE_RE = /liên\s*hệ\s*:?[^\n]*@|truyện\s*full\s*[-–—]\s*đọc\s*truyện\s*online|website\s*hoạt\s*động\s*dưới|creative\s*commons|attribution\s*4\.0|giấy\s*phép\s*truy\s*cập\s*mở|website\s*luôn\s*cập\s*nhật|hỗ\s*trợ\s*mọi\s*thiết\s*bị|di\s*động\s*và\s*máy\s*tính\s*bảng|^\s*online\s*,\s*[^\n]{0,40}\.\s*website|nếu\s*truyện\s*không\s*hiện\s*chữ|mọi\s*nội\s*dung\s*được\s*sưu\s*tầm\s*từ|bạn\s*có\s*thể\s*dùng\s*phím\s*mũi\s*tên|bạn\s*đang\s*đọc\s*bộ\s*truyện\s*mới[^\n]*sstruyen|truyện\s*được\s*đăng\s*tải\s*duy\s*nhất\s*tại/i;

function stripFooter(text) {
  const ls = text.split('\n');
  const rs = ls.map((l) => (FOOTER_LINE_RE.test(l) ? null : l));
  if (typeof lineChanges === 'function') rmPushAll(lineChanges(ls, rs, 'chân trang / quảng cáo', ''));
  return rs.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanPromo(text) {
  text = stripFooter(text);
  // Bỏ dòng ghi nguồn / người dịch ("Nguồn: ...", "(Truyện - Được dịch bởi ...)")
  if (typeof cleanSourceLine === 'function') {
    const ls = text.split('\n');
    const rs = ls.map(cleanSourceLine);
    if (typeof lineChanges === 'function') rmPushAll(lineChanges(ls, rs, 'ghi nguồn / người dịch', ''));
    text = rs.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // Bỏ khối <ip_reminder>...</ip_reminder> (và các thẻ *_reminder tương tự) nếu lọt vào nội dung
  text = stripReminder(text);
  const brand = '(?:(?:truy[eêệ]n|truong)\\s*full(?:\\s*(?:vn|live|com|win))?(?:\\.[a-z]{2,4})?|sstruyen(?:\\.pics)?)';
  const promoRe = new RegExp('(?:đọc thêm|xem thêm|đọc tiếp|nguồn|truy cập)[^\\n]*?' + brand + '[^\\n]*', 'gi');
  // bỏ luôn chữ đứng ngay trước tên trang (nguồn, từ, tại, theo, trên, bởi...)
  const urlRe = new RegExp('(?:(?<![\\p{L}\\p{N}])(?:nguồn(?:\\s+(?:truyện|dịch|convert))?|source|từ|tại|theo|trên|bởi)\\s*[:：]?\\s*)*(?:https?:\\/\\/)?(?:www\\.)?' + brand + '\\S*', 'giu');
  const hasBrand = new RegExp(brand, 'i');
  const brandLines = text.split('\n');
  const brandRes = brandLines
    .map((line) => {
      if (!hasBrand.test(line)) return line;
      const cleaned = line.replace(promoRe, '').replace(urlRe, '')
        .replace(/[ \t]{2,}/g, ' ').replace(/^[\s:;,\-–—|]+|[\s:;,\-–—|]+$/g, '');
      // còn quá ít chữ thì coi là dòng quảng cáo, bỏ cả dòng
      return cleaned.split(/\s+/).filter(Boolean).length <= 3 ? '' : cleaned;
    });
  if (typeof lineChanges === 'function') rmPushAll(lineChanges(brandLines, brandRes, 'tên trang / quảng cáo', ''));
  return brandRes
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Dọn dấu phẩy: bỏ các dòng chỉ có dấu phẩy/dấu câu lẻ
function finalClean(text) {
  let t = text
    .split('\n')
    .map((line) => (/^[\s,，、]+$/.test(line) ? '' : line))
    .join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}


// Sửa lỗi tiếng Việt bị tách dấu (liê´c, mă´t, tô´i...): trang nguồn đôi khi dùng dấu rời hoặc chữ ở dạng tổ hợp.
// 1) Đổi dấu "rời" (´ ˊ ˋ ˜) đứng ngay sau chữ cái thành dấu kết hợp; 2) bỏ khoảng trắng/ký tự vô hình chen giữa chữ và dấu;
// 3) chuẩn hóa NFC để chữ + dấu ghép lại thành một ký tự (ê + ́ → ế).
function fixVietnamese(text) {
  return String(text)
    .normalize('NFC')
    .replace(/(\p{L}[\u0300-\u036f]*)[ \t\u200b-\u200d\u2060\ufeff]+(?=[\u0300-\u036f])/gu, '$1')
    .replace(/(?<=\p{L}[\u0300-\u036f]*)[\u00b4\u02ca]/gu, '\u0301')
    .replace(/(?<=\p{L}[\u0300-\u036f]*)\u02cb/gu, '\u0300')
    .replace(/(?<=\p{L}[\u0300-\u036f]*)\u02dc/gu, '\u0303')
    .normalize('NFC');
}


// Tự sửa cả chương theo các mục đã tick ở phần "Kiểm tra và sửa" (dùng fixLogged của check.js).
// Mọi chỗ đã sửa/xóa được ghi vào removedLog để hiện ở mục "Xem lại".
// cx = { list, wordsStr, totals, stats, o }: list = từ bị cấm (đã tách), totals/stats = bộ đếm để báo cáo, o = các ô đã tick.
function autoClean(title, content, cx) {
  if (typeof fixLogged !== 'function') return { title: title.trim(), content: content.trim() };
  const o = cx.o, useWords = cx.list.length > 0;
  const rc = fixLogged(content, { links: o.links, source: o.source, words: useWords, emoji: o.emoji, social: o.social, notice: o.notice }, cx.wordsStr);
  const rt = fixLogged(title, { links: o.links, words: useWords, emoji: o.emoji, titles: o.titles }, cx.wordsStr);
  const t = rt.text.trim();
  rc.log.concat(rt.log).forEach((e) => removedLog.push({ ...e, ch: t }));
  Object.entries(rc.counts.words).concat(Object.entries(rt.counts.words)).forEach(([w, n]) => { cx.totals[w] = (cx.totals[w] || 0) + n; });
  cx.stats.links += rc.counts.links; cx.stats.emoji += rc.counts.emoji;
  cx.stats.titles += rt.counts.titles;
  return { title: t, content: rc.text.trim() };
}

const countWords = (s) => (String(s).match(/\S+/g) || []).length;

// Ghép các chương thành văn bản. Nếu minWords > 0: chương nào chưa đủ số chữ thì gộp thêm
// các chương sau vào cho đến khi đủ; phần dư cuối cùng (chưa đủ) được nhập vào chương trước đó.
// Giới hạn ký tự mỗi chương (web báo lỗi khi > 60.000; để dư một chút cho an toàn)
const MAX_CHARS = 58000;

// Tách nội dung quá dài thành nhiều phần cân đối, chỉ ngắt ở ranh giới đoạn (dòng).
function splitContent(text, max) {
  if (text.length <= max) return [text];
  const total = Math.ceil(text.length / max);
  const target = text.length / total;
  // Dòng quá dài (> max) thì cắt tại khoảng trắng gần nhất
  const lines = [];
  for (const ln of text.split('\n')) {
    let rest = ln;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
  }
  const parts = [];
  let cur = [], len = 0;
  const flush = () => { const t = cur.join('\n').trim(); if (t) parts.push(t); cur = []; len = 0; };
  for (const ln of lines) {
    if (len > 0 && len + ln.length + 1 > max) flush();
    cur.push(ln); len += ln.length + 1;
    if (len >= target && parts.length < total - 1) flush();
  }
  flush();
  return parts;
}

function buildOutput(chs, minWords, startOverride, forceRenum) {
  let res = [];
  if (!minWords) {
    res = chs.map((c) => ({ title: c.title, content: c.content, n: 1, ci: [c.ci] }));
  } else {
    let cur = null;
    for (const c of chs) {
      if (!cur) cur = { title: c.title, content: c.content, n: 1, ci: [c.ci] };
      else { cur.content += '\n\n' + c.content; cur.n++; cur.ci.push(c.ci); }
      if (countWords(cur.content) >= minWords) { res.push(cur); cur = null; }
    }
    if (cur) {
      if (res.length) { const last = res[res.length - 1]; last.content += '\n\n' + cur.content; last.n += cur.n; last.ci.push(...cur.ci); }
      else res.push(cur);
    }
  }
  // Tách chương vượt quá giới hạn ký tự thành nhiều chương
  let split = 0;
  const expanded = [];
  for (const c of res) {
    splitContent(c.content, MAX_CHARS).forEach((p, k) => {
      if (k) split++;
      expanded.push({ title: c.title, content: p, n: k ? 0 : c.n, part: k, ci: c.ci });
    });
  }
  res = expanded;

  // Đánh số lại liên tục (bắt đầu từ số của chương đầu tiên) khi có gộp hoặc tách chương
  const numRe = /^\s*chương\s*(\d+)/i;
  const m0 = res.length && numRe.exec(res[0].title);
  const start = startOverride != null ? startOverride : (m0 ? parseInt(m0[1], 10) : 1);
  const renum = minWords || split || forceRenum;
  // Chương không có tên (chỉ "Chương 12", "Chương 12:", "Chương 12 -"...): thêm dấu chấm làm tên -> "Chương 12: ."
  const fillEmpty = (t) => t.replace(/^(\s*chương\s*\d+)\s*[:：.\-–—]*\s*$/i, '$1: .');
  const titleOf = (c, i) => (renum && numRe.test(c.title))
    ? fillEmpty(c.title.replace(numRe, 'Chương ' + (start + i)))
    : fillEmpty(c.title.replace(/^\s*chương/i, 'Chương')) + (c.part ? ` (phần ${c.part + 1})` : '');
  return {
    text: res.map((c, i) => `${titleOf(c, i)}\n\n${c.content}\n\n\n`).join(''),
    count: res.length,
    split,
    next: start + res.length,
    titles: res.map((c, i) => titleOf(c, i)),
    items: res.map((c, i) => ({ title: titleOf(c, i), text: `${titleOf(c, i)}\n\n${c.content}\n\n\n`, ci: c.ci })),
    short: res.filter((c) => minWords && countWords(c.content) < minWords).length
  };
}

// truyenfull.win: đầu nội dung có 3 dòng thừa:
//   [Đọc truyện miễn phí tại truyenfull.win]
//   Tên truyện (Dịch)
//   Chương 1: Tên chương
// -> bỏ 2 dòng đầu; lấy "Chương 1: Tên chương" làm tên chương (thay cho tên chương tự sinh) rồi bỏ dòng đó khỏi nội dung.
const WIN_PROMO_RE = /đọc\s*truyện\s*miễn\s*phí\s*tại/i;
const WIN_CHAP_RE = /^[\s\u200b-\u200d\ufeff*#_>\-–—•\[(【《「]*(?:(?:quyển|quyen|volume|vol\.?)\s*\d+\s*[-–—:.,]?\s*)?(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?[:.\-–—#]?\s*(\d+)\s*[:.\-–—]?\s*(.*)$/i;
function stripWinHeader(content, chapter, novel) {
  const lines = content.split('\n');
  const norm = (x) => String(x).toLowerCase().replace(/\(\s*dịch\s*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const nextNonEmpty = (from) => { let i = from; while (i < lines.length && !lines[i].trim()) i++; return i; };
  const isChap = (l) => l !== undefined && WIN_CHAP_RE.test(l.trim());
  const pi = lines.findIndex((l) => WIN_PROMO_RE.test(l));
  if (pi >= 0 && pi < 6) {
    rmPush('.win: dòng "Đọc truyện miễn phí tại"', lines[pi], '', { mode: 'top' });
    lines.splice(pi, 1);
    const j = nextNonEmpty(pi);
    if (j < lines.length && !isChap(lines[j])) {
      const k = nextNonEmpty(j + 1);
      const a = norm(lines[j]), b = norm(novel);
      const sameNovel = a && b && (a === b || (a.length > 8 && b.includes(a)) || (b.length > 8 && a.includes(b)));
      if (isChap(lines[k]) || /\(\s*dịch\s*\)\s*$/i.test(lines[j]) || sameNovel) { rmPush('.win: dòng tên truyện', lines[j], '', { mode: 'top' }); lines.splice(j, 1); }
    }
  }
  // bỏ mọi dòng quảng cáo "Đọc truyện miễn phí tại ..." còn sót
  let out = lines.filter((l) => { if (WIN_PROMO_RE.test(l)) { rmPush('.win: dòng quảng cáo còn sót', l, '', { mode: 'top' }); return false; } return true; });
  const f = out.findIndex((l) => l.trim());
  if (f >= 0) {
    const m = WIN_CHAP_RE.exec(out[f].trim());
    if (m) {
      const cn = /(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?[:.\-–—#]?\s*(\d+)/i.exec(chapter);
      if (!cn || cn[1] === m[1]) {
        const rest = m[2].replace(/[\s*_\])】》」]+$/, '').trim();
        const oldCh = chapter;
        chapter = rest ? `Chương ${m[1]}: ${rest}` : `Chương ${m[1]}`;
        rmPush('.win: tên chương lấy từ nội dung', oldCh, chapter, { mode: 'top' });
        out.splice(f, 1);
      }
    }
  }
  return { content: out.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim(), chapter };
}

// Truyện chia quyển: "Quyển 2 - Chương 5 : Tên chương"
const VOL_RE = /^[\s*#_>\[(【《「]*(?:quyển|quyen|volume|vol\.?)\s*(\d+)\s*[-–—:.,]?\s*(?=(?:chương|chapter|chap|hồi)\b)/i;
const tidyChapterTitle = (t) => t.replace(/^(\s*(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?\d+)\s*[:：]\s*/i, '$1: ').replace(/\s{2,}/g, ' ').trim();

// sstruyen.pics: lấy chữ truyện theo "mốc" trên trang, không phụ thuộc tên class:
// bắt đầu sau tên chương (h1), kết thúc trước dòng "Nếu truyện không hiện chữ..." (và dòng ===== liền trước nó).
function extractSst(doc, url) {
  if (!doc.body) return null;
  const h1 = doc.querySelector('h1');
  const h1t = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
  const body = doc.body.cloneNode(true);
  body.querySelectorAll('script, style, noscript, iframe, ins, nav, footer, a, button, select, form, [class*="comment"], [id*="comment"]')
      .forEach((e) => e.remove());
  body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  body.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach((p) => p.append('\n\n'));
  const lines = body.textContent.replace(/\u00a0/g, ' ').split('\n').map((l) => l.replace(/[ \t]+$/, ''));

  const flat = (l) => l.replace(/\s+/g, ' ').trim().toLowerCase();
  let hi = h1t ? lines.findIndex((l) => flat(l) === h1t.toLowerCase()) : -1;
  if (hi < 0) hi = lines.slice(0, 40).findIndex((l) => /^\s*.{0,120}(?:chương|chapter)\s*\d+/i.test(l));
  const start = hi + 1;                                   // hi = -1 nếu không thấy -> lấy từ đầu
  let end = lines.length;
  const mk = lines.findIndex((l, i) => i >= start && /nếu truyện không hiện chữ/i.test(l));
  if (mk >= 0) {
    end = mk;
    while (end > start && !lines[end - 1].trim()) end--;
    if (end > start && /^\s*={5,}\s*$/.test(lines[end - 1])) end--;   // dòng ===== ngay trước câu thông báo
  } else {
    const rp = lines.findIndex((l, i) => i >= start && /^\s*báo cáo lỗi\s*$/i.test(l));
    if (rp >= 0) end = rp;
  }
  const navRe = /^\s*(?:chương|chapter)\s*(?:trước|sau|tiếp)\s*$/i;
  const content = lines.slice(start, end).filter((l) => !navRe.test(l)).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (content.length < 30) return null;

  let chapter = '', novel = '';
  const m = new RegExp('(?:(?:chương|chapter)\\s*\\d+|' + SIDE_RE_SRC + '(?:\\s*\\d+)?).*$', 'i').exec(h1t);
  if (m) { chapter = m[0].trim(); novel = h1t.slice(0, m.index).replace(/[\s\-–—:|]+$/, '').trim(); }
  const sm = SST_RE.exec(url);
  if (!chapter && sm) chapter = (sm[2].toLowerCase() === 'chuong' ? 'Chương ' : 'Ngoại truyện ') + sm[3];
  if (!novel) novel = (doc.title || '').replace(new RegExp('\\s*(?:(?:chương|chapter)\\s*\\d+|' + SIDE_RE_SRC + '(?:\\s*\\d+)?).*$', 'i'), '').trim();
  // Trang in lại tên chương ("Chương N" hoặc "Ngoại truyện N", có thể kèm tiêu đề) ngay đầu nội dung:
  // bỏ dòng đó; nếu dòng có tiêu đề mà tên chương chưa có thì dùng làm tên chương
  const LAB = /^\s*(chương|chapter|ngoại\s*truyện|phiên\s*ngoại)\s*(\d*)\s*(.*)$/i;
  const labKey = (x) => x.toLowerCase().replace(/\s+/g, ' ');
  const cl = content.split('\n');
  const fi = cl.findIndex((l) => l.trim());
  const cm = LAB.exec(chapter), tm = fi >= 0 && LAB.exec(cl[fi]);
  if (cm && tm && labKey(cm[1]) === labKey(tm[1]) && cm[2] === tm[2] && tm[3].length < 120) {
    const strip = (x) => x.replace(/^[\s:.\-–—]+/, '').trim();
    const sub = strip(tm[3]);
    if (sub && !strip(cm[3])) {
      const lab = labKey(cm[1]);
      chapter = (lab.charAt(0).toUpperCase() + lab.slice(1) + (cm[2] ? ' ' + cm[2] : '')) + ': ' + sub;
    }
    cl.splice(0, fi + 1);
    return { content: cl.join('\n').replace(/^\n+/, '').trim(), chapter, novel };
  }
  return { content, chapter, novel };
}

// Dòng "Chương N..." nằm riêng một dòng trong nội dung (nhiều site tự chèn lại tên chương / tên chương kế vào thân bài): xóa.
//  - CÙNG số với chương đang lấy (vd chương 1 mà trong bài lại có thêm "Chương 1..."): xóa cả dòng đầu tiên của nội dung, kể cả "Chương 1 Tên chương" không có dấu ngăn;
//    giữ nguyên câu văn bắt đầu bằng chữ thường ("Chương 1 của quyển sách này...").
//  - Số sát bên (±1, thường là tên chương kế bị chèn vào cuối bài): chỉ xóa khi đúng dạng tiêu đề ("Chương N", "Chương N: tên", "Chương N - tên").
// Nếu tên chương đang chỉ có "Chương N" mà dòng bị xóa có kèm tên thì dùng tên đó làm tên chương.
// Trả về { content, chapter, changes } (changes dùng cho mục "Xem lại").
const MID_ANY_RE = /^[\s\u200b-\u200d\ufeff*#_>\-–—•\[(【《「]*(?:(?:quyển|quyen|volume|vol\.?)\s*\d+\s*[-–—:.,]?\s*)?(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?(\d+)(?!\d)\s*(.*)$/i;
function stripMidChapterLines(content, chapter) {
  const cn = /(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?[:.\-–—#]?\s*(\d+)/i.exec(chapter || '');
  const cur = cn ? parseInt(cn[1], 10) : null;
  const bareCh = /^\s*chương\s*\d+\s*[:：.\-–—]*\s*$/i.test(chapter || '');
  let newChapter = chapter, nameFrom = null;
  const ls = content.split('\n');
  const first = ls.findIndex((l) => l.trim());
  const rs = ls.map((l, i) => {
    const t = l.trim();
    if (!t || t.length > 120) return l;
    const m = MID_ANY_RE.exec(t);
    if (!m) return l;
    const num = parseInt(m[1], 10);
    const rest = m[2].replace(/[\s*_\])】》」]+$/, '').trim();
    const sepStart = /^[:：.\-–—]/.test(rest);
    const title = rest.replace(/^[:：.\-–—\s]+/, '');
    let ok;
    if (cur !== null && num === cur) ok = rest === '' || sepStart || /^[\p{Lu}\p{N}]/u.test(rest);   // cùng số chương này
    else ok = i > first && t.length <= 100 && (rest === '' || sepStart) && title.length <= 80 && !/[.,;]$/.test(title)
              && (cur === null || Math.abs(num - cur) <= 1);                                          // số sát bên
    if (!ok) return l;
    if (cur !== null && num === cur && bareCh && !nameFrom && /\p{L}/u.test(title)) nameFrom = title;
    return null;
  });
  if (nameFrom) newChapter = `Chương ${cur}: ${nameFrom}`;
  const changes = (typeof lineChanges === 'function') ? lineChanges(ls, rs, 'dòng "Chương N" xen trong nội dung', '') : [];
  return { content: rs.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim(), chapter: newChapter, changes };
}

// Đóng chữ "chương" (kèm số nếu có: "chương 5") xuất hiện trong NỘI DUNG vào ngoặc kép để không bị nhầm thành tiêu đề chương khi đăng.
// Bỏ qua: chữ đã nằm trong ngoặc kép, "chương trình", "huân/huy/văn chương". Không đụng tới tên chương (chỉ xử lý nội dung).
const CHUONG_WORD_RE = /(?<![\p{L}\p{N}"“”])(?<!(?:huân|huy|văn)\s)(chương(?:\s*(?:thứ\s*)?\d+(?!\d))?)(?![\p{L}\p{N}])(?!\s+trình(?![\p{L}\p{N}]))/giu;
function quoteChapterWords(content) {
  const ls = content.split('\n');
  const rs = ls.map((l) => {
    if (!/chương/i.test(l)) return l;
    return l.replace(CHUONG_WORD_RE, (m, w, off, str) => {
      const before = str.slice(0, off).match(/["“”]/g);
      if (before && before.length % 2 === 1) return m;                  // đang nằm trong ngoặc kép
      return '"' + w + '"';
    });
  });
  const changes = (typeof lineChanges === 'function') ? lineChanges(ls, rs, 'đóng chữ "chương" trong ngoặc kép', '') : [];
  return { content: rs.join('\n'), changes };
}

function parsePage(html, url) {
  _rm = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sst = isSst(url) ? extractSst(doc, url) : null;

  // 1) Tìm khối nội dung
  const selectors = ['#chapter-c', '.chapter-c', '#chapter-content', '.chapter-content',
                     '#content', '.reading-content', '.content-chapter', 'article'];
  let box = null;
  if (!sst) for (const s of selectors) {
    const el = doc.querySelector(s);
    if (el && el.textContent.trim().length > 200) { box = el; break; }
  }
  if (!box && !sst) { // dự phòng: khối có nhiều chữ nhất
    let best = 0;
    doc.querySelectorAll('div, article, section').forEach((el) => {
      const l = textLen(el);
      if (l > best) { best = l; box = el; }
    });
  }
  if (!box && !sst) { _rm = null; return null; }

  // 2) Làm sạch và chuyển thành văn bản
  const clone = sst ? null : box.cloneNode(true);
  if (clone) {
    clone.querySelectorAll('script, style, iframe, ins, noscript, footer, #footer, [class*="footer"], [id*="footer"], a, [class*="ads"], [id*="ads"], [class*="banner"]')
         .forEach((e) => e.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    clone.querySelectorAll('p, div').forEach((p) => p.append('\n\n'));
  }
  let content = fixVietnamese(sst ? sst.content : clone.textContent)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  content = finalClean(cleanPromo(content));

  // 3) Tên truyện, tên chương
  const pick = (sels) => {
    for (const s of sels) {
      const el = doc.querySelector(s);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return '';
  };
  let novel = fixVietnamese(stripReminder(pick(['.truyen-title', 'a.truyen-title', '.story-title']) || doc.title));
  let chapter = fixVietnamese(cleanPromo(stripReminder(pick(['.chapter-title', 'a.chapter-title', 'h2', 'h1']) || doc.title)));
  if (sst) { novel = fixVietnamese(stripReminder(sst.novel || novel)); chapter = tidyChapterTitle(fixVietnamese(sst.chapter || chapter)); }

  // Truyện chia quyển: bỏ "Quyển X -" khỏi tên chương (nếu bật ô o_vol) để chương được đánh số liên tục
  const volOn = () => !$('o_vol') || $('o_vol').checked;
  let vol = null;
  { const vm = VOL_RE.exec(chapter);
    if (vm) { vol = parseInt(vm[1], 10); if (volOn()) chapter = tidyChapterTitle(chapter.slice(vm[0].length)); } }

  // truyenfull.win: bỏ dòng "Đọc truyện miễn phí tại" + dòng tên truyện, lấy tên chương ngay trong nội dung
  try {
    if (/(^|\.)truyenfull\.win$/i.test(new URL(url).hostname)) {
      const r = stripWinHeader(content, chapter, novel);
      content = r.content; chapter = r.chapter;
    }
  } catch (e) {}

  // Nội dung nhiều trang tự in lại tên chương ở đầu bài: bỏ dòng trùng (giữ một tên chương duy nhất).
  // Nếu tên chương chỉ có "Chương N" mà dòng trùng có kèm tiêu đề thì dùng dòng đầy đủ hơn làm tên chương.
  if ($('autofix').checked && $('o_dup').checked) {
    // Nhận cả các dạng: Chương 181 / CHƯƠNG 181 / Chương: 181 / Chương thứ 181 / **Chương 181** / 【Chương 181】 / Chapter 181
    const numOf = (x) => { const m = /(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?[:.\-–—#]?\s*(\d+)/i.exec(x); return m ? m[1] : null; };
    const lines = content.split('\n');
    for (let guard = 0; guard < 3; guard++) {
      const i = lines.findIndex((l) => l.trim());
      if (i < 0) break;
      const ln = lines[i].trim();
      const m = /^[\s\u200b-\u200d\ufeff*#_>\-–—•\[(【《「]*(?:(?:quyển|quyen|volume|vol\.?)\s*\d+\s*[-–—:.,]?\s*)?(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?[:.\-–—#]?\s*(\d+)/i.exec(ln);
      if (!m) break;
      { const vm2 = VOL_RE.exec(ln); if (vm2 && vol === null) vol = parseInt(vm2[1], 10); }
      const tn = numOf(chapter);
      if (tn && tn !== m[1]) break;
      // tên chương chỉ có số mà dòng trùng có kèm tiêu đề: dùng dòng đầy đủ hơn (bỏ ký tự trang trí quanh nó)
      { const rest = ln.slice(m[0].length).replace(/[\s*_\])】》」]+$/, '');
        if (/^chương\s*\d+\s*$/i.test(chapter.trim()) && /\p{L}/u.test(rest)) chapter = 'Chương ' + m[1] + rest; }
      rmPush('tên chương lặp trong nội dung', ln, '', { mode: 'top' });
      lines.splice(0, i + 1);
    }
    content = lines.join('\n').replace(/^\n+/, '').trim();
  }
  if (vol !== null && volOn()) chapter = tidyChapterTitle(chapter);
  // Dòng "Chương N" xen giữa nội dung: xóa (có ghi vào mục "Xem lại")
  if ($('autofix').checked && (!$('o_midchap') || $('o_midchap').checked)) {
    const mc = stripMidChapterLines(content, chapter);
    content = mc.content; chapter = mc.chapter; rmPushAll(mc.changes);
  }
  // Chữ "chương" còn lại trong nội dung: đóng vào ngoặc kép
  if ($('autofix').checked && (!$('o_quote') || $('o_quote').checked)) {
    const qc = quoteChapterWords(content);
    content = qc.content; rmPushAll(qc.changes);
  }

  // 4) Link chương sau
  let next = null;
  const nextEl = doc.querySelector('#next_chap, a.next, a[rel="next"], .btn-next, a.next_chap');
  let href = nextEl && nextEl.getAttribute('href');
  if (!href || href.startsWith('javascript') || href === '#') {
    href = null;
    doc.querySelectorAll('a').forEach((a) => {
      const t = a.textContent.trim().toLowerCase();
      if (!href && (t.includes('chương sau') || t.includes('chương tiếp') || t === 'sau')) {
        const h = a.getAttribute('href');
        if (h && !h.startsWith('javascript') && h !== '#') href = h;
      }
    });
  }
  if (href) { try { next = new URL(href, url).href; } catch (e) {} }

  const removed = _rm; _rm = null;
  return { novel, chapter, content, next, removed, vol };
}


// Nhận cả link chương nằm trong quyển: /quyen-1-chuong-1/
const CHAPTER_RE = /\/(?:doc-truyen\/[^/?#]+|(?:[a-z]+-\d+-)?(?:chuong|chapter)-?\d+)/i;

// Tải trang bằng chính phiên duyệt web của bạn: chạy fetch bên trong một tab truyenfull đang mở
// (cùng cookie, cùng nguồn gốc như khi bạn tự bấm sang chương).
async function findSiteTab(u) {
  const origin = new URL(u).origin;
  const tabs = await chrome.tabs.query({ url: [origin + '/*'] });
  return tabs[0] || null;
}

let extraDelay = 0; // tự tăng thêm khi trang báo "quá nhanh" (HTTP 429/503)

// Thông báo của Chrome (hiện cả khi tab đang ở nền)
let lastBlockNotify = 0, blockNotified = false;
function notify(id, title, message, sticky, buttons) {
  try {
    const o = { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2, requireInteraction: !!sticky };
    if (buttons) o.buttons = buttons.map((t) => ({ title: t }));
    const r = chrome.notifications.create(id, o);
    if (r && r.catch) r.catch(() => {});
  } catch (e) {}
}
let blockedUrl = '';
const SITE_TABS = ['https://truyenfull.live/*', 'https://*.truyenfull.live/*', 'https://truyenfull.win/*', 'https://*.truyenfull.win/*', 'https://sstruyen.pics/*', 'https://*.sstruyen.pics/*'];
// Link hợp lệ: truyenfull.live, truyenfull.win hoặc sstruyen.pics
const SITE_URL_RE = /^https:\/\/([a-z0-9-]+\.)?(?:truyenfull\.(?:live|win)|sstruyen\.pics)\//i;

// Mở (hoặc chuyển tới) tab truyenfull để người dùng làm bước xác minh
async function openVerifyTab() {
  try {
    const tabs = await chrome.tabs.query({ url: SITE_TABS });
    const tab = tabs[0] || await chrome.tabs.create({ url: blockedUrl || 'https://truyenfull.live/' });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {}
}

// Hộp hỏi kiểu "xác nhận" ngay trên trang (giống hộp xin quyền của trình duyệt)
function showAsk(msg) { $('askMsg').textContent = msg; $('ask').hidden = false; }
function hideAsk() { $('ask').hidden = true; }
$('askNo').onclick = () => { hideAsk(); clearNotify('tf-blocked'); };
$('askYes').onclick = () => { hideAsk(); clearNotify('tf-blocked'); openVerifyTab(); };

function clearNotify(id) {
  try { const r = chrome.notifications.clear(id); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}

// Số giây chờ giữa các lần thử lại khi chương đọc lỗi hoặc trang đang chặn (chỉnh tại đây)
const WAIT_SEC = 10;
const WAIT_TRIES = 60; // số lần thử lại tối đa khi bị chặn: 60 x 10s = khoảng 10 phút
// Chờ `sec` giây (hiện đếm ngược, bấm Dừng là thoát ngay)
async function waitSeconds(sec, label) {
  for (let i = sec; i > 0 && !stopFlag; i--) {
    $('status').textContent = `${label} (${i}s)`;
    await sleep(1000);
  }
}

async function getHtml(u) {
  const retryWaits = [2, 4, 8, 15, 30];                      // lỗi mạng / 5xx: thử lại ngắn
  const blockWaits = Array(WAIT_TRIES).fill(WAIT_SEC);          // bị chặn / giới hạn tốc độ: mỗi lần chờ WAIT_SEC giây, tối đa ~10 phút
  let lastErr, attempt = 0, blocked = 0;
  while (true) {
    if (stopFlag) throw Object.assign(new Error('Đã dừng.'), { fatal: true });
    const tab = await findSiteTab(u);
    if (!tab) {
      throw Object.assign(new Error('Hãy mở trang ' + new URL(u).origin + ' trong một tab khác (làm theo bước xác minh nếu trang yêu cầu) rồi bấm lại.'), { fatal: true });
    }
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (url) => {
          const r = await fetch(url, { credentials: 'include' });
          return { status: r.status, html: await r.text() };
        },
        args: [u]
      });
      if (result.status === 403 || result.status === 429 || result.status === 503) {
        if (blocked >= blockWaits.length) {
          throw Object.assign(new Error(
            `Trang vẫn trả về HTTP ${result.status} sau khi chờ khoảng ${Math.round(WAIT_TRIES * WAIT_SEC / 60)} phút. Hãy mở chương này trong tab của trang truyện, hoàn tất bước xác minh (nếu có) rồi bấm chạy lại (link chương này đã được điền sẵn).`),
            { fatal: true });
        }
        if (blocked === 0 && Date.now() - lastBlockNotify > 120000) {
          lastBlockNotify = Date.now(); blockNotified = true; blockedUrl = u;
          const ask = `Trang truyện đang chặn (HTTP ${result.status}). Mở tab của trang để làm bước xác minh, extension sẽ tự chạy tiếp khi bạn xong.`;
          notify('tf-blocked', 'Truyện Extractor — trang đang chặn', ask, true, ['BỎ QUA', 'MỞ TAB XÁC MINH']);
          showAsk(ask);
        }
        if (result.status !== 403) extraDelay = Math.min(extraDelay + 500, 5000); // chậm lại cho đỡ bị chặn
        await waitSeconds(blockWaits[blocked++],
          `⏸️ Trang đang chặn/giới hạn tốc độ (HTTP ${result.status}). Nếu có bước xác minh, hãy làm trong tab của trang — sẽ tự chạy tiếp sau`);
        continue;
      }
      if (result.status < 200 || result.status >= 300) throw new Error('HTTP ' + result.status);
      if (blockNotified) { clearNotify('tf-blocked'); hideAsk(); blockNotified = false; }
      return result.html;
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      if (/HTTP (404|410)\b/.test(e.message) || attempt >= retryWaits.length) break;
      await sleep(retryWaits[attempt++] * 1000);
    }
  }
  throw new Error(lastErr.message + ' tại ' + u);
}

// Tìm link của chương số `n` từ link truyện hoặc link một chương bất kỳ (không cần tự bấm vào chương)
async function locateChapter(inputUrl, n, delay) {
  const numRe = /\/(?:[a-z]+-\d+-)?(?:chuong|chapter)-?(\d+)/i;
  const chapNum = (u) => { const sm = SST_RE.exec(u); if (sm) return sm[2].toLowerCase() === 'chuong' ? parseInt(sm[3], 10) : null; const m = numRe.exec(u); return m ? parseInt(m[1], 10) : null; };
  // Hai cách đổi số: bỏ phần tên sau số (chuong-5-ten → chuong-21), hoặc chỉ đổi số
  const variants = (u) => {
    const sm = SST_RE.exec(u);
    if (sm && sm[2].toLowerCase() === 'chuong') { // sstruyen: mã chương thường tăng đều theo số chương -> đoán rồi kiểm tra lại ở tryUrl
      const id = parseInt(sm[4], 10) + (n - parseInt(sm[3], 10));
      return [u.replace(SST_RE, `/doc-truyen/${sm[1]}-chuong-${n}-${id}`)];
    }
    const dropTail = u.replace(/(\/(?:[a-z]+-\d+-)?(?:chuong|chapter)-?)\d+([^\/?#]*)/i, (_, a, rest) => a + n + ((/\.html?$/i.exec(rest) || [''])[0]));
    const onlyNum = u.replace(/(\/(?:[a-z]+-\d+-)?(?:chuong|chapter)-?)\d+/i, (_, a) => a + n);
    return [...new Set([dropTail, onlyNum])].filter((x) => x !== u);
  };
  const tryUrl = async (u) => {
    try {
      const p = parsePage(await getHtml(u), u);
      if (!p || !p.content) return null;
      if (isSst(u)) { const cn = /(\d+)/.exec(p.chapter || ''); if (!cn || parseInt(cn[1], 10) !== n) return null; } // đoán sai mã -> trang khác chương
      return { url: u, novel: p.novel };
    }
    catch (e) { if (e.fatal) throw e; return null; }
  };

  let startUrl = null, startNum = 0;   // chương có số nhỏ hơn n để đi bộ tới (nếu đổi số trực tiếp không được)
  let novel = '';

  if (CHAPTER_RE.test(inputUrl)) {
    const cur = chapNum(inputUrl);
    if (cur === n) return { url: inputUrl };
    for (const v of variants(inputUrl)) { const t = await tryUrl(v); if (t) return t; }
    if (cur != null && cur < n) { startUrl = inputUrl; startNum = cur; }
  } else {
    $('status').textContent = 'Đang đọc trang truyện để tìm chương ' + n + '...';
    const html = await getHtml(inputUrl);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = inputUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
    const origin = new URL(inputUrl).origin;
    const links = [];
    doc.querySelectorAll('a[href]').forEach((a) => {
      let u; try { u = new URL(a.getAttribute('href'), inputUrl).href.replace(/#.*$/, ''); } catch (e) { return; }
      const k = chapNum(u);
      if (k != null && CHAPTER_RE.test(u) && u.startsWith(origin)) links.push({ u, k });
    });
    const own = links.filter((l) => l.u.startsWith(base + '/'));
    const pool = own.length ? own : links;
    novel = ((doc.querySelector('h1, h3.title, .title') || {}).textContent || doc.title || '').trim();
    const exact = pool.find((l) => l.k === n);
    if (exact) return { url: exact.u, novel };
    if (pool.length) {
      for (const v of variants(pool[0].u)) { const t = await tryUrl(v); if (t) return { url: t.url, novel: novel || t.novel }; }
      const below = pool.filter((l) => l.k < n).sort((x, y) => y.k - x.k)[0];
      if (below) { startUrl = below.u; startNum = below.k; }
    }
    if (!startUrl) {
      const first = findFirstChapter(html, inputUrl);
      if (first) { startUrl = first.url; startNum = chapNum(first.url) || 1; novel = novel || first.novel; }
    }
  }

  // Dự phòng: đi từ chương gần nhất (nhỏ hơn n) theo nút "chương sau" cho tới chương n (không lưu nội dung)
  if (!startUrl) throw new Error(`Không tìm được chương ${n}. Hãy dán link truyện hoặc link một chương có số nhỏ hơn ${n}.`);
  let u = startUrl, steps = 0;
  const seenW = new Set();
  while (u && !seenW.has(u) && !stopFlag && steps < 4000) {
    seenW.add(u);
    const k = chapNum(u);
    if (k != null && k >= n) return { url: u, novel };
    $('status').textContent = `Đang tìm chương ${n}... (đang ở chương ${k != null ? k : '?'})`;
    let page = null;
    try { page = parsePage(await getHtml(u), u); } catch (e) { if (e.fatal) throw e; }
    if (!page) break;
    u = page.next && CHAPTER_RE.test(page.next) ? page.next : null;
    steps++;
    await sleep(delay + extraDelay);
  }
  if (stopFlag) throw Object.assign(new Error('Đã dừng.'), { fatal: true });
  throw new Error(`Không tìm thấy chương ${n} (truyện có thể chưa có chương này).`);
}

// Từ trang chính của truyện, tìm link chương đầu tiên
function findFirstChapter(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const abs = (h) => { try { return new URL(h, baseUrl).href; } catch (e) { return null; } };
  const novel = (doc.querySelector('h1, h3.title, .title') || {}).textContent || doc.title;

  // Nút "Đọc từ đầu"/"Đọc truyện"
  for (const a of doc.querySelectorAll('a')) {
    const t = a.textContent.trim().toLowerCase();
    const h = a.getAttribute('href');
    if (h && !h.startsWith('javascript') && h !== '#' &&
        /(đọc từ đầu|chương đầu|bắt đầu đọc|đọc truyện|đọc ngay)/.test(t) && CHAPTER_RE.test(h)) {
      return { url: abs(h), novel: novel.trim() };
    }
  }
  // Dự phòng: link chương có số nhỏ nhất, ưu tiên link nằm dưới đường dẫn của truyện này (tránh nhầm link truyện khác ở thanh bên)
  const base = baseUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const cands = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const hr = a.getAttribute('href');
    const sm = SST_RE.exec(hr);
    const m = sm ? (sm[2].toLowerCase() === 'chuong' ? [hr, '', sm[3]] : null) : hr.match(/\/(?:[a-z]+-(\d+)-)?(?:chuong|chapter)-?(\d+)/i);
    const u = m && abs(hr);
    if (u) cands.push({ u, n: (m[1] ? +m[1] : 0) * 100000 + +m[2] }); // quyển trước, rồi tới số chương
  });
  const own = cands.filter((c) => c.u.startsWith(base + '/'));
  const pool = own.length ? own : cands;
  if (!pool.length) return null;
  const best = pool.reduce((x, y) => (y.n < x.n ? y : x));
  return { url: best.u, novel: novel.trim() };
}

// Chia các chương gốc thành từng lô (mỗi lô `size` chương gốc, 0 = không chia). Gộp chương chỉ xảy ra
// trong từng lô, số chương được đánh liên tục giữa các lô nên lô sau nối tiếp đúng số của lô trước.
function buildBatches(chs, minWords, size) {
  if (!chs.length) return { batches: [], count: 0, short: 0, split: 0 };
  const groups = [];
  if (!size) groups.push(chs);
  else for (let i = 0; i < chs.length; i += size) groups.push(chs.slice(i, i + size));
  const batches = [];
  const hasVol = chs.some((c) => c.vol != null); // truyện chia quyển: số chương lặp lại theo từng quyển -> phải đánh số lại liên tục
  let pending = [], start = null, count = 0, short = 0, split = 0;
  const emit = (items) => {
    if (!items.length) return;
    const nums = items.map((it) => /^\s*chương\s*(\d+)/i.exec(it.title));
    const first = nums[0], last = nums[nums.length - 1];
    const range = first && last ? `Chương ${first[1]}-${last[1]}` : `${items.length} chương`;
    const map = new Map(); // chương gốc (ci) -> tên chương trong lô sau khi gộp/đánh số lại
    items.forEach((it) => (it.ci || []).forEach((k) => { if (k != null && !map.has(k)) map.set(k, it.title); }));
    batches.push({ text: items.map((it) => it.text).join(''), count: items.length, label: `Lô ${batches.length + 1} - ${range}`, range, map });
  };
  groups.forEach((g) => {
    const b = buildOutput(g, minWords, start, split > 0 || hasVol);
    start = b.next; count += b.count; short += b.short; split += b.split;
    pending.push(...b.items);
    // Mỗi lô tối đa `size` chương; chương dư (do tách chương dài) được đẩy sang lô kế tiếp
    emit(pending.splice(0, size || pending.length));
  });
  while (pending.length) emit(pending.splice(0, size || pending.length));
  return { batches, count, short, split };
}

let batches = [];
let curBatch = 0;
const copiedSet = new Set(); // nhãn các lô đã sao chép (hiện dấu ✓ trong bảng chọn lô)

// Bảng chọn lô: lưới các ô "Lô N + khoảng chương", có ô nhập "tới chương số"
function updatePicker() {
  const btn = $('batchBtn'), grid = $('batchGrid');
  if (!btn || !grid) return;
  btn.textContent = batches.length ? `Lô ${curBatch + 1}/${batches.length} · ${(batches[curBatch].range || '').replace(/^Chương\s*/i, 'Chương ')} ▾` : 'Lô ▾';
  Array.from(grid.children).forEach((c, i) => {
    const b = batches[i];
    c.className = 'lo-cell' + (i === curBatch ? ' active' : '') + (b && copiedSet.has(b.label) ? ' copied' : '');
  });
}
function closePicker() {
  if (!$('batchPanel')) return;
  $('batchPanel').hidden = true; $('batchBtn').setAttribute('aria-expanded', 'false');
}
function buildPicker() {
  const grid = $('batchGrid');
  if (!grid) return;
  grid.textContent = '';
  batches.forEach((b, i) => {
    const c = document.createElement('button'); c.type = 'button';
    c.title = `${b.label} (${b.count} chương)`;
    const t = document.createElement('span'); t.textContent = `Lô ${i + 1}`;
    const s = document.createElement('small'); s.textContent = (b.range || '').replace(/^Chương\s*/i, 'Ch. ');
    c.append(t, s);
    c.onclick = () => { closePicker(); goBatch(i); };
    grid.appendChild(c);
  });
  updatePicker();
}

const saveCurrentBatch = () => { if (batches[curBatch]) batches[curBatch].text = $('out').value; };

function showBatch(i) {
  const row = $('batchRow');
  if (!batches.length) { row.style.display = 'none'; $('out').value = ''; closePicker(); updatePicker(); return; }
  curBatch = Math.min(Math.max(i, 0), batches.length - 1);
  if ($('out').value !== batches[curBatch].text) $('out').value = batches[curBatch].text;
  $('batch').value = String(curBatch);
  $('prevBatch').disabled = curBatch === 0;
  $('nextBatch').disabled = curBatch === batches.length - 1;
  row.style.display = batches.length > 1 ? 'flex' : 'none';
  updatePicker();
}

function refreshOutput(chapters, minWords, size) {
  saveCurrentBatch();
  const b = buildBatches(chapters, minWords, size);
  batches = b.batches.map((x) => ({ ...x, text: stripReminder(x.text) }));
  const sel = $('batch');
  sel.textContent = '';
  batches.forEach((x, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = `${x.label} (${x.count} chương)`;
    sel.appendChild(o);
  });
  buildPicker();
  showBatch(curBatch);
  return b;
}

// Chuyển lô bằng nút/ô chọn: nếu bật "Tự sao chép khi chuyển lô" thì sao chép luôn lô vừa hiện ra
function goBatch(i) {
  saveCurrentBatch();
  showBatch(i);
  return ($('autocopy').checked && batches.length > 1) ? copyOut(true) : undefined;
}
// Sau khi sang đúng lô: chọn và cuộn tới dòng tên chương trong bản thảo
function focusChapter(n) {
  const ta = $('out'), lb = batches[curBatch] ? batches[curBatch].label : '';
  const re = new RegExp('^[ \\t]*(?:(?:quyển|quyen|volume|vol\\.?)[ \\t]*\\d+[ \\t]*[-–—:.,]?[ \\t]*)?chương[ \\t]*' + n + '(?!\\d)', 'im');
  const m = re.exec(ta.value);
  if (!m) { sheetMsg(`📍 Đã tới ${lb}, nhưng không thấy dòng tên "Chương ${n}" trong lô này.`); return; }
  const s = m.index; let e = ta.value.indexOf('\n', s); if (e < 0) e = ta.value.length;
  selectAndShow(ta, s, e);
  sheetMsg(`📍 Chương ${n} (${lb}) — dòng tên chương đang được chọn.`);
}
$('batch').onchange = () => goBatch(parseInt($('batch').value, 10) || 0);
$('batchBtn').onclick = () => {
  const p = $('batchPanel'), open = p.hidden;
  p.hidden = !open; $('batchBtn').setAttribute('aria-expanded', String(open));
  if (open) { updatePicker(); const a = $('batchGrid').children[curBatch]; if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); }
};
$('batchGoto').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const n = parseInt($('batchGoto').value, 10);
  if (!n) return;
  const i = batches.findIndex((b) => { const m = /(\d+)\s*-\s*(\d+)/.exec(b.range || ''); return m && n >= +m[1] && n <= +m[2]; });
  if (i < 0) { sheetMsg(`⚠️ Không có lô nào chứa chương ${n}.`); return; }
  closePicker();
  Promise.resolve(goBatch(i)).then(() => focusChapter(n));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('batchPanel') && !$('batchPanel').hidden) { closePicker(); $('batchBtn').focus(); } });
document.addEventListener('click', (e) => { if ($('batchPanel') && !$('batchPanel').hidden && !$('batchRow').contains(e.target)) closePicker(); });
$('prevBatch').onclick = () => goBatch(curBatch - 1);
$('nextBatch').onclick = () => goBatch(curBatch + 1);

// Đoán link chương kế tiếp bằng cách tăng số chương trong link lên 1 (dùng khi chương lỗi, không có nút "chương sau")
function guessNext(u) {
  const sm = SST_RE.exec(u);
  if (sm) return u.replace(SST_RE, `/doc-truyen/${sm[1]}-${sm[2]}-${parseInt(sm[3], 10) + 1}-${parseInt(sm[4], 10) + 1}`); // sstruyen: tăng cả số chương và mã
  const re = /(\/(?:[a-z]+-\d+-)?(?:chuong|chapter)-?)(\d+)/i;
  const m = re.exec(u);
  return m ? u.replace(re, (_, a, n) => a + (parseInt(n, 10) + 1)) : null;
}

// Lô 1 vừa đủ chương (trong lúc vẫn đang lấy các chương sau): dựng lô và tự sao chép vào clipboard để dán được ngay.
// Chrome có thể từ chối ghi clipboard khi tab ở nền, nên thử cách dự phòng và báo rõ nếu không copy được.
async function copyFirstBatchNow(chapters, minWords, size) {
  refreshOutput(chapters, minWords, size);
  if (!batches.length) return;
  const text = stripReminder(batches[0].text), label = batches[0].label;
  let ok = false;
  try {
    await Promise.race([navigator.clipboard.writeText(text), sleep(2000).then(() => { throw new Error('timeout'); })]);
    ok = true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (e2) { ok = false; }
  }
  if (ok) {
    copiedSet.add(label); updatePicker();
    sheetMsg(`📋 ${label} đã đủ chương và được tự sao chép vào clipboard — dán được ngay, các chương sau vẫn đang được lấy.`);
    notify('tf-batch1', `Truyện Extractor — ${label} đã sẵn sàng`, 'Đã tự sao chép vào clipboard, bạn dán được ngay. Các chương sau vẫn đang được lấy.');
  } else {
    sheetMsg(`⚠️ ${label} đã đủ chương nhưng Chrome không cho tự sao chép lúc này (thường do tab đang ở nền) — bấm "Sao chép" khi cần.`, true);
    notify('tf-batch1', `Truyện Extractor — ${label} đã sẵn sàng`, 'Chrome không cho tự sao chép lúc này. Mở tab extension và bấm Sao chép.');
  }
}

let carry = [], carryNext = ''; // các chương đã lấy + link chương kế (để chạy tiếp sau khi dừng/lỗi)

// Hai trang liền nhau mang CÙNG số chương (trang bị lặp, hoặc một chương bị site chia đôi thành 2 trang đều ghi "Chương N"):
// không tạo thêm một chương/tiêu đề mới. Trả về 'dup' (nội dung trùng -> bỏ bản trùng), 'merge' (nối tiếp vào chương trước) hoặc null (khác số chương).
function mergeIntoPrev(prev, cur) {
  const numOf = (t) => { const m = /^\s*chương\s*(\d+)/i.exec(String(t)); return m ? m[1] : null; };
  const n = numOf(cur.title);
  if (!n || n !== numOf(prev.title) || (prev.vol ?? null) !== (cur.vol ?? null)) return null;
  const flat = (x) => String(x).replace(/\s+/g, ' ').trim();
  const a = flat(prev.content), b = flat(cur.content);
  const bare = (t) => /^\s*chương\s*\d+\s*[:：.\-–—]*\s*$/i.test(t);
  if (bare(prev.title) && !bare(cur.title)) prev.title = cur.title;       // giữ tên chương đầy đủ hơn
  if (!b || a === b || a.includes(b)) return 'dup';
  if (b.includes(a)) { prev.content = cur.content; return 'dup'; }        // bản mới đầy đủ hơn
  if (b.length > 120 && a.includes(b.slice(0, 120))) return 'dup';
  prev.content = prev.content.replace(/\s+$/, '') + '\n\n' + cur.content;
  return 'merge';
}

async function run() {
  let url = $('url').value.trim();
  if (!SITE_URL_RE.test(url)) {
    $('status').textContent = '⚠️ Hãy nhập link truyện hoặc link chương dạng https://truyenfull.live/..., https://truyenfull.win/... hoặc https://sstruyen.pics/...';
    return;
  }
  const max = Math.max(0, parseInt($('count').value) || 0); // 0 = tất cả
  const delay = Math.max(0, parseInt($('delay').value) || 0);
  const startChap = Math.max(0, parseInt($('startchap').value) || 0); // 0 = từ đầu / từ link đã nhập
  const minWords = Math.max(0, parseInt($('minwords').value) || 0); // 0 = không gộp
  const size = Math.max(0, parseInt($('batchsize').value) || 0); // 0 = không chia lô

  stopFlag = false;
  $('run').disabled = true; $('stop').disabled = false;
  $('copy').disabled = true; $('save').disabled = true;
  batches = []; curBatch = 0; showBatch(0);

  extraDelay = 0;
  // Chạy tiếp từ chương kế sau lần dừng trước: giữ lại các chương đã lấy
  let chapters = [];
  if (carryNext && url === carryNext && carry.length && !startChap) chapters = carry; else { carry = []; removedLog = []; copiedSet.clear(); }
  const startDone = chapters.length;
  let copiedFirst = false; // đã tự copy lô 1 trong lượt chạy này chưa
  let done = chapters.length, novelName = '', lastRefresh = 0;
  const warns = [];
  const fixTotals = {};
  const auto = $('autofix').checked;
  const o = { links: $('o_links').checked, words: $('o_words').checked, emoji: $('o_emoji').checked,
              titles: $('o_title').checked, source: $('o_source').checked,
              social: !$('o_social') || $('o_social').checked, notice: !$('o_notice') || $('o_notice').checked };
  const cx = {
    list: (auto && o.words && typeof parseWords === 'function') ? parseWords($('badwords').value) : [],
    wordsStr: $('badwords').value,
    totals: fixTotals, stats: { links: 0, emoji: 0, titles: 0 }, o
  };
  const fixNote = () => {
    const parts = Object.entries(fixTotals).map(([w, n]) => `từ "${w}" ×${n}`);
    const st = cx.stats;
    if (st.links) parts.push(`xóa ${st.links} link/số điện thoại`);
    if (st.emoji) parts.push(`xóa ${st.emoji} emoji`);
    if (st.titles) parts.push(`sửa ${st.titles} tên chương viết hoa`);
    if (parts.length) warns.push('🔧 Đã tự sửa khi lấy nội dung: ' + parts.join(', '));
    if (removedLog.length) warns.push(`🧹 Đã xóa/sửa ${removedLog.length} chỗ (từ bị cấm, emoji, dấu chấm, quảng cáo, ghi nguồn, link...) — mở mục "Xem lại" bên dưới để kiểm tra có sửa/xóa nhầm không.`);
  };
  let endNote = '';
  $('warn').textContent = '';
  const seen = new Set();
  let skipRun = 0; // số chương lỗi liên tiếp đã bỏ qua

  try {
    if (startChap > 0) {
      // Bắt đầu từ chương do bạn nhập (không cần tự mở chương đó)
      const found = await locateChapter(url, startChap, delay);
      novelName = found.novel || ''; url = found.url;
    } else if (!CHAPTER_RE.test(url)) {
      $('status').textContent = 'Đang đọc trang truyện để tìm chương đầu...';
      const first = findFirstChapter(await getHtml(url), url);
      if (!first) throw new Error('Không tìm thấy link chương đầu trên trang truyện này.');
      novelName = first.novel; url = first.url;
    }

    while (url && !seen.has(url) && !stopFlag) {
      seen.add(url);
      let page = null, errMsg = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        page = null; errMsg = '';
        try { page = parsePage(await getHtml(url), url); }
        catch (e) { if (e.fatal) throw e; errMsg = e.message; }
        if ((page && page.content) || /HTTP (404|410)\b/.test(errMsg) || stopFlag) break;
        // Lỗi tạm thời (trang quá tải...): nghỉ rồi thử lại trước khi bỏ qua chương
        if (attempt < 2) await waitSeconds(WAIT_SEC, `⏳ ${chapLabel(url)} đọc lỗi, thử lại sau`);
      }
      if (!page || !page.content) {
        // Chương lỗi / không có nội dung: bỏ qua và sang chương kế tiếp
        const label = chapLabel(url);
        warns.push(`⚠️ Bỏ qua ${label}: ${errMsg || 'không đọc được nội dung'} (${url})`);
        $('warn').textContent = warns.join('\n');
        if (++skipRun >= 3) {
          endNote = '⚠️ Dừng vì 3 chương liên tiếp bị lỗi/không có nội dung (có thể đã hết truyện).';
          url = null; break;
        }
        const nx = page && page.next && CHAPTER_RE.test(page.next) ? page.next : guessNext(url);
        if (!nx) { endNote = '⚠️ Dừng vì không xác định được chương kế tiếp sau chương lỗi.'; url = null; break; }
        $('status').textContent = `⚠️ Bỏ qua ${label}, sang chương kế...`;
        url = nx;
        await sleep(delay + extraDelay);
        continue;
      }
      skipRun = 0;
      if (done === 0) {
        fileName = (novelName || page.novel).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'truyen';
      }
      const logStart = removedLog.length;
      const chObj = auto ? autoClean(page.chapter, page.content, cx) : { title: page.chapter, content: page.content };
      // Ngoại truyện: thêm "Chương N:" phía trước (N nối tiếp số chương liền trước)
      if (SIDE_TITLE_RE.test(chObj.title)) {
        let t = chObj.title;
        // tên viết HOA toàn bộ: đổi như tùy chọn "Sửa tên chương viết hoa toàn bộ" (nếu đang bật)
        if ($('o_title') && $('o_title').checked && t === t.toUpperCase() && /\p{L}/u.test(t)) {
          t = t.toLowerCase().replace(/(^|[\s:\-–—])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
        }
        const pv = chapters.length ? /^\s*chương\s*(\d+)/i.exec(chapters[chapters.length - 1].title) : null;
        chObj.title = pv ? `Chương ${parseInt(pv[1], 10) + 1}: ${t}` : t;
      }
      chObj.vol = page.vol;
      const prevCh = chapters.length ? chapters[chapters.length - 1] : null;
      const merged = prevCh ? mergeIntoPrev(prevCh, chObj) : null;
      if (merged) {
        // trùng số chương với chương liền trước: không thêm tiêu đề mới (chỉ bỏ bản trùng / nối tiếp nội dung)
        if (page.removed) page.removed.forEach((r) => removedLog.push({ ...r, ch: prevCh.title }));
        for (let q = logStart; q < removedLog.length; q++) { removedLog[q].ci = prevCh.ci; removedLog[q].ch = prevCh.title; }
        warns.push(`⚠️ ${prevCh.title}: trang ${chapLabel(url)} cũng ghi cùng số chương — ${merged === 'dup' ? 'nội dung trùng nên đã bỏ bản lặp' : 'đã nối tiếp vào chương này, không tạo thêm tiêu đề'}`);
      } else {
        if (page.removed) page.removed.forEach((r) => removedLog.push({ ...r, ch: chObj.title })); // dùng tên chương cuối cùng để bấm tới đúng chỗ
        chapters.push(chObj);
        chObj.ci = chapters.length - 1;
        for (let q = logStart; q < removedLog.length; q++) removedLog[q].ci = chObj.ci;
      }
      done++;
      // Lô 1 vừa đủ số chương (chỉ khi lô 1 hoàn thành ngay trong lượt chạy này): tự copy luôn
      if (size && !copiedFirst && startDone < size && chapters.length >= size) { copiedFirst = true; copyFirstBatchNow(chapters, minWords, size).catch(() => {}); } // không await: việc copy không được làm chậm/đứng vòng lấy chương
      const words = countWords(page.content);
      if (words < 300) warns.push(`⚠️ ${page.chapter}: chỉ có ${words} chữ (có thể bị thiếu nội dung)`);
      $('status').textContent = `Đã lấy ${done} chương${max ? ` (đợt này ${done - startDone}/${max})` : ''}: ${page.chapter} (${words} chữ)`;
      // Truyện dài: cập nhật khung kết quả thưa dần để không làm trang chậm/đơ
      if (done % (done <= 100 ? 10 : 50) === 0 && Date.now() - lastRefresh > 3000) { refreshOutput(chapters, minWords, size); lastRefresh = Date.now(); }
      url = page.next && CHAPTER_RE.test(page.next) ? page.next : null;
      if (max && done - startDone >= max) break;
      if (!url) {
        endNote = page.next
          ? `⚠️ Dừng vì link chương sau không đúng dạng chương: ${page.next}`
          : `ℹ️ Dừng vì không thấy link "chương sau" ở ${page.chapter} (có thể là chương cuối, hoặc trang đổi giao diện).`;
      } else await sleep(delay + extraDelay);
    }

    if (!stopFlag && url && seen.has(url)) endNote = `⚠️ Dừng vì link chương bị lặp lại: ${url}`;
    if (!stopFlag && endNote) warns.push(endNote);
    fixNote();
    // Chưa hết truyện (dừng / đủ số chương): điền sẵn link chương kế để chạy tiếp, giữ nguyên các chương đã lấy
    const resume = url && !seen.has(url) ? url : '';
    if (resume) { $('url').value = resume; carry = chapters; carryNext = resume; } else { carry = []; carryNext = ''; }
    $('warn').textContent = warns.join('\n');
    const built = refreshOutput(chapters, minWords, size);
    renderRemoved(removedLog);
    if (typeof renderManual === 'function') renderManual();
    $('status').textContent = done
      ? `✅ Xong ${done} chương gốc${minWords ? ` → ${built.count} chương (mỗi chương ≥ ${minWords} chữ${built.short ? `, còn ${built.short} chương chưa đủ vì hết truyện` : ''})` : ''}${built.split ? `, đã tách ${built.split} phần do chương quá ${MAX_CHARS.toLocaleString('vi-VN')} ký tự` : ''}${built.batches.length > 1 ? `, chia thành ${built.batches.length} lô` : ''}${stopFlag ? ' (đã dừng)' : ''}.${resume ? ' Link chương kế đã điền sẵn ở ô trên — bấm chạy để lấy tiếp, các chương đã lấy được giữ lại.' : ''}`
      : '❌ Không lấy được chương nào.';
    if (done) { $('copy').disabled = false; $('save').disabled = false; }
    if (!stopFlag) {
      notify('tf-done', done ? 'Truyện Extractor — đã lấy xong' : 'Truyện Extractor — không lấy được chương nào',
        done ? `Đã lấy ${done} chương gốc${minWords ? ` → ${built.count} chương` : ''}${resume ? '. Còn chương tiếp theo, bấm chạy để lấy tiếp.' : '.'}`
             : 'Không lấy được chương nào. Hãy kiểm tra link và tab của trang truyện.', !done);
    }
  } catch (e) {
    fixNote();
    $('warn').textContent = warns.join('\n');
    refreshOutput(chapters, minWords, size);
    renderRemoved(removedLog);
    if (typeof renderManual === 'function') renderManual();
    if (done && url) { $('url').value = url; carry = chapters; carryNext = url; }
    const keep = done ? ` (đã giữ ${done} chương lấy được; link chương đang đọc đã điền sẵn — bấm chạy để lấy tiếp)` : '';
    $('status').textContent = e.message === 'Đã dừng.' ? '⏹️ Đã dừng' + keep : '❌ ' + e.message + keep;
    if (done) { $('copy').disabled = false; $('save').disabled = false; }
    if (e.message !== 'Đã dừng.') {
      clearNotify('tf-blocked'); hideAsk();
      notify('tf-error', 'Truyện Extractor — gặp lỗi', e.message.slice(0, 250) + (done ? ` (đã giữ ${done} chương)` : ''), true);
    }
  } finally {
    $('run').disabled = false; $('stop').disabled = true;
  }
}

$('run').onclick = run;
$('stop').onclick = () => { stopFlag = true; };

async function copyOut(auto) {
  const ta = $('out');
  ta.value = stripReminder(ta.value);
  let ok = true;
  try { await navigator.clipboard.writeText(ta.value); }
  catch (e) { try { ta.select(); ok = document.execCommand('copy'); } catch (e2) { ok = false; } }
  const lb = batches.length > 1 ? ` (${batches[curBatch].label})` : '';
  if (!ok) { sheetMsg('⚠️ Chưa sao chép được — hãy bấm "Sao chép" lần nữa.', true); return; }
  if (batches[curBatch]) { copiedSet.add(batches[curBatch].label); updatePicker(); }
  sheetMsg(auto
    ? `📋 Đã chuyển sang ${batches[curBatch].label} và tự sao chép vào clipboard — dán được ngay.`
    : '📋 Đã sao chép vào clipboard' + lb + '.');
}
$('copy').onclick = () => copyOut(false);

$('save').onclick = () => {
  const blob = new Blob([stripReminder($('out').value)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName + (batches.length > 1 ? ' - ' + batches[curBatch].label : '') + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// Điền sẵn link của tab truyenfull đang mở (nếu có)
chrome.tabs.query({ url: SITE_TABS }).then((tabs) => {
  if (tabs[0] && !$('url').value) $('url').value = tabs[0].url;
}).catch(() => {});

// Hai ô "tự sao chép khi chuyển lô" và "tự động sửa khi lấy nội dung" được ẩn và luôn bật.

// Bấm vào thông báo / các nút của thông báo
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    try {
      if (id === 'tf-blocked') { await openVerifyTab(); hideAsk(); }
      else {
        const tab = await chrome.tabs.getCurrent();
        if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
      }
      chrome.notifications.clear(id);
    } catch (e) {}
  });
  // Nút 0 = BỎ QUA, nút 1 = MỞ TAB XÁC MINH
  chrome.notifications.onButtonClicked.addListener(async (id, idx) => {
    if (id !== 'tf-blocked') return;
    hideAsk();
    try { chrome.notifications.clear(id); } catch (e) {}
    if (idx === 1) await openVerifyTab();
  });
  // Người dùng tự tắt thông báo = bỏ qua
  chrome.notifications.onClosed.addListener((id, byUser) => { if (id === 'tf-blocked' && byUser) hideAsk(); });
}


// ---- Hiện danh sách các chỗ đã xóa/sửa để người dùng kiểm tra; bấm vào một mục để tới đúng chỗ trong bản thảo
function findSpot(text, r) {
  // trả về {s, e, approx?} (vị trí chọn trong text) hoặc null.
  // approx = true: không khớp đúng dòng (dòng đó đã bị sửa thêm) nên trả về dòng gần nhất.
  const lineAt = (pos) => {
    const s = text.lastIndexOf('\n', pos - 1) + 1;
    let e = text.indexOf('\n', pos); if (e < 0) e = text.length;
    return { s, e };
  };
  const chPos = r.ch ? text.indexOf(r.ch) : -1;
  if (r.mode === 'top' || !r.anchor) return chPos >= 0 ? lineAt(chPos) : null;
  const key = r.anchor.trim().slice(0, 40);
  if (!key) return chPos >= 0 ? lineAt(chPos) : null;
  // Dòng neo có thể xuất hiện nhiều lần trong chương (vd. "Ừ."): nếu biết dòng liền sau chỗ xóa thì chọn lần xuất hiện có dòng đó đi kèm
  const nextKey = (r.next || '').trim().slice(0, 40);
  const findFrom = (from) => {
    let first = text.indexOf(key, from), p = first;
    while (p >= 0 && nextKey) {
      const L = lineAt(p); let q = L.e + 1;
      while (q < text.length) { const e2 = text.indexOf('\n', q), ln = text.slice(q, e2 < 0 ? text.length : e2); if (ln.trim()) { if (ln.trim().startsWith(nextKey)) return p; break; } if (e2 < 0) break; q = e2 + 1; }
      p = text.indexOf(key, p + 1);
    }
    return first;
  };
  let pos = findFrom(Math.max(chPos, 0));
  if (pos < 0 && chPos > 0) pos = findFrom(0); // tên chương đã bị đánh số lại: tìm trên toàn bộ
  if (pos >= 0) return lineAt(pos);
  // Không khớp đúng: dò dòng giống nhất trong chương (chặt trước, lỏng sau), cuối cùng mới về dòng tên chương
  const f = fuzzyLine(text, r, chPos, 0.6, 2) || fuzzyLine(text, r, chPos, 0.34, 1);
  if (f) return { ...f, approx: true };
  return chPos >= 0 ? { ...lineAt(chPos), approx: true, chapterOnly: true } : null;
}

// Dò gần đúng: trong chương (hoặc toàn văn nếu không thấy tên chương) tìm dòng có nhiều từ trùng nhất với dòng đã sửa
function fuzzyLine(text, r, chPos, minScore = 0.6, minTok = 2) {
  const toks = (x) => (String(x).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
  const want = new Set(toks(r.line || r.anchor || ''));
  if (want.size < minTok) return null;
  let pos = 0, best = null, bestScore = 0, inCh = chPos < 0;
  for (const ln of text.split('\n')) {
    const s = pos; pos += ln.length + 1;
    if (!inCh) { if (s >= chPos) inCh = true; else continue; }
    else if (chPos >= 0 && s > chPos && /^\s*(?:(?:quyển|quyen)\s*\d+\s*[-–—:.,]?\s*)?chương\s*\d+/i.test(ln)) break; // hết chương
    if (!ln.trim()) continue;
    const have = new Set(toks(ln)); let hit = 0;
    want.forEach((w) => { if (have.has(w)) hit++; });
    const score = hit / want.size;
    if (score > bestScore) { bestScore = score; best = { s, e: s + ln.length }; }
  }
  return bestScore >= minScore ? best : null;
}

function scrollTextareaTo(ta, pos) {
  // Cuộn ô văn bản để dòng chứa vị trí pos nằm khoảng 1/3 từ trên xuống.
  // Đo bằng một khung ẩn có cùng kiểu chữ, cùng lề và cùng bề rộng NỘI DUNG của ô thật (clientWidth đã trừ thanh cuộn),
  // rồi lấy đúng toạ độ của một ký tự đánh dấu đặt tại vị trí cần tới (không ước lượng theo số dòng).
  const cs = getComputedStyle(ta);
  const m = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize',
    'textTransform', 'fontKerning', 'fontVariantLigatures', 'fontFeatureSettings', 'whiteSpace', 'overflowWrap', 'wordBreak',
    'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].forEach((k) => { m.style[k] = cs[k]; });
  m.style.cssText += ';position:absolute;visibility:hidden;left:-9999px;top:0;box-sizing:border-box;border:0;overflow:hidden;';
  m.style.width = ta.clientWidth + 'px';
  m.textContent = ta.value.slice(0, pos);
  const mk = document.createElement('span'); mk.textContent = '\u200b';
  m.appendChild(mk);
  document.body.appendChild(m);
  const y = mk.offsetTop; // đỉnh dòng chứa vị trí pos (đã gồm lề trên của ô)
  m.remove();
  ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
}

// Chọn đoạn [s, e] trong ô bản thảo rồi cuộn tới đúng dòng đó (dùng cho "Tới chương N" và mục "Xem lại")
function selectAndShow(ta, s, e) {
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(s, e);
  scrollTextareaTo(ta, s);
  ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); // chỉ cuộn trang để thấy ô; vị trí cuộn trong ô giữ nguyên
  requestAnimationFrame(() => scrollTextareaTo(ta, s));       // đặt lại sau khi bố cục ổn định (phòng khi font vừa tải xong)
}

function jumpTo(r) {
  const ta = $('out');
  saveCurrentBatch();
  let hit = null, bi = -1;
  const rr = r.och ? { ...r, ch: r.och } : r; // tên chương SAU khi gộp/đánh số lại
  if (batches.length) {
    // ưu tiên lô đã biết, rồi lô có tên chương, sau đó thử mọi lô
    const order = batches.map((_, i) => i);
    const first = r.bi >= 0 ? [r.bi] : [];
    const pref = rr.ch ? order.filter((i) => batches[i].text.includes(rr.ch)) : [];
    let approx = null, abi = -1;
    for (const i of [...first, ...pref, ...order]) {
      const f = findSpot(batches[i].text, rr);
      if (!f) continue;
      if (!f.approx) { hit = f; bi = i; break; }
      if (!approx) { approx = f; abi = i; } // nhớ chỗ gần đúng đầu tiên, vẫn thử các lô khác để tìm chỗ khớp đúng
    }
    if (!hit && approx) { hit = approx; bi = abi; }
  } else {
    hit = findSpot(ta.value, rr);
  }
  if (!hit) { sheetMsg('⚠️ Không tìm thấy chương này trong bản thảo (có thể bạn đã sửa tay hoặc xóa đoạn đó).'); return; }
  if (bi >= 0 && bi !== curBatch) showBatch(bi);
  selectAndShow(ta, hit.s, hit.e);
  const where = hit.chapterOnly ? 'Không tìm thấy đúng dòng (có thể đã sửa thêm), đã chọn dòng tên chương gần nhất.'
    : hit.approx ? 'Không khớp hoàn toàn (dòng đã sửa thêm), đã chọn dòng gần nhất.'
    : r.mode === 'after' ? 'Dòng đang chọn là dòng NGAY TRÊN chỗ đã xóa.'
    : r.mode === 'before' ? 'Chỗ xóa nằm ở đầu đoạn, không có dòng phía trên nên chọn dòng NGAY DƯỚI chỗ đã xóa.'
    : r.mode === 'top' ? 'Chỗ sửa ở đầu chương (dòng tên chương được chọn).'
    : 'Dòng đang được chọn là dòng đã được sửa.';
  sheetMsg('📍 ' + where);
}

function renderRemoved(list) {
  const box = $('rmbox');
  if (!box) return;
  saveCurrentBatch();
  box.hidden = !list.length;
  window.__rmList = list;
  if (!list.length) return;
  const clip = (x) => (x.length > 300 ? x.slice(0, 300) + '…' : x);
  const shortCh = (x) => { const m = /^\s*chương\s*\d+/i.exec(x); return m ? m[0].replace(/^\s*chương/i, 'Chương') : String(x).slice(0, 30); };

  // chương gốc (ci) -> lô + tên chương sau khi gộp; mục không có ci (do nút "Tự sửa") thì dò theo tên chương
  const byCi = new Map();
  batches.forEach((b, bi) => { if (b.map) b.map.forEach((title, k) => { if (!byCi.has(k)) byCi.set(k, { bi, title }); }); });
  const place = (r) => {
    if (r.ci != null && byCi.has(r.ci)) return byCi.get(r.ci);
    if (r.bi0 != null && batches[r.bi0]) return { bi: r.bi0, title: r.ch || '' }; // mục do nút "Tự sửa" (toàn bộ lô): biết sẵn lô
    let bi = r.ch ? batches.findIndex((b) => b.text.includes(r.ch)) : -1;
    if (bi < 0 && r.ci == null && batches.length) bi = curBatch;
    return { bi, title: r.ch || '' };
  };

  // gom theo lô; trong lô, các mục giống hệt nhau (vd. cùng một dòng quảng cáo ở nhiều chương) gộp thành 1 dòng ×N
  const groups = new Map();
  list.forEach((r) => {
    const p = place(r);
    r.bi = p.bi; r.och = p.title; r.lo = p.bi >= 0 && batches[p.bi] ? batches[p.bi].label : '';
    let g = groups.get(p.bi); if (!g) { g = { rows: new Map(), total: 0 }; groups.set(p.bi, g); }
    g.total++;
    const key = r.kind + '|' + r.before + '|' + r.after;
    let row = g.rows.get(key); if (!row) { row = { r, items: [], titles: [] }; g.rows.set(key, row); }
    row.items.push(r); if (r.och && !row.titles.includes(r.och)) row.titles.push(r.och);
  });

  const rowsTotal = [...groups.values()].reduce((a, g) => a + g.rows.size, 0);
  $('rmsum').textContent = `🧹 Xem lại ${list.length} chỗ đã xóa/sửa (${rowsTotal} mục${groups.size > 1 ? `, ${groups.size} lô` : ''}) — bấm vào từng mục để tới chỗ đó`;
  const wrap = $('rmlist');
  wrap.textContent = '';
  const MAX = 300;
  [...groups.keys()].sort((a, b) => (a < 0 ? 1e9 : a) - (b < 0 ? 1e9 : b)).forEach((bi) => {
    const g = groups.get(bi);
    const rows = [...g.rows.values()];
    const det = document.createElement('details'); det.className = 'rm-lo';
    det.open = groups.size === 1 || bi === curBatch;
    const sm = document.createElement('summary');
    sm.textContent = `${bi >= 0 && batches[bi] ? batches[bi].label : 'Bản thảo'} — ${g.total} chỗ`;
    det.appendChild(sm);
    rows.slice(0, MAX).forEach((row) => {
      const r = row.r, n = row.items.length, t = row.titles;
      const where = !t.length ? '' : t.length === 1 ? t[0] : (t.length > 4 ? t.slice(0, 3).map(shortCh).join(', ') + ` … (+${t.length - 3} chương)` : t.map(shortCh).join(', '));
      const el = document.createElement('div'); el.className = 'rm-row'; el.tabIndex = 0; el.setAttribute('role', 'button');
      el.title = 'Bấm để tới chỗ này trong bản thảo' + (n > 1 ? ' (bấm tiếp để sang chỗ kế)' : '');
      const h = document.createElement('div'); h.className = 'rm-h';
      h.textContent = (where ? where + ' · ' : '') + r.kind + (n > 1 ? `  ×${n}` : '') + '  ↪ tới chỗ này';
      const b = document.createElement('div'); b.className = 'rm-b'; b.textContent = clip(r.before);
      el.append(h, b);
      if (r.after) { const a = document.createElement('div'); a.className = 'rm-a'; a.textContent = '→ ' + clip(r.after); el.append(a); }
      let k = 0;
      const go = () => { const idx = k % n; jumpTo(row.items[idx]); if (n > 1) $('sheetMsg').textContent += ` (chỗ ${idx + 1}/${n})`; k++; };
      el.onclick = go;
      el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
      det.appendChild(el);
    });
    if (rows.length > MAX) {
      const m = document.createElement('div'); m.className = 'rm-h';
      m.textContent = `… và ${rows.length - MAX} mục nữa trong lô này (bấm "Sao chép danh sách" để lấy đầy đủ).`;
      det.appendChild(m);
    }
    wrap.appendChild(det);
  });
}
if ($('rmcopy')) $('rmcopy').onclick = async () => {
  const txt = (window.__rmList || []).map((r) => `[${[r.lo, r.och || r.ch, r.kind].filter(Boolean).join(' · ')}]\n- ${r.before}${r.after ? '\n+ ' + r.after : ''}`).join('\n\n');
  try { await navigator.clipboard.writeText(txt); } catch (e) { /* bỏ qua */ }
  sheetMsg('📋 Đã sao chép danh sách các chỗ đã xóa/sửa.');
};
