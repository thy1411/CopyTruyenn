// Kiểm tra & tự sửa nội dung theo "Quy định về nội dung" của tieuthuyet.vn
// Phần logic thuần (không đụng DOM) nằm ở trên để dễ test; phần giao diện nằm cuối file.

const TITLE_RE = /^\s*(?:(?:quyển|quyen|volume|vol\.?)\s*\d+\s*[-–—:.,]?\s*)?chương\s*\d+/i;
const wc = (s) => (String(s).match(/\S+/g) || []).length;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const RE = {
  // link, tên miền trần (abc.com, abc.vn...)
  link: /(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}@])[a-z0-9-]+\.(?:com|vn|net|org|live|xyz|info|me|cc|tv|club|top)(?:\/\S*)?(?![\p{L}\p{N}])/giu,
  phone: /(?<!\d)(?:\+?84|0)[\s.\-]?\d{2,3}[\s.\-]?\d{3}[\s.\-]?\d{3,4}(?!\d)/g,
  social: /(?<![\p{L}\p{N}])(zalo|facebook|fanpage|telegram|tiktok|instagram|momo|stk|số tài khoản)(?![\p{L}\p{N}])/giu,
  emoji: /[\p{Extended_Pictographic}\uFE0F]/gu,
  badEllipsis: /…|\.{4,}|(?<!\.)\.\.(?!\.)/g,
  spaceBefore: /[ \t]+(?:\.\.\.|[,.;:!?])/g,
  noSpaceAfter: /(?:\.\.\.|[,;:!?])(?=\p{L})|(?<=\p{Ll})\.(?=\p{Lu})/gu,
  notice: /^[ \t]*[\[(【]?\s*(?:thông báo|lưu ý|ghi chú|lời tác giả|lời của tác giả|tác giả\s*:|ps\s*:)/gim,
  intro: /giới thiệu nhân vật|lời tác giả|lời của tác giả/i,
  // Dòng ghi nguồn / người dịch: "Nguồn: TruyenYY.", "Source: ...", "Dịch giả: ...", "(Truyện - Được dịch bởi diễn đàn TruyenYY)"
  sourceLine: /^[ \t\u200b-\u200d\ufeff*_>\-–—•\[(【《「]*(?:(?:nguồn(?:\s*(?:truyện|dịch|convert))?|source|dịch\s*giả|người\s*dịch|dịch\s*bởi|converter|convert\s*by|biên\s*tập(?:\s*viên)?|editor|edit\s*by|beta(?:\s*reader)?|nhóm\s*dịch|(?:dịch|edit|biên\s*tập|convert|beta)\s*[\/&+]\s*(?:dịch|edit|biên\s*tập|convert|beta(?:\s*reader)?))\s*[:：]|truyện\s*[-–—:]?\s*(?:được\s*)?(?:dịch|convert|đăng|edit|biên\s*tập|chuyển\s*ngữ)[^\n]{0,20}?(?:bởi|by)\b|(?:được\s*)?(?:dịch|convert|đăng)\s*(?:bởi|by)\s+(?:diễn\s*đàn|nhóm|website|trang|web)|truyện\s*được\s*đăng\s*tải\s*duy\s*nhất\s*tại)[^\n]{0,120}$/gimu
};
// Tên miền trần (abc.com, TruyenDich.vn...), dùng để nhận ra dòng/đoạn ghi nguồn
const DOMAIN_SRC = '[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.(?:com|net|org|vn|info|me|cc|xyz|live|win|top|vip|club|site|online|io|co|tv|app|blog|asia|store)(?![\\p{L}\\p{N}])(?:\\/\\S*)?';
// Đoạn ghi nguồn nằm xen trong dòng văn:
//  1) trong ngoặc, bắt đầu bằng "nguồn"/"source":  (nguồn dịch từ truyenDich.vn)
//  2) trong ngoặc "dịch/convert/đăng bởi|từ ..." có tên miền hoặc diễn đàn/nhóm/website
//  3) không ngoặc: "nguồn truyenYY.com", "nguồn dịch từ abc.vn", "source: abc.com"
RE.sourceInline = new RegExp(
  '[\\(\\[【《「]\\s*(?:nguồn|source)[^\\)\\]】》」\\n]{0,100}[\\)\\]】》」]' +
  '|[\\(\\[【《「]\\s*(?:được\\s+)?(?:dịch|convert|đăng|edit)\\s+(?:bởi|từ|by|tại|trên|from)[^\\)\\]】》」\\n]{0,100}?(?:' + DOMAIN_SRC + '|diễn\\s*đàn|nhóm|website)[^\\)\\]】》」\\n]{0,60}[\\)\\]】》」]' +
  '|(?<![\\p{L}\\p{N}])(?:nguồn(?:\\s+(?:truyện|dịch|convert))?|source)\\s*[:：]?\\s*(?:(?:từ|from)\\s+)?' + DOMAIN_SRC,
  'giu');
// Tên trang truyenfull (kể cả gõ nhầm "truongfull") có hoặc không kèm đuôi
const BRAND_SRC = '(?:truy[eêệ]n|truong)\\s*full(?:\\s*(?:vn|live|com|win))?(?:\\.[a-z]{2,4})?(?![\\p{L}\\p{N}])';
RE.sourceInline = new RegExp(RE.sourceInline.source.split(DOMAIN_SRC).join('(?:' + DOMAIN_SRC + '|' + BRAND_SRC + ')'), 'giu');
// Chữ "nguồn / source (từ|tại|trên)" đứng ngay trước link/tên miền -> bỏ luôn khi xóa link
const PRE_LINK_RE = new RegExp('(?<![\\p{L}\\p{N}])(?:nguồn(?:\\s+(?:truyện|dịch|convert))?|source)\\s*[:：]?\\s*(?:(?:từ|tại|trên|from)\\s+)?(?=' + RE.link.source + ')', 'giu');
const SOURCE_LINE_ONE = new RegExp(RE.sourceLine.source, 'imu');

// Xử lý một dòng: trả về dòng đã bỏ phần ghi nguồn, hoặc null nếu cả dòng là ghi nguồn
function cleanSourceLine(line) {
  let n = line.replace(RE.sourceInline, '');
  if (SOURCE_LINE_ONE.test(n)) n = '';
  if (n === line) return line;
  n = n.replace(/[ \t]{2,}/g, ' ').replace(/[\s\-–—|·,;:]+$/, '');
  return n.trim() ? n : null;
}
// So sánh các dòng trước/sau khi xử lý -> danh sách thay đổi kèm "mỏ neo" (dòng còn lại gần chỗ đó) để nút "tới chỗ này" tìm lại được vị trí.
//  results[i] = dòng mới (chuỗi) hoặc null/'' nếu dòng bị xóa. mode: 'at' = dòng đã sửa, 'after' = xóa ngay sau dòng neo, 'before' = xóa ngay trước dòng neo
function lineChanges(lines, results, kind, ch) {
  const live = (j) => results[j] !== null && String(results[j]).trim() !== '';
  const out = [];
  lines.forEach((l, i) => {
    if (results[i] === l) return;
    const r = results[i];
    const e = { ch: ch || '', kind, before: l.trim(), after: r === null ? '' : String(r).trim() };
    if (e.after) { e.anchor = e.after; e.mode = 'at'; }
    else {
      let k = i - 1; while (k >= 0 && !live(k)) k--;
      if (k >= 0) {
        e.anchor = String(results[k]).trim(); e.mode = 'after';
        let n = i + 1; while (n < lines.length && !live(n)) n++;
        if (n < lines.length) e.next = String(results[n]).trim(); // dòng liền sau chỗ xóa, để phân biệt khi dòng neo trùng nhau
      }
      else { k = i + 1; while (k < lines.length && !live(k)) k++; if (k < lines.length) { e.anchor = String(results[k]).trim(); e.mode = 'before'; } }
    }
    out.push(e);
  });
  return out;
}

// Liệt kê các dòng sẽ bị xóa/sửa bởi ô "ghi nguồn" và "link" (để báo cho người dùng xem lại)
function collectRemovals(text, o) {
  const lines = String(text).split('\n');
  // gom theo chương để mỗi mục biết thuộc chương nào
  const chOf = []; let ch = '';
  lines.forEach((l, i) => { if (TITLE_RE.test(l)) ch = l.trim(); chOf[i] = ch; });
  const out = [];
  if (o.source) {
    const rs = lines.map(cleanSourceLine);
    lineChanges(lines, rs, 'ghi nguồn / người dịch', '').forEach((e) => out.push(e));
  }
  if (o.links) {
    const rs = lines.map((l) => (o.source && cleanSourceLine(l) !== l) ? l : l.replace(PRE_LINK_RE, '').replace(RE.link, '').replace(RE.phone, ''));
    lineChanges(lines, rs, 'link / tên miền / số điện thoại', '').forEach((e) => out.push(e));
  }
  // gắn tên chương cho từng mục (tìm theo dòng gốc)
  const idxOf = new Map(); lines.forEach((l, i) => { const k = l.trim(); if (!idxOf.has(k)) idxOf.set(k, i); });
  out.forEach((e) => { const i = idxOf.get(e.before); e.ch = i != null ? chOf[i] : ''; });
  return out;
}
const stripSourceLines = (t) => String(t).split('\n')
  .map(cleanSourceLine).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');


// ---- Tự xử lý hai nhóm trước đây phải "tự xem": dòng quảng cáo Zalo/Facebook/ngân hàng và dòng thông báo/lời tác giả.
// Chỉ xóa khi dòng NHÌN GIỐNG quảng cáo / ghi chú của tác giả; những dòng chỉ nhắc thoáng trong truyện
// (vd. "Anh mở Facebook lên xem") hoặc thông báo của hệ thống trong truyện thì giữ nguyên và vẫn báo "cần tự xem".
const _SOC = /(?<![\p{L}\p{N}])(zalo|facebook|fanpage|fan page|telegram|tiktok|instagram|momo|stk|số tài khoản)(?![\p{L}\p{N}])/iu;
const _SOC_STRONG = /(?<![\p{L}\p{N}])(momo|stk|số tài khoản|ngân hàng|vietcombank|techcombank|mbbank|vietinbank|agribank|bidv|donate|ủng hộ)(?![\p{L}\p{N}])/iu;
const _SOC_CTA = /(?<![\p{L}\p{N}])(fanpage|fan page|tham gia|theo dõi|liên hệ|inbox|kênh|group|nhóm|follow|đăng ký|kết bạn|add|ib|vào|truy cập)(?![\p{L}\p{N}])/iu;
const _DIALOG = /^[\s\u200b-\u200d\ufeff]*[-–—"“”'‘「『]/;
// Lời kêu gọi đăng ký kênh: "Mời mọi người đăng ký kênh youtube để kênh đạt mốc 10k sub ạ"
const _YT = /(?<![\p{L}\p{N}])(?:youtube|you\s*tube|subscribe|đăng\s*ký\s*kênh|theo\s*dõi\s*kênh|kênh\s*youtube|sub|subs)(?![\p{L}\p{N}])/iu;
const _YT_CTA = /(?<![\p{L}\p{N}])(?:mời|đăng\s*ký|subscribe|theo\s*dõi|ủng\s*hộ|like|share|bấm|nhấn|chuông)(?![\p{L}\p{N}])/iu;
function isPromoSocialLine(l) {
  l = String(l);
  if (!_DIALOG.test(l) && _YT.test(l) && _YT_CTA.test(l) && wc(l) <= 40) return true;
  if (!_SOC.test(l) || _DIALOG.test(l)) return false;
  if (_SOC_STRONG.test(l)) return true;
  if (/@\w|(?<!\d)\d{8,}(?!\d)/.test(l)) return true;           // có tên tài khoản hoặc dãy số dài
  return _SOC_CTA.test(l) && wc(l) <= 40;                          // lời kêu gọi ngắn: "Tham gia nhóm Zalo..."
}
const _NOTE_ALWAYS = /^[\s\u200b-\u200d\ufeff*_>\-–—•]*[\[(【]?\s*(?:lời tác giả|lời của tác giả|tác giả\s*(?:có lời)?\s*:|ps\s*:|p\/s\s*:)/i;
const _NOTE_HEAD = /^[\s\u200b-\u200d\ufeff*_>\-–—•]*[\[(【]?\s*(?:thông báo|lưu ý|ghi chú)\s*[:：\]\)】]/i;
const _NOTE_META = /(?<![\p{L}\p{N}])(tác giả|độc giả|các bạn|mọi người|quý vị|chương mới|ra chương|tăng chương|nghỉ|xin phép|cập nhật|update|đề cử|nguyệt phiếu|vote|bình luận|ủng hộ|cầu|xin|lịch ra|bom chương|thêm chương)(?![\p{L}\p{N}])/iu;
function isAuthorNoteLine(l) {
  l = String(l);
  if (_NOTE_ALWAYS.test(l)) return true;
  return _NOTE_HEAD.test(l) && _NOTE_META.test(l);
}

// ---- Khối xin ủng hộ / số tài khoản (nhiều dòng liền nhau), vd:
//   Số TK: 1809205083252 / NGUYEN PHUOC HAU / Paypal: / Ngân hàng Agribank ạ. (Chi nhánh: ...) / Viettelpay: 970... / Chân thành cảm ơn
// Cần có ít nhất 1 dòng "chắc chắn" (số TK, Paypal, Viettelpay, Momo, chuyển khoản...) làm mốc; rồi lấy thêm các dòng liền kề
// trông như một phần của khối đó (tên chủ tài khoản viết hoa, tên ngân hàng/chi nhánh, dãy số dài, lời cảm ơn, lời xin ủng hộ).
const _PAY_SEED = /(?<![\p{L}\p{N}])(?:số\s*(?:tk|t\.k|tài\s*khoản|stk)|stk|paypal|viettel\s*-?\s*pay|zalo\s*-?\s*pay|shopee\s*-?\s*pay|vnpay|momo|donate|ko-?fi|patreon|buy\s*me\s*a\s*coffee|tài\s*khoản\s*(?:ngân\s*hàng|ngan\s*hang))(?![\p{L}\p{N}])/iu;
const _BANK = /(?<![\p{L}\p{N}])(?:ngân\s*hàng|ngan\s*hang|chi\s*nhánh|agribank|vietcombank|techcombank|mb\s*bank|mbbank|vietinbank|bidv|acb|sacombank|tpbank|vpbank|vib|shb|hdbank|ocb|eximbank|scb|seabank|msb)(?![\p{L}\p{N}])/iu;
const _THANKS = /(?<![\p{L}\p{N}])(?:cảm\s*ơn|cám\s*ơn|tri\s*ân|xin\s*cảm\s*tạ)(?![\p{L}\p{N}])/iu;
const _BEG = /(?<![\p{L}\p{N}])(?:ủng\s*hộ|mời\s+(?:tác\s*giả|dịch\s*giả|converter|mình)|nuôi\s*(?:converter|dịch\s*giả|tác\s*giả)|tip|donate)(?![\p{L}\p{N}])/iu;
function donationMask(lines) {
  const isTitle = (l) => TITLE_RE.test(l);
  const blank = (l) => !String(l).trim();
  const quoted = (l) => /^[\s\u200b-\u200d\ufeff]*["“”'‘「『]/.test(l);              // lời thoại mở bằng ngoặc kép
  const dashed = (l) => /^[\s\u200b-\u200d\ufeff]*[-–—•*]/.test(l);                 // gạch đầu dòng: có thể là thoại, cũng có thể là danh sách tài khoản
  const hard = (l) => /\d{6,}|[:：]\s*$|\[email|@\w|số\s*(?:tk|t\.k|tài\s*khoản|stk)/i.test(l);  // bằng chứng rõ là thông tin thanh toán
  const seed = (l) => !blank(l) && !isTitle(l) && !quoted(l) && wc(l) <= 25 && _PAY_SEED.test(l) && (!dashed(l) || hard(l));
  const near = (l) => {
    if (blank(l) || isTitle(l) || quoted(l)) return false;
    const n = wc(l), t = l.trim();
    if (seed(l)) return true;
    if (/^[.…\-–—*_~\s]+$/.test(t)) return true;                                        // dòng chỉ có "..." hoặc gạch ngăn cách
    if (_BANK.test(l) && n <= 14) return true;                                            // "Ngân hàng Agribank ạ. (Chi nhánh: ...)"
    if (/^[\d\s.\-–—:]{8,}$/.test(t)) return true;                                          // chỉ có dãy số dài
    if (n <= 6 && !/\d/.test(t) && /\p{L}/u.test(t) && t === t.toUpperCase()) return true;  // tên chủ tài khoản VIẾT HOA
    if (_THANKS.test(l) && n <= 12) return true;                                           // "Chân thành cảm ơn"
    if (_BEG.test(l) && n <= 25) return true;                                              // "Ai có lòng ủng hộ e thì đây ạ:"
    if (n <= 10 && (/(?<![\p{L}\p{N}])chúc\s.{0,30}(?:ngủ\s*ngon|vui\s*vẻ|khỏe|ngon\s*giấc)/iu.test(l) || /&lt;?3|<3/i.test(l))) return true; // lời chào cuối: "Chúc cả nhà ngủ ngon <3"
    return false;
  };
  const mask = lines.map(() => false);
  lines.forEach((l, i) => {
    if (!seed(l)) return;
    mask[i] = true;
    for (const dir of [-1, 1]) {            // mở rộng lên trên / xuống dưới, bỏ qua dòng trống
      let j = i + dir;
      while (j >= 0 && j < lines.length) {
        if (blank(lines[j])) { j += dir; continue; }
        if (!near(lines[j])) break;
        mask[j] = true; j += dir;
      }
    }
  });
  return mask;
}

// Xóa cả dòng thỏa pred; trả về { text, log } (log theo định dạng lineChanges, đã gắn tên chương)
function removeLinesLogged(text, pred, kind, maskFn) {
  const lines = String(text).split('\n'), chOf = []; let ch = '';
  lines.forEach((l, i) => { if (TITLE_RE.test(l)) ch = l.trim(); chOf[i] = ch; });
  const mask = maskFn ? maskFn(lines) : null;
  const rs = lines.map((l, i) => (!TITLE_RE.test(l) && (mask ? mask[i] : pred(l)) ? null : l));
  const log = lineChanges(lines, rs, kind, '');
  const idxOf = new Map(); lines.forEach((l, i) => { const k = l.trim(); if (!idxOf.has(k)) idxOf.set(k, i); });
  log.forEach((e) => { const i = idxOf.get(e.before); e.ch = i != null ? chOf[i] : ''; });
  return { text: rs.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n'), log };
}

// Che chữ tự động: "thủ tướng" -> "[t.h.ủ t.ư.ớ.n.g]" (mỗi chữ cái cách nhau bằng dấu chấm, các từ cách nhau bằng dấu cách)
const dotify = (w) => '[' + w.normalize('NFC').split(/\s+/).filter(Boolean).map((x) => Array.from(x).join('.')).join(' ') + ']';

// Danh sách từ bị cấm: mỗi dòng một từ.
//   "thủ tướng"            -> tự che thành [t.h.ủ t.ư.ớ.n.g]
//   "nhà cái="             -> có dấu "=" mà không có gì phía sau: XÓA từ đó
//   "nhà cái=sòng bạc"     -> thay bằng chữ ghi sau dấu "="
function parseWords(str) {
  return String(str).split('\n').map((l) => {
    const k = l.indexOf('=');
    const from = (k < 0 ? l : l.slice(0, k)).trim().normalize('NFC');
    if (!from) return null;
    if (k < 0) return { from, to: dotify(from) };
    return { from, to: l.slice(k + 1).trim().normalize('NFC') };
  }).filter(Boolean);
}
// Khớp cả cụm nhiều từ ("tự do ngôn luận"): các từ có thể cách nhau bằng nhiều dấu cách, nbsp, tab,
// gạch nối/gạch dưới, ký tự vô hình (zero-width) — kiểu né bộ lọc thường gặp — hoặc bị ngắt dòng giữa cụm.
// Cho phép tối đa 2 dấu xuống dòng liên tiếp (ngắt dòng / ngắt đoạn), không vượt qua nhiều hơn để khỏi nối sang chương khác.
const SEP = '[^\\S\\n]|[-_\\u200B-\\u200D\\uFEFF]';
const GAP = '(?=[\\s\\-_\\u200B-\\u200D\\uFEFF])(?:' + SEP + ')*(?:\\n(?:' + SEP + ')*){0,2}';
const wordRe = (w) => {
  const body = w.normalize('NFC').split(/\s+/).filter(Boolean).map(esc).join(GAP);
  return new RegExp('(?<![\\p{L}\\p{N}])' + body + '(?![\\p{L}\\p{N}])', 'giu');
};
// Giữ kiểu hoa/thường của chữ gốc: "Nhà cái" -> "Sòng bạc", "NHÀ CÁI" -> "SÒNG BẠC"
const matchCase = (orig, rep) => {
  if (!rep) return rep;
  const letters = orig.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) return rep.toUpperCase();
  if (/^\p{Lu}/u.test(orig)) return rep.charAt(0).toUpperCase() + rep.slice(1);
  return rep;
};

// Trả về danh sách tên chương (không trùng) chứa các kết quả khớp của re
function chaptersOf(text, re) {
  const titles = [];
  let pos = 0, cur = null; const marks = [];
  for (const ln of text.split('\n')) {
    if (TITLE_RE.test(ln)) { cur = ln.trim(); }
    marks.push({ start: pos, title: cur });
    pos += ln.length + 1;
  }
  const out = [];
  for (const m of text.matchAll(re)) {
    let t = null;
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].start <= m.index) { t = marks[i].title; break; }
    t = t || '(trước chương 1)';
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// Tên chương bị in 2 lần liền nhau (chỉ cách nhau dòng trống): giữ 1 dòng, ưu tiên dòng có kèm tiêu đề.
function dedupTitles(text) {
  const HEAD = /^[\s\u200b-\u200d\ufeff*#_>\-–—•\[(【《「]*(?:(?:quyển|quyen|volume|vol\.?)\s*\d+\s*[-–—:.,]?\s*)?(?:chương|chapter|chap|hồi)\s*(?:thứ\s*)?[:.\-–—#]?\s*(\d+)/i; // nhận cả: CHƯƠNG 181, Chương: 181, Chương thứ 181, **Chương 181**, 【Chương 181】, Chapter 181
  const numOf = (x) => { const m = HEAD.exec(x); return m ? m[1] : null; };
  const out = []; let last = -1, skipBlank = false, count = 0;
  for (const ln of text.split('\n')) {
    if (skipBlank && !ln.trim()) continue;
    skipBlank = false;
    if (HEAD.test(ln)) {
      if (last >= 0 && out.slice(last + 1).every((l) => !l.trim()) && numOf(out[last]) === numOf(ln)) {
        // Chỉ thay khi dòng sau có kèm tiêu đề còn dòng trước chỉ có "Chương N"; viết lại gọn thành "Chương N<tiêu đề>"
        const rest = (x) => x.slice(HEAD.exec(x)[0].length).replace(/[\s*_\])】》」]+$/, '');
        if (!/\p{L}/u.test(rest(out[last])) && /\p{L}/u.test(rest(ln))) out[last] = 'Chương ' + numOf(ln) + rest(ln);
        count++; skipBlank = true; continue;
      }
      out.push(ln); last = out.length - 1;
    } else out.push(ln);
  }
  return { text: out.join('\n'), count };
}

function splitChapters(text) {
  const chs = []; let cur = null, p = 0;
  for (const ln of text.split('\n')) {
    if (TITLE_RE.test(ln)) { cur = { title: ln.trim(), body: [], pos: p, end: p + ln.length }; chs.push(cur); }
    else if (cur) cur.body.push(ln);
    p += ln.length + 1;
  }
  return chs.map((c) => ({ title: c.title, body: c.body.join('\n'), words: wc(c.body.join('\n')), pos: c.pos, end: c.end }));
}

const clip = (s, n = 60) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

// Trả về danh sách vấn đề. Mỗi mục: { label, count, samples, fixable, hits }.
// hits (nếu có) = các vị trí nghi ngờ trong `text`: { s, e, ch (tên chương), text (đoạn trích), want (chữ nằm ở [s,e]) } để bấm tới đúng chỗ.
function analyze(text, wordsStr, minWords = 1000) {
  text = String(text).normalize('NFC');
  const issues = [];
  const lines = text.split('\n');
  const starts = [], titleAt = [];
  { let p = 0, cur = ''; for (const l of lines) { if (TITLE_RE.test(l)) cur = l.trim(); starts.push(p); titleAt.push(cur); p += l.length + 1; } }
  const lineIdx = (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const ctx = (pos, len) => { const i = lineIdx(pos); return _snip(lines[i], pos - starts[i], len, 30); };
  const mkHit = (s, e, label) => ({ s, e, ch: titleAt[lineIdx(s)] || '', text: label, want: text.slice(s, e) });
  const add = (label, items, fixable, hits) => { if (items.length) issues.push({ label, count: items.length, samples: items.slice(0, 5).map((x) => clip(x)), fixable, hits: hits && hits.length ? hits.slice(0, 300) : null }); };
  // Tìm theo regex (cờ g): trả về các đoạn khớp + vị trí. whole = chọn cả dòng chứa chỗ khớp (mỗi dòng một lần)
  const scan = (re, whole) => {
    const items = [], hits = [], seen = new Set();
    for (const m of text.matchAll(re)) {
      // regex có thể bắt đầu ở dòng trống phía trên (\s* nuốt cả xuống dòng): lấy dòng chứa chữ đầu tiên của đoạn khớp
      const li = lineIdx(whole ? m.index + (m[0].length - m[0].trimStart().length) : m.index);
      if (whole) {
        if (seen.has(li)) continue; seen.add(li);
        items.push(lines[li].trim());
        hits.push(mkHit(starts[li], starts[li] + lines[li].length, lines[li].trim()));
      } else {
        items.push(m[0]);
        hits.push(mkHit(m.index, m.index + m[0].length, ctx(m.index, m[0].length)));
      }
    }
    return { items, hits };
  };
  const addScan = (label, re, fixable, whole) => { const r = scan(re, whole); add(label, r.items, fixable, r.hits); };
  const addLines = (label, pred, fixable) => {
    const items = [], hits = [];
    lines.forEach((l, i) => { if (pred(l, i)) { items.push(l); hits.push(mkHit(starts[i], starts[i] + l.length, l.trim())); } });
    add(label, items, fixable, hits);
  };

  addScan('Link / tên miền', RE.link, true);
  addScan('Số điện thoại', RE.phone, true);
  addLines('Dòng ghi nguồn / người dịch', (l) => cleanSourceLine(l) !== l, true);
  const donMask = donationMask(lines);
  addLines('Khối xin ủng hộ / số tài khoản (tự xóa)', (l, i) => donMask[i], true);
  addLines('Dòng quảng cáo Zalo / Facebook / ngân hàng (tự xóa cả dòng)', (l, i) => !donMask[i] && isPromoSocialLine(l), true);
  { const r = scan(RE.social), keep = r.hits.map((h, i) => ({ h, it: r.items[i] })).filter((x) => { const li = lineIdx(x.h.s); return !donMask[li] && !isPromoSocialLine(lines[li]); });
    add('Nhắc tới Zalo / Facebook / ngân hàng… (cần tự xem)', keep.map((x) => x.it), false, keep.map((x) => x.h)); }

  for (const { from, to } of parseWords(wordsStr)) {
    const r = scan(wordRe(from));
    const where = r.items.length ? chaptersOf(text, wordRe(from)) : [];
    add(`Từ trong danh sách: "${from}"${to ? ' → "' + to + '"' : ' (xóa)'}${where.length ? ' — nằm ở: ' + where.slice(0, 8).join(', ') + (where.length > 8 ? '…' : '') : ''}`, r.items, true, r.hits);
  }

  addScan('Emoji / icon', RE.emoji, true);

  { const d = dedupTitles(text); if (d.count) add('Tên chương bị lặp 2 lần liền nhau', Array(d.count).fill('Chương…'), true); }
  addLines('Tên chương viết hoa toàn bộ', (l) => TITLE_RE.test(l) && l === l.toUpperCase() && /\p{L}/u.test(l), true);
  addLines('Dòng thông báo / lời tác giả (tự xóa cả dòng)', isAuthorNoteLine, true);
  { const r = scan(RE.notice, true), keep = r.hits.map((h, i) => ({ h, it: r.items[i] })).filter((x) => !isAuthorNoteLine(x.it));
    add('Dòng thông báo / lời tác giả trong nội dung (cần tự xem)', keep.map((x) => x.it), false, keep.map((x) => x.h)); }

  const chs = splitChapters(text);
  if (chs.length) {
    if (chs.length < 20) add(`Truyện chỉ có ${chs.length} chương (cần ≥ 20 để gửi duyệt)`, ['—'], false);
    const sh = chs.filter((c) => c.words < minWords);
    add(`Chương dưới ${minWords} từ (cần tự xem)`, sh.map((c) => `${c.title} (${c.words} từ)`), false, sh.map((c) => mkHit(c.pos, c.end, `${c.title} (${c.words} từ)`)));
    if (RE.intro.test(chs[0].body.slice(0, 400))) add('Chương 1 có vẻ là "giới thiệu nhân vật" / "lời tác giả" (cần tự xem)', [clip(chs[0].body)], false, [mkHit(chs[0].pos, chs[0].end, clip(chs[0].body, 90))]);
  }
  return issues;
}

function fix(text, opt, wordsStr) {
  let t = String(text).normalize('NFC');
  if (opt.dups) t = dedupTitles(t).text;
  if (opt.source) t = stripSourceLines(t);
  if (opt.links) t = t.replace(PRE_LINK_RE, '').replace(RE.link, '').replace(RE.phone, '');
  if (opt.words) for (const { from, to } of parseWords(wordsStr)) t = t.replace(wordRe(from), (m0) => matchCase(m0, to));
  if (opt.emoji) t = t.replace(RE.emoji, '');
  if (opt.titles) {
    t = t.split('\n').map((ln) => {
      if (TITLE_RE.test(ln) && ln === ln.toUpperCase() && /\p{L}/u.test(ln)) {
        return ln.toLowerCase().replace(/(^|[\s:\-–—])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
      }
      return ln;
    }).join('\n');
  }
  return t.replace(/[ \t]+$/gm, '').replace(/(\S)[ \t]{2,}/g, '$1 ');
}

// ---- Sửa có ghi nhật ký: giống fix() nhưng ghi lại từng chỗ đã sửa/xóa (từ bị cấm, emoji,
// tên chương viết hoa, ghi nguồn, link...) để mục "Xem lại" hiển thị và bấm tới đúng chỗ được.
// Trả về { text, log, counts }. Mỗi mục log: { ch, kind, before, after, anchor, mode }.
const _collapse = (s) => s.replace(/(\S)[ \t]{2,}/g, '$1 ');
// "Mỏ neo" để tìm lại chỗ sửa trong văn bản cuối cùng: 40 ký tự quanh vị trí p của dòng
const _anchorAt = (line, p) => { const c = _collapse(line), p2 = _collapse(line.slice(0, p)).length, a = Math.max(0, p2 - 18); return c.slice(a, a + 40); };
// Đoạn trích ngắn quanh vị trí pos (dài len) để hiển thị
const _snip = (s, pos, len, w = 45) => { const a = Math.max(0, pos - w), b = Math.min(s.length, pos + len + w); return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : ''); };

function fixLogged(text, opt, wordsStr) {
  let t = String(text).normalize('NFC');
  const log = [], counts = { words: {}, links: 0, emoji: 0, titles: 0, social: 0, notice: 0 }, titleMap = {};
  if (opt.dups) t = dedupTitles(t).text;
  // 0) khối xin ủng hộ / số tài khoản (chạy trước khi xóa link/số điện thoại để không làm mất mốc nhận diện)
  if (opt.social) { const r = removeLinesLogged(t, null, 'khối xin ủng hộ / số tài khoản', donationMask); t = r.text; r.log.forEach((e) => log.push(e)); counts.social += r.log.length; }
  // 1) ghi nguồn + link/số điện thoại
  if (opt.source || opt.links) collectRemovals(t, { source: opt.source, links: opt.links }).forEach((e) => log.push(e));
  if (opt.links) counts.links = (t.match(RE.link) || []).length + (t.match(RE.phone) || []).length;
  if (opt.source || opt.links) t = fix(t, { source: opt.source, links: opt.links }, '');
  // 1b) dòng quảng cáo Zalo/Facebook/ngân hàng, dòng thông báo/lời tác giả (xóa cả dòng, có ghi nhật ký)
  if (opt.social) { const r = removeLinesLogged(t, isPromoSocialLine, 'quảng cáo Zalo / Facebook / ngân hàng'); t = r.text; r.log.forEach((e) => log.push(e)); counts.social += r.log.length; }
  if (opt.notice) { const r = removeLinesLogged(t, isAuthorNoteLine, 'thông báo / lời tác giả'); t = r.text; r.log.forEach((e) => log.push(e)); counts.notice = r.log.length; }
  // 2) từ trong danh sách
  if (opt.words && wordsStr) {
    for (const { from, to } of parseWords(wordsStr)) {
      const str = t, starts = [], titles = []; let pos = 0, cur = '';
      for (const ln of str.split('\n')) { if (TITLE_RE.test(ln)) cur = ln.trim(); starts.push(pos); titles.push(cur); pos += ln.length + 1; }
      const chAt = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return titles[lo] || ''; };
      t = str.replace(wordRe(from), (m0, off) => {
        const rep = matchCase(m0, to);
        counts.words[from] = (counts.words[from] || 0) + 1;
        const ls = str.lastIndexOf('\n', off - 1) + 1; let le = str.indexOf('\n', off + m0.length); if (le < 0) le = str.length;
        const p = off - ls, beforeLine = str.slice(ls, le), afterLine = str.slice(ls, off) + rep + str.slice(off + m0.length, le);
        log.push({ ch: chAt(off), kind: `từ trong danh sách "${from}" → ${to ? '"' + to + '"' : '(xóa)'}`,
          before: _snip(beforeLine, p, m0.length), after: _snip(afterLine, p, rep.length), anchor: _anchorAt(afterLine, p), line: afterLine, mode: 'at' });
        return rep;
      });
    }
  }
  // 3) emoji
  if (opt.emoji) {
    let cur = '';
    t = t.split('\n').map((ln) => {
      if (TITLE_RE.test(ln)) cur = ln.trim();
      const p = ln.search(RE.emoji);
      if (p < 0) return ln;
      counts.emoji += (ln.match(RE.emoji) || []).length;
      const na = ln.replace(RE.emoji, '');
      log.push({ ch: cur, kind: 'emoji', before: _snip(ln, p, 1), after: _snip(na, p, 0), anchor: _anchorAt(na, p), line: na, mode: 'at' });
      return na;
    }).join('\n');
  }
  // 4) tên chương viết hoa toàn bộ
  if (opt.titles) {
    let cur = '';
    t = t.split('\n').map((ln) => {
      if (TITLE_RE.test(ln)) {
        cur = ln.trim();
        if (ln === ln.toUpperCase() && /\p{L}/u.test(ln)) {
          const nl = ln.toLowerCase().replace(/(^|[\s:\-–—])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
          counts.titles++; titleMap[ln.trim()] = nl.trim(); cur = nl.trim();
          log.push({ ch: cur, kind: 'tên chương viết hoa toàn bộ → viết thường', before: ln.trim(), after: nl.trim(), mode: 'top' });
          return nl;
        }
      }
      return ln;
    }).join('\n');
  }
  t = t.replace(/[ \t]+$/gm, '').replace(/(\S)[ \t]{2,}/g, '$1 ');
  log.forEach((e) => { if (titleMap[e.ch]) e.ch = titleMap[e.ch]; }); // tên chương đã đổi: trỏ tới tên mới trong văn bản cuối
  return { text: t, log, counts };
}

if (typeof module !== 'undefined') module.exports = { donationMask, isPromoSocialLine, isAuthorNoteLine, fixLogged, lineChanges, collectRemovals, stripSourceLines, cleanSourceLine, analyze, fix, parseWords, splitChapters, dedupTitles };

// ---------------- Giao diện ----------------
if (typeof document !== 'undefined' && document.getElementById('runCheck')) {
  const g = (id) => document.getElementById(id);
  let beforeFix = null;

  // Danh sách từ bị cấm mặc định (mỗi từ 1 dòng, tự che bằng dấu chấm)
  const DEFAULT_WORDS = [
    'con mẹ', 'shit', 'nhà cái', 'download', 'lật đổ', 'đảo chính', 'cộng sản', 'đập đá',
    'fuck', 'thủ tướng', 'bet', 'đa nguyên', 'qq', 'vcl', 'Tự do ngôn luận', 'truyện đề cử',
    'ngụy quân', 'slot', 'vl', 'zalo'
  ];
  g('badwords').value = DEFAULT_WORDS.join('\n');
  try {
    const sv = localStorage.getItem('badwords');
    if (sv !== null) {
      g('badwords').value = sv;
      // Lần đầu sau khi cập nhật: bỏ phần sau dấu "=" ở các dòng đã lưu, loại dòng trùng, bổ sung các từ mặc định còn thiếu
      if (localStorage.getItem('badwords_seed') !== '3.37') {
        const seen = new Set(), keep = [];
        sv.split('\n').forEach((l) => {
          const w = l.split('=')[0].trim(), k = w.toLowerCase();
          if (w && !seen.has(k)) { seen.add(k); keep.push(w); }
        });
        DEFAULT_WORDS.forEach((w) => { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); keep.push(w); } });
        g('badwords').value = keep.join('\n');
        localStorage.setItem('badwords', g('badwords').value);
      }
    }
    localStorage.setItem('badwords_seed', '3.37');
  } catch (e) {}
  g('badwords').addEventListener('input', () => { try { localStorage.setItem('badwords', g('badwords').value); } catch (e) {} });

  // Ô nhập nhanh: gõ từ rồi Enter -> thêm vào cuối danh sách (bỏ qua nếu đã có), tự lưu
  const bwMsg = (t) => { g('bwMsg').textContent = t; };
  function addBadWord() {
    const inp = g('bwNew'), raw = inp.value.trim(); // có thể kèm "=" (nhà cái= → xóa; nhà cái=sòng bạc → thay)
    if (!raw) return;
    const w = parseWords(raw)[0];
    if (!w) { bwMsg('⚠️ Từ không hợp lệ.'); return; }
    const ta = g('badwords');
    if (parseWords(ta.value).some((x) => x.from.toLowerCase() === w.from.toLowerCase())) {
      bwMsg(`ℹ️ "${w.from}" đã có trong danh sách.`); inp.select(); return;
    }
    ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : '') + raw;
    try { localStorage.setItem('badwords', ta.value); } catch (e) {}
    ta.scrollTop = ta.scrollHeight;
    inp.value = ''; inp.focus();
    bwMsg(`✅ Đã thêm "${w.from}" → ${w.to ? w.to : '(xóa)'}`);
  }
  g('bwNew').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addBadWord(); }
  });
  g('bwAdd').onclick = addBadWord;

  const opts = () => ({
    links: g('o_links').checked, words: g('o_words').checked, emoji: g('o_emoji').checked, source: g('o_source').checked,
    titles: g('o_title').checked, dups: g('o_dup').checked,
    social: !g('o_social') || g('o_social').checked, notice: !g('o_notice') || g('o_notice').checked
  });

  // Tên chương rút gọn ("Chương 12") để hiện đầu mỗi vị trí
  const shortCh = (t) => { const m = /^\s*(?:(?:quyển|quyen|volume|vol\.?)\s*\d+\s*[-–—:.,]?\s*)?chương\s*\d+/i.exec(t || ''); return m ? m[0].replace(/^\s*chương/i, 'Chương') : String(t || '').slice(0, 24); };

  // Bấm một vị trí nghi ngờ -> sang đúng lô, chọn và cuộn tới chỗ đó. texts = các văn bản (từng lô) đã được kiểm tra, theo thứ tự.
  function goHit(h, texts) {
    const multi = hasBatches();
    let bi = -1, off = h.s;
    if (multi) { // đổi vị trí trong văn bản đã nối (cách nhau 1 dấu xuống dòng) thành lô + vị trí trong lô
      let o = 0; bi = texts.length - 1; off = 0;
      for (let i = 0; i < texts.length; i++) { const end = o + texts[i].length; if (h.s <= end) { bi = i; off = h.s - o; break; } o = end + 1; }
      syncCur();
      if (!batches[bi]) bi = curBatch;
    }
    const txt = multi ? batches[bi].text : g('out').value, len = h.e - h.s;
    let at = txt.slice(off, off + len) === h.want ? off : -1;
    if (at < 0) { at = txt.indexOf(h.want, Math.max(0, off - 3000)); if (at < 0) at = txt.indexOf(h.want); } // văn bản đã đổi: tìm lại
    if (at < 0) { sheetMsg('⚠️ Chỗ này đã thay đổi so với lúc kiểm tra (có thể bạn đã sửa) — hãy bấm "Kiểm tra" lại.'); return; }
    if (multi && bi !== curBatch) showBatch(bi);
    selectAndShow(g('out'), at, at + len);
    sheetMsg(`📍 ${h.ch ? shortCh(h.ch) + ' — ' : ''}chỗ nghi ngờ đang được chọn.`);
  }

  function render(issues, prefix, texts) {
    if (g('manualbox')) issues = issues.filter((x) => x.fixable); // mục "cần tự xem" nằm ở hộp riêng phía trên mục Xem lại
    const box = g('report');
    box.textContent = '';
    if (prefix) { const p = document.createElement('div'); p.className = 'ok'; p.textContent = prefix; box.appendChild(p); }
    if (!issues.length) {
      const d = document.createElement('div'); d.className = 'ok'; d.textContent = g('manualbox') ? '✅ Không còn mục nào cần sửa tự động.' : '✅ Không phát hiện vấn đề nào.'; box.appendChild(d); return;
    }
    fillIssues(box, issues, texts);
  }

  // Dựng danh sách các mục vấn đề (mỗi mục bấm vào từng chỗ để tới đúng vị trí trong bản thảo)
  function fillIssues(box, issues, texts) {
    for (const it of issues) {
      const title = `${it.fixable ? '🔧' : '👀'} ${it.label} — ${it.count}`;
      if (it.hits && it.hits.length) {
        const d = document.createElement('details');
        d.className = 'issue ' + (it.fixable ? 'fixable' : 'manual');
        d.open = it.hits.length <= 5;
        const sm = document.createElement('summary'); const b = document.createElement('b'); b.textContent = title; sm.appendChild(b);
        d.appendChild(sm);
        const list = document.createElement('div'); list.className = 'loc-list';
        it.hits.slice(0, 80).forEach((h) => {
          const r = document.createElement('div'); r.className = 'loc'; r.tabIndex = 0; r.setAttribute('role', 'button');
          r.title = 'Bấm để tới chỗ này trong bản thảo';
          const c = document.createElement('span'); c.className = 'loc-ch'; c.textContent = h.ch ? shortCh(h.ch) : '';
          const t = document.createElement('span'); t.className = 'loc-t'; t.textContent = h.text;
          r.append(c, t);
          const go = () => goHit(h, texts || []);
          r.onclick = go;
          r.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
          list.appendChild(r);
        });
        if (it.count > 80) { const m = document.createElement('div'); m.className = 'loc-more'; m.textContent = `… và ${it.count - 80} chỗ nữa (xử lý các chỗ trên rồi bấm Kiểm tra lại để xem tiếp).`; list.appendChild(m); }
        d.appendChild(list);
        box.appendChild(d);
        continue;
      }
      const d = document.createElement('div');
      d.className = 'issue ' + (it.fixable ? 'fixable' : 'manual');
      const h = document.createElement('b');
      h.textContent = title;
      d.appendChild(h);
      const s = document.createElement('small');
      s.textContent = ' VD: ' + it.samples.join(' | ');
      d.appendChild(s);
      box.appendChild(d);
    }
  }

  const refreshButtons = () => {
    const has = g('out').value.trim().length > 0;
    g('copy').disabled = !has; g('save').disabled = !has;
  };

  // Kiểm tra / Tự sửa / Hoàn tác áp dụng cho TOÀN BỘ các lô (cả truyện), không chỉ lô đang hiện trong khung.
  // Nếu chưa có lô nào (ví dụ bạn tự dán văn bản vào khung) thì làm việc trên nội dung của khung như trước.
  const hasBatches = () => typeof batches !== 'undefined' && batches.length > 0;
  const syncCur = () => { if (hasBatches() && typeof saveCurrentBatch === 'function') saveCurrentBatch(); };
  const allTexts = () => (hasBatches() ? batches.map((b) => b.text) : [g('out').value]);
  const scopeNote = () => (hasBatches() && batches.length > 1 ? ` (toàn bộ ${batches.length} lô)` : '');
  const minW = () => parseInt(g('minwords').value) || 1000;


  // Hộp riêng "Cần tự xem" (nằm trên mục "Xem lại"): các mục không tự sửa được, bấm vào từng chỗ để tới đó
  function renderManual(texts) {
    const box = g('manualbox'); if (!box) return;
    texts = texts || allTexts();
    const text = texts.join('\n');
    const issues = text.trim() ? analyze(text, g('badwords').value, minW()).filter((x) => !x.fixable) : [];
    box.hidden = !issues.length;
    if (!issues.length) return;
    const total = issues.reduce((a, x) => a + x.count, 0);
    g('manualsum').textContent = `👀 Cần tự xem ${total} chỗ (${issues.length} mục) — bấm vào từng chỗ để tới đó`;
    const list = g('manuallist'); list.textContent = '';
    fillIssues(list, issues, texts);
  }
  window.renderManual = renderManual;
  if (g('manualrefresh')) g('manualrefresh').onclick = () => { syncCur(); renderManual(); };

  g('runCheck').onclick = () => {
    syncCur();
    const texts = allTexts(), text = texts.join('\n');
    if (!text.trim()) { render([], ''); g('report').textContent = '⚠️ Chưa có nội dung. Hãy bấm "Lấy nội dung" hoặc dán văn bản vào khung bên trên.'; return; }
    render(analyze(text, g('badwords').value, minW()), hasBatches() && batches.length > 1 ? `🔎 Đã kiểm tra${scopeNote()}:` : '', texts);
    renderManual(texts);
  };

  g('runFix').onclick = () => {
    syncCur();
    const texts = allTexts();
    if (!texts.some((t) => t.trim())) { g('report').textContent = '⚠️ Chưa có nội dung để sửa.'; return; }
    beforeFix = { texts: texts.slice(), ref: hasBatches() ? batches : null };
    const words = g('badwords').value, o = opts();
    const logs = [], fixedTexts = texts.map((t, i) => {
      const r = fixLogged(t, o, words);
      r.log.forEach((e) => { e.bi0 = i; logs.push(e); });
      return r.text;
    });
    if (hasBatches()) { fixedTexts.forEach((t, i) => { batches[i].text = t; }); showBatch(curBatch); }
    else g('out').value = fixedTexts[0];
    if (typeof renderRemoved === 'function') { removedLog = logs; renderRemoved(logs); }
    g('undoFix').disabled = false;
    refreshButtons();
    const before = texts.reduce((a, t) => a + t.length, 0), after = fixedTexts.reduce((a, t) => a + t.length, 0);
    render(analyze(fixedTexts.join('\n'), words, minW()),
      `✅ Đã tự sửa${scopeNote()} (${before - after >= 0 ? 'giảm' : 'tăng'} ${Math.abs(before - after)} ký tự). Còn lại:`, fixedTexts);
    renderManual(fixedTexts);
  };

  g('undoFix').onclick = () => {
    if (beforeFix === null) return;
    if (beforeFix.ref) {
      if (typeof batches === 'undefined' || batches !== beforeFix.ref) {
        beforeFix = null; g('undoFix').disabled = true;
        g('report').textContent = '⚠️ Bản thảo đã được lấy lại/dựng lại sau lần sửa đó nên không hoàn tác được nữa.';
        return;
      }
      beforeFix.texts.forEach((t, i) => { if (batches[i]) batches[i].text = t; });
      showBatch(curBatch);
    } else g('out').value = beforeFix.texts[0];
    const multi = beforeFix.texts.length > 1;
    beforeFix = null; g('undoFix').disabled = true; refreshButtons();
    if (typeof renderRemoved === 'function') { removedLog = []; renderRemoved([]); }
    g('report').textContent = multi ? `↩️ Đã hoàn tác toàn bộ ${batches.length} lô về bản trước khi sửa.` : '↩️ Đã hoàn tác về bản trước khi sửa.';
    renderManual();
  };
}
