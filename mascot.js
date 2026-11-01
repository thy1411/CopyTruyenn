// Nhân vật chibi cá mập đi dạo ở mép dưới màn hình, hay làm nũng: thả tim, lắc lư đòi ôm, ngại ngùng, dỗi, hôn gió, thổi bong bóng.
// Bấm vào nhân vật (hoặc thỉnh thoảng tự nó) sẽ làm nũng một kiểu ngẫu nhiên. Chỉ có một ảnh tĩnh nên "cử động" là nghiêng/nhún/lắc
// + hiệu ứng tim, bong bóng, lấp lánh vẽ bằng CSS/SVG.
// Rất nhẹ: chỉ đổi transform; tự dừng khi tab ẩn; chỉ phần ảnh có màu mới bắt chuột (chỗ trong suốt vẫn bấm xuyên qua);
// Giữ chuột (hoặc kéo) vào nhân vật để BẾ LÊN: nhân vật đung đưa, nũng nịu xin xuống; thả chuột thì rơi xuống (bấm nhanh vẫn là làm nũng).
// nếu hệ điều hành bật "giảm chuyển động" thì nhân vật đứng yên ở góc dưới bên phải, không làm nũng.
(function () {
  const SIZE = 116;                        // chiều cao nhân vật (px): chỉnh tại đây (chỉnh cả #mascot trong app.html)
  const MOVE_GAP = 8000;                   // tối thiểu bao lâu (ms) giữa hai lần TỰ làm nũng
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wait = (ms) => new Promise((r, j) => setTimeout(() => (moveGen !== gen ? j(new Error('cancel')) : r()), ms)); // bị huỷ nếu nhân vật vừa bị cầm lên
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.id = 'mascot';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<div class="mc-flip"><img class="mc-img" src="chibi.png" alt="" draggable="false"></div><span class="mc-shadow"></span><div class="mc-say"></div>';
  document.body.appendChild(root);
  const vfx = document.createElement('div');       // lớp hiệu ứng theo toạ độ màn hình (tim, bong bóng, lấp lánh)
  vfx.id = 'mc-vfx'; vfx.setAttribute('aria-hidden', 'true');
  document.body.appendChild(vfx);
  const vfxB = document.createElement('div');      // lớp hiệu ứng nằm sau nhân vật (z-index 4 < #mascot 5): dùng cho fx có cfg.behind
  vfxB.id = 'mc-vfxb'; vfxB.setAttribute('aria-hidden', 'true');
  vfxB.style.cssText = 'position:fixed;inset:0;z-index:4;overflow:hidden;pointer-events:none';
  document.body.appendChild(vfxB);
  const flip = root.querySelector('.mc-flip'), img = root.querySelector('.mc-img'), bubble = root.querySelector('.mc-say');

  let w = Math.round(SIZE * 1.03);                 // bề rộng (cập nhật khi ảnh tải xong)
  const maxX = () => Math.max(8, window.innerWidth - w - 8);
  const clampX = (v) => Math.min(maxX(), Math.max(8, v));
  let x = rnd(8, maxX()), target = x, speed = 50, idleWait = 0, state = 'idle', face = -1;  // ảnh gốc nhìn chính diện, lật theo hướng đi
  let busy = false, tween = null, lastMove = 0, lastName = '';
  let thrown = false, tossT = 0;   // thrown: lần thả này là ném mạnh (lộn nhào, đập đất nằm sấp); tossT: thời gian đã bay
  let hv = 0;   // vận tốc ngang đã làm mượt (px/giây) lúc đang bế, quyết định khung kéo nhanh/chậm
  let lift = 0, held = false, falling = false, gen = 0, moveGen = 0;   // lift = độ cao so với mặt đất (px)

  // ---- khung hình thay cho ảnh đứng yên (nhân vật có hướng sẵn nên không cần lật ảnh)
  // run/: l1-l5 thực tế chạy sang PHẢI, r1-r5 chạy sang TRÁI (tên file ngược, đã bù ở runStep) (khung 1 dáng đứng, khung 5 nước bắn)
  // act/: 1-4 bị cầm lên (giật mình, rồi vùng vẫy/nũng nịu), 5-7 đang rơi, 8 chạm đất (nằm sấp, thả tim)
  const RUN_W = 347, RUN_H = 218;                     // kích thước mỗi khung chạy (px gốc), hiển thị cao đúng SIZE
  const RUN_SEQ = [1, 2, 3, 4, 3, 2];                 // thứ tự khung khi chạy (chỉ số 0-4), lặp vòng
  const RUN_FPS = 0.11;                               // giây cho mỗi khung chạy
  const ACT_W = 254, ACT_H = 285, ACT_S = 0.6;        // khung act/: kích thước gốc và tỉ lệ hiển thị (px màn hình trên px ảnh)
  const loadSet = (names) => names.map((n) => { const im = new Image(); im.src = n; return im; });
  const RUN = { l: loadSet([1, 2, 3, 4, 5].map((i) => 'run/l' + i + '.png')), r: loadSet([1, 2, 3, 4, 5].map((i) => 'run/r' + i + '.png')) };
  const DRAG_W = 414, DRAG_H = 285, DRAG_S = 0.6273;  // khung drag/: bị kéo ngang trên không (r1-r4 sang phải, l1-l4 sang trái; số càng lớn càng nhanh)
  const DRAG = { r: loadSet([1, 2, 3, 4].map((i) => 'drag/r' + i + '.png')), l: loadSet([1, 2, 3, 4].map((i) => 'drag/l' + i + '.png')) };
  const TOSS_W = 225, TOSS_H = 218, TOSS_S = 0.6085; // khung toss/: bị quăng đi (1-7 lộn nhào trên không, 8 nằm sấp sau khi đập đất)
  const TOSS = loadSet([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'toss/' + i + '.png'));
  // touch/: mỗi lần bị chạm (bấm nhanh) phát trọn một chuỗi 8 khung: tN_1..tN_8 = chuỗi của lần chạm thứ N
  // (ngơ ngác/giật mình -> la, ôm tay -> giận -> ôm đầu -> nằm dỗi). Thêm chuỗi mới: bỏ 8 ảnh tN_1..8.png vào touch/ rồi tăng TOUCH_SETS
  const TOUCH_S = 0.45, TOUCH_SETS = 3;
  const TOUCH = Array.from({ length: TOUCH_SETS }, (_, k) => loadSet([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'touch/t' + (k + 1) + '_' + i + '.png')));
  // skill/: chiêu đặc biệt (s1_1..8 = chiêu 1: thổi cá mập nước ra rồi ôm vào lòng). Thêm chiêu mới: bỏ 8 ảnh sN_1..8.png vào skill/ rồi khai báo tương tự SKILL1 + emSkillN
  const SKILL_S = 0.55;
  const SKILL1 = loadSet([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'skill/s1_' + i + '.png'));
  const SKILL2 = loadSet([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'skill/s2_' + i + '.png'));   // chiêu 2: cá mập nước khổng lồ trồi lên nuốt chửng
  const SKILL3 = loadSet([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'skill/s3_' + i + '.png'));   // chiêu 3: nén quả cầu nước, triệu hồi cá mập, cưỡi sóng lao đi
  const ACT = loadSet([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'act/' + i + '.png'));
  const idleIm = new Image(); idleIm.src = img.getAttribute('src');   // ảnh đứng yên gốc (chibi.png)
  let framed = false, curFrame = null, runT = 0, runIdx = 0;
  const runW = () => Math.round(SIZE * RUN_W / RUN_H);
  function showFrame(im, dw, dh) {                    // đổi sang một khung; đáy khung luôn sát đáy nhân vật, tâm ngang giữ nguyên
    if (!im || !im.complete || !im.naturalWidth || curFrame === im) return;
    if (!framed) { framed = true; flip.style.transform = ''; }
    curFrame = im; img.src = im.src;
    const m = ((w - dw) / 2).toFixed(1) + 'px';
    img.style.height = dh + 'px'; img.style.marginLeft = m; img.style.marginRight = m; img.style.marginTop = (SIZE - dh) + 'px';
    root.style.setProperty('--up', Math.max(0, dh - SIZE).toFixed(0) + 'px');   // đẩy bong bóng thoại lên khỏi đầu khi khung cao hơn mặc định
  }
  const showAct = (i) => showFrame(ACT[i], Math.round(ACT_W * ACT_S), Math.round(ACT_H * ACT_S));
  const showTouch = (set, i) => { const im = TOUCH[set][i]; if (im && im.naturalWidth) showFrame(im, Math.round(im.naturalWidth * TOUCH_S), Math.round(im.naturalHeight * TOUCH_S)); };
  const showSkill = (set, i) => { const im = set[i]; if (im && im.naturalWidth) showFrame(im, Math.round(im.naturalWidth * SKILL_S), Math.round(im.naturalHeight * SKILL_S)); };
  const showToss = (i) => showFrame(TOSS[i], Math.round(TOSS_W * TOSS_S), Math.round(TOSS_H * TOSS_S));
  const showDrag = (dir, lvl) => showFrame(DRAG[dir][lvl], Math.round(DRAG_W * DRAG_S), Math.round(DRAG_H * DRAG_S));
  function showIdle() {                               // quay về ảnh đứng yên (lật theo hướng nhìn như cũ)
    if (!framed) return;
    framed = false; curFrame = null; runT = 0; runIdx = 0;
    img.src = idleIm.src; img.style.height = ''; img.style.marginLeft = ''; img.style.marginRight = ''; img.style.marginTop = '';
    root.style.setProperty('--up', '0px');
    flip.style.transform = face > 0 ? 'scaleX(-1)' : '';
  }
  function runStep(dt, dir) {                         // gọi mỗi nhịp khi đang đi: đổi khung chạy theo hướng
    runT += dt;
    if (runT >= RUN_FPS) { runT = 0; runIdx = (runIdx + 1) % RUN_SEQ.length; }
    showFrame(RUN[dir < 0 ? 'r' : 'l'][RUN_SEQ[runIdx]], runW(), SIZE);   // lưu ý: ảnh run/r* là dáng chạy sang TRÁI, run/l* là sang PHẢI (tên file ngược)
  }
  const KEEP_FRAME = { walk: 1, held: 1, fall: 1, land: 1, touch: 1, skill: 1 };
  const setState = (s, force) => { if ((held || falling) && !force) return; if (!KEEP_FRAME[s]) showIdle(); state = s; root.className = 'mc-' + s; };
  const setFace = (d) => { if (d && d !== face) { face = d; if (!framed) flip.style.transform = d > 0 ? 'scaleX(-1)' : ''; } };
  const place = () => { root.style.transform = `translate3d(${x.toFixed(1)}px,${(-lift).toFixed(1)}px,0)`; if (bubbleHalf && bubble.classList.contains('show')) fitBubble(); };
  const tweenTo = (to, ms, fn) => new Promise((res, rej) => { if (moveGen !== gen) { rej(new Error('cancel')); return; } tween = { from: x, to, t0: performance.now(), ms, fn: fn || easeOut, res }; });

  // ---- hiệu ứng
  let bubbleHalf = 0, lastShift = '';
  function fitBubble() {                             // nhân vật sát mép màn hình: dời bong bóng thoại vào trong cho khỏi bị cắt chữ (cập nhật cả lúc đang bị bế đi)
    const cx = x + w / 2, W = window.innerWidth;
    const shift = cx - bubbleHalf < 8 ? 8 - (cx - bubbleHalf) : (cx + bubbleHalf > W - 8 ? W - 8 - (cx + bubbleHalf) : 0);
    const v = shift.toFixed(0) + 'px';
    if (v !== lastShift) { lastShift = v; bubble.style.setProperty('--shift', v); }
  }
  function say(text, ms) {
    bubble.textContent = text; bubble.style.setProperty('--shift', '0px'); bubble.classList.remove('show'); void bubble.offsetWidth;
    bubbleHalf = bubble.offsetWidth / 2; fitBubble(); bubble.classList.add('show');
    setTimeout(() => bubble.classList.remove('show'), ms || 1600);
  }
  const spawn = (el, ms) => { el.style.setProperty('--dur', ms + 'ms'); vfx.appendChild(el); setTimeout(() => el.remove(), ms + 80); };
  const HEART = '<svg viewBox="0 0 24 22" xmlns="http://www.w3.org/2000/svg"><path d="M12 21 C-3 10 3 0 9 1.6 C11 2.2 12 4 12 4 C12 4 13 2.2 15 1.6 C21 0 27 10 12 21 Z"/></svg>';
  const STAR = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z"/></svg>';
  const PINKS = ['#ff7eb6', '#ff9ccd', '#ff5fa2', '#ffb3d9', '#ff8fb8'];
  const fxBase = () => ({ fx: x + w / 2, fy: lift + SIZE * 0.55 });   // gốc hiệu ứng: quanh người nhân vật (toạ độ màn hình)
  function hearts(n, spread, drift) {                // tim bay lên (drift = lệch ngang theo hướng mặt, dùng cho hôn gió)
    const { fx, fy } = fxBase();
    for (let i = 0; i < n; i++) setTimeout(() => {
      const el = document.createElement('div'); el.className = 'mc-fx mc-heart'; el.innerHTML = HEART;
      el.style.left = (fx + rnd(-spread, spread) - 9) + 'px'; el.style.bottom = (fy + rnd(-6, 14)) + 'px';
      el.style.setProperty('--dx', ((drift ? face * rnd(50, 120) : rnd(-26, 26))).toFixed(0) + 'px');
      el.style.setProperty('--dy', (-rnd(70, 120)).toFixed(0) + 'px');
      el.style.setProperty('--s', rnd(0.7, 1.35).toFixed(2));
      el.style.setProperty('--r', rnd(-24, 24).toFixed(0) + 'deg');
      el.style.color = PINKS[Math.floor(Math.random() * PINKS.length)];
      spawn(el, rnd(1100, 1700));
    }, i * 120);
  }
  function bubbles(n) {                              // bong bóng nước (mẹ cá mập thổi ra)
    const { fx, fy } = fxBase();
    for (let i = 0; i < n; i++) setTimeout(() => {
      const el = document.createElement('div'); el.className = 'mc-fx mc-bub';
      const d = rnd(9, 20);
      el.style.width = el.style.height = d + 'px';
      el.style.left = (fx + face * rnd(10, 30) + rnd(-12, 12) - d / 2) + 'px'; el.style.bottom = (fy + rnd(10, 30)) + 'px';
      el.style.setProperty('--dx', rnd(-22, 22).toFixed(0) + 'px');
      el.style.setProperty('--dy', (-rnd(90, 150)).toFixed(0) + 'px');
      spawn(el, rnd(1500, 2300));
    }, i * 170);
  }
  function sparkles(n) {                             // lấp lánh quanh người
    const { fx, fy } = fxBase();
    for (let i = 0; i < n; i++) setTimeout(() => {
      const el = document.createElement('div'); el.className = 'mc-fx mc-star'; el.innerHTML = STAR;
      el.style.left = (fx + rnd(-46, 46) - 7) + 'px'; el.style.bottom = (fy + rnd(-30, 40)) + 'px';
      el.style.setProperty('--s', rnd(0.6, 1.3).toFixed(2));
      el.style.color = Math.random() < 0.5 ? '#fff6a8' : '#bfe7ff';
      spawn(el, rnd(700, 1100));
    }, i * 90);
  }

  // ---- các kiểu làm nũng
  const SAY = {
    heart:  ['Hihi~ thích bạn nhất luôn á ♡', 'Em thương bạn nhiều lắm đó~ ♡', 'Bạn đọc truyện hay ghê nha~ ♡', 'Ôm cái nè~ ♡'],
    sway:   ['Ưm~ ôm em cái đi mà~', 'Đọc truyện cùng em nha~', 'Nè nè, chơi với em xíu đi mà~', 'Em buồn ngủ rồi nè~ ngáp~'],
    shy:    ['Á, ngại quá đi~', 'Đừng nhìn em chằm chằm vậy mà~', 'Làm người ta đỏ mặt rồi nè~', 'Hứ, bạn hư quá đi~'],
    pout:   ['Hứ! Không thèm chơi với bạn nữa~', 'Mou~ bạn bỏ em một mình hoài à~', 'Em dỗi rồi đó nha~', 'Phải dỗ em mới hết giận á~'],
    kiss:   ['Muah~ chúc bạn đọc truyện vui nha~', 'Hôn gió một cái nè~ ♡', 'Cố lên nha, em cổ vũ bạn~'],
    bubble: ['Em thổi bong bóng nè~', 'Bong bóng bay bay~', 'Nhớ nghỉ mắt uống nước nha~'],
    skill3: ['Nén nén quả cầu nước~ rồi cưỡi sóng nè~', 'Cá mập ơi, chở em đi lướt sóng nha~', 'Bám chắc nha~ em lướt sóng đây~ ào~', 'Quả cầu nước thành cá mập luôn nè~', 'Lướt sóng thôi~ bạn đợi em nha ♡'],
    skill2: ['Ngoam~ cá mập to nuốt bạn luôn nha~', 'Cá mập to ơi~ há miệng ra nào~', 'Ào ào~ ngoam ngoam! hihi~', 'Cá mập khổng lồ tới rồi nè~ trốn mau!', 'Nuốt chửng nè~ ngoam! đùa thôi hihi~'],
    skill1: ['Phù~ cá mập nước ra đây nào~', 'Thổi cá mập nè~ rồi ôm vào lòng ♡', 'Bé cá mập ơi~ lại đây em ôm cái~', 'Phun nước nè~ whooosh! ôm chặt luôn~', 'Cá mập nhỏ của em đó~ dễ thương hông?'],
  };
  let lastSay = '';
  const pick = (arr) => { let t; do { t = arr[Math.floor(Math.random() * arr.length)]; } while (t === lastSay && arr.length > 1); lastSay = t; return t; };

  async function emHeart()  { setState('heart'); say(pick(SAY.heart), 1700); hearts(6, 18); await wait(1100); }   // nhún nhảy vui vẻ + tim bay lên
  async function emSway()   { setState('sway'); say(pick(SAY.sway), 2000); await wait(1900); }                     // lắc qua lắc lại đòi ôm
  async function emShy()    { setState('shy'); say(pick(SAY.shy), 1700); sparkles(5); hearts(2, 12); await wait(1500); } // co người, nghiêng đầu ngại ngùng
  async function emPout()   { setState('pout'); say(pick(SAY.pout), 1900); await wait(1700); }                      // giậm chân dỗi
  async function emKiss()   { setState('kiss'); say(pick(SAY.kiss), 1800); await wait(380); hearts(5, 6, true); await wait(1000); } // hôn gió
  async function emBubble() { setState('bubble'); say(pick(SAY.bubble), 1800); bubbles(7); sparkles(3); await wait(1500); }
  async function playSkill(set, T, lines) {                                                                         // phát chuỗi 8 khung của một chiêu
    const m = Math.ceil((set[0].naturalWidth ? set[0].naturalWidth * SKILL_S - w : 180) / 2);                    // khung rộng hơn nhân vật: dời vào trong nếu sát mép màn hình
    const nx = Math.max(Math.min(maxX(), m), Math.min(x, window.innerWidth - w - m));
    if (Math.abs(nx - x) > 4) await tweenTo(nx, 350);
    setState('skill'); say(pick(lines), T.reduce((a, b) => a + b, 0) + 300);
    for (let i = 0; i < 8; i++) { showSkill(set, i); await wait(T[i]); }
  }
  const emSkill1 = () => playSkill(SKILL1, [320, 170, 170, 170, 190, 190, 230, 1100], SAY.skill1);   // thổi cá mập nước ra rồi ôm vào lòng
  const emSkill2 = () => playSkill(SKILL2, [300, 220, 200, 260, 230, 190, 220, 1100], SAY.skill2);   // cá mập khổng lồ trồi lên nuốt chửng
  const emSkill3 = () => playSkill(SKILL3, [300, 200, 200, 240, 220, 220, 200, 1100], SAY.skill3);                 // quả cầu nước, triệu hồi cá mập, cưỡi sóng
  const SKILL_ORDER = ['skill1', 'skill2', 'skill3'];
  const SKILL_CHANCE = 0.7;                 // chỉnh tại đây: tỉ lệ mỗi lần tự làm nũng là ra chiêu thức (0-1)
  let skillIdx = 0;
  const MOVES = { skill1: emSkill1, skill2: emSkill2, skill3: emSkill3, sway: emSway, shy: emShy, pout: emPout, kiss: emKiss };   // đã bỏ 'heart' (bắn tim) và 'bubble' (thả bong bóng) khỏi danh sách làm nũng; hàm emHeart/emBubble vẫn còn nhưng không được gọi

  let moveId = 0;
  async function startMove(name) {
    if (busy || held || falling || reduce || document.hidden) return;
    if (!name) {                              // tự làm nũng: SKILL_CHANCE xác suất ra chiêu thức (xoay vòng 1 -> 2 -> 3 để thấy đủ cả ba), còn lại là điệu bộ thường
      if (Math.random() < SKILL_CHANCE) { name = SKILL_ORDER[skillIdx % SKILL_ORDER.length]; skillIdx++; }
      else { const keys = Object.keys(MOVES).filter((k) => k !== lastName && !/^skill/.test(k)); name = keys[Math.floor(Math.random() * keys.length)]; }
    }
    busy = true; lastName = name; lastMove = performance.now(); tween = null; moveGen = gen;
    const myId = ++moveId;
    try { await MOVES[name](); } catch (e) {}
    if (myId !== moveId) return;               // đã có kiểu làm nũng/chiêu mới thay thế (chạm xen kẽ): để cái mới tự kết thúc
    tween = null;
    if (touching) return;                     // vừa bị chạm giữa chừng: poke() đang giữ khung hình, để nó tự kết thúc
    busy = false; setState('idle'); idleWait = rnd(1.2, 2.5);
  }
  // ---- bị chạm (bấm nhanh): lần chạm thứ N phát chuỗi khung tN (8 khung) rồi giữ khung cuối một lúc; quá POKE_RESET ms không chạm thì đếm lại từ lần 1.
  // Chạm quá số chuỗi hiện có thì phát lại chuỗi cuối. Chạm giữa chừng thì sang chuỗi kế tiếp ngay.
  const POKE_RESET = 12000, POKE_FRAME = 130, POKE_END = 1000;
  const POKE_SAY = [
    ['Hửm? Ai chọc em đó~', 'Ơ? Gì vậy nè~', 'Á! Giật cả mình~ ai đó?', 'Hihi, nhột nha~'],
    ['Đã bảo đừng chọc nữa mà~', 'Hứ! Giận thiệt rồi đó nha~', 'Mou~ chọc hoài à~ em nổi nóng bây giờ~', 'Bạn hư quá đi~ không cho chọc nữa~'],
    ['Á á á~ đủ rồi đó!!', 'Em chóng mặt quá~ em nằm dỗi luôn~', 'Hu hu~ bạn hư quá, em xỉu đây~', 'Không chơi nữa~ phải dỗ em mới dậy~'],
  ];
  let pokes = 0, lastPoke = 0, pokeTimer = 0, touching = false;
  function poke() {
    if (held || falling || reduce || document.hidden) return;
    const now = performance.now();
    pokes = now - lastPoke > POKE_RESET ? 1 : pokes + 1;
    lastPoke = now;
    const set = Math.min(pokes, TOUCH_SETS) - 1;
    gen++;                                                          // huỷ kiểu làm nũng đang dở (nếu có)
    if (tween) { const res = tween.res; tween = null; res(); }
    busy = true; touching = true;
    clearTimeout(pokeTimer);
    setState('touch', true);
    say(pick(POKE_SAY[Math.min(set, POKE_SAY.length - 1)]), POKE_FRAME * 8 + POKE_END);
    const step = (i) => {
      if (!touching) return;
      showTouch(set, i);
      pokeTimer = setTimeout(i < 7 ? () => step(i + 1) : () => { touching = false; busy = false; if (!held && !falling) startIdle(); }, i < 7 ? POKE_FRAME : POKE_END);
    };
    step(0);
  }
  // Chạm xen kẽ: lần chạm 1 = bị chọc (poke), lần 2 = ra chiêu thức, lần 3 = bị chọc (mạnh hơn), lần 4 = chiêu kế tiếp... (chiêu xoay vòng 1 -> 2 -> 3).
  // Quá POKE_RESET ms không chạm thì đếm lại từ đầu. Chạm giữa lúc đang diễn thì huỷ ngay để phát cái kế tiếp.
  let taps = 0, lastTap = 0;
  function tap() {
    if (held || falling || reduce || document.hidden) return;
    const now = performance.now();
    if (now - lastTap > POKE_RESET) { taps = 0; lastPoke = 0; }
    lastTap = now; taps++;
    if (taps % 2 === 1) { if (lastPoke) lastPoke = now; poke(); return; }
    const name = SKILL_ORDER[skillIdx % SKILL_ORDER.length]; skillIdx++;
    gen++; clearTimeout(pokeTimer); touching = false; busy = false;   // huỷ phản ứng đang dở rồi ra chiêu ngay
    if (tween) { const res = tween.res; tween = null; res(); }
    startMove(name);
  }
  root.__tap = tap;
  root.__poke = poke;   // thử nghiệm: document.getElementById('mascot').__poke()
  root.__move = startMove; // dùng khi thử nghiệm: document.getElementById('mascot').__move('heart' | 'sway' | 'shy' | 'pout' | 'kiss' | 'bubble' | 'skill1' | 'skill2' | 'skill3')

  // ---- chỉ phần ảnh có màu mới bắt chuột: dùng canvas đọc độ trong suốt của ảnh (mỗi ảnh/khung có một canvas, tạo khi cần)
  const hitMap = new Map();
  function getHit(im) {
    if (!im || !im.naturalWidth) return null;
    let h = hitMap.get(im);
    if (h === undefined) {
      try {
        const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0); cx.getImageData(0, 0, 1, 1); h = { cv, cx };
      } catch (e) { h = null; }
      hitMap.set(im, h);
    }
    return h;
  }
  function overSprite(px, py) {
    const r = (framed ? img : root).getBoundingClientRect();
    if (px < r.left || px > r.right || py < r.top || py > r.bottom) return false;
    let u = (px - r.left) / r.width; const v = (py - r.top) / r.height;
    if (!framed && face > 0) u = 1 - u;
    const hc = getHit(framed ? curFrame : idleIm);
    if (!hc) return u > 0.2 && u < 0.8 && v > 0.08;
    const d = hc.cx.getImageData(Math.min(hc.cv.width - 1, Math.floor(u * hc.cv.width)), Math.min(hc.cv.height - 1, Math.floor(v * hc.cv.height)), 1, 1).data;
    return d[3] > 40;
  }

  function afterImage() {
    if (idleIm.naturalWidth) w = Math.round(SIZE * idleIm.naturalWidth / idleIm.naturalHeight);
    getHit(idleIm);
    if (reduce) { x = Math.max(0, window.innerWidth - w - 16); place(); }
  }
  if (idleIm.complete) afterImage(); else idleIm.addEventListener('load', afterImage);

  window.addEventListener('resize', () => {
    x = Math.min(x, maxX()); target = Math.min(target, maxX());
    if (reduce) x = Math.max(0, window.innerWidth - w - 16);
    place();
  });
  if (reduce) { root.className = 'mc-idle'; place(); return; }

  // ---- chuột: bấm nhanh = làm nũng; giữ chuột (hoặc kéo) = bế nhân vật lên
  const HOLD_SAY = ['Á! Bế em lên rồi nè~', 'Ơ ơ, đừng làm rơi em nha~', 'Hihi nhột quá đi~', 'Bế em đi đâu vậy nè~', 'Cao quá đi~ em sợ~',
    'Ôm chặt chặt em nha~', 'Em nhẹ lắm đúng hông~', 'Chân em đung đưa nè~ hihi', 'Bạn ơi cho em xuống đi mà~'];
  const ANGRY_SAY = ['Mou~ thả em xuống đi mà~', 'Em chóng mặt rồi nè~ huhu', 'Bế lâu quá à~ em dỗi đó nha~', 'Xuống xuống xuống~ em muốn xuống~', 'Hu hu, em hết giận rồi, thả em đi~'];
  const LAND_SAY = ['Phịch! Em té rồi nè~ bạn dỗ em đi~', 'Ui da~ đau quá, thổi thổi cho em đi~', 'Hứ, lần sau nhẹ tay thôi nha~', 'Chóng mặt quá đi à...', 'Hihi, bay vui ghê~ chơi nữa đi ♡'];
  const TOSS_SAY = ['Aaa~ em bị quăng rồi~ hu hu', 'Đau quá đi~ sao bạn nỡ ném em~', 'Hic... em chóng mặt quá...', 'Ui da~ em té sấp mặt rồi nè~', 'Bạn hư quá~ em dỗi bạn luôn á~'];
  const ptr = { x: 0, y: 0 }, samples = [];
  let down = null, ox = 0, hy = 0, ang = 0, angVel = 0, lv = 0, vxF = 0, bounces = 0, sayT = 0, heldT = 0, prevVx = 0, suppressClick = false;
  const sample = (e) => {
    const t = performance.now(); ptr.x = e.clientX; ptr.y = e.clientY; samples.push({ x: e.clientX, y: e.clientY, t });
    while (samples.length && t - samples[0].t > 120) samples.shift();
  };
  const ptrVel = () => {                      // vận tốc chuột trong ~0,1 giây gần nhất (để ném)
    if (samples.length < 2) return { x: 0, y: 0 };
    const a = samples[0], b = samples[samples.length - 1], dt = (b.t - a.t) / 1000;
    return dt > 0.005 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
  };
  const tilt = () => { const deg = ang * 57.2958; img.style.transform = `rotate(${((face > 0 && !framed) ? -deg : deg).toFixed(1)}deg)`; };

  function beginHold() {
    if (held || !down) return;
    const r = root.getBoundingClientRect();
    held = true; falling = false; gen++;
    clearTimeout(pokeTimer); if (touching) { touching = false; busy = false; }   // đang phản ứng bị chạm thì bỏ
    if (tween) { const res = tween.res; tween = null; res(); }      // kiểu làm nũng đang dở bị huỷ
    ox = down.px - x; hy = Math.max(0, down.py - r.top); ang = 0; angVel = 0; heldT = 0; hv = 0; thrown = false; sayT = rnd(1.3, 2); prevVx = 0;
    setState('held', true); showAct(0);
    img.style.transformOrigin = '50% 8%';                           // treo lủng lẳng từ đỉnh đầu
    document.documentElement.classList.remove('mc-hover'); hover = false;
    document.documentElement.classList.add('mc-grabbing');
    document.body.style.userSelect = 'none';
    say(pick(HOLD_SAY), 1400);
  }
  function heldStep(dt) {
    heldT += dt;
    ox += (w / 2 - ox) * Math.min(1, dt * 6);
    hy += (16 - hy) * Math.min(1, dt * 6);
    const tx = Math.min(window.innerWidth - w, Math.max(0, ptr.x - ox));
    const tl = Math.min(window.innerHeight - SIZE, Math.max(0, window.innerHeight - SIZE - (ptr.y - hy)));
    const nx = x + (tx - x) * Math.min(1, dt * 22);
    lift += (tl - lift) * Math.min(1, dt * 22);
    const vxNow = (nx - x) / Math.max(dt, 0.001);
    const acc = Math.max(-20000, Math.min(20000, (vxNow - prevVx) / Math.max(dt, 0.001)));
    prevVx = vxNow; x = nx;
    hv += (vxNow - hv) * Math.min(1, dt * 8);
    const sp = Math.abs(hv);
    if (sp > 130 && heldT > 0.3) showDrag(hv > 0 ? 'r' : 'l', sp < 320 ? 0 : sp < 620 ? 1 : sp < 1000 ? 2 : 3);   // kéo ngang: nghiêng theo hướng, vệt tốc độ dài dần
    else showAct(heldT < 0.09 ? 0 : heldT < 0.18 ? 1 : heldT < 0.27 ? 2 : heldT < 0.5 ? 3 : (Math.floor((heldT - 0.5) / 0.45) % 2 ? 2 : 3));   // giật mình, rồi vùng vẫy nhẹ (khung 3-4 luân phiên)
    const strug = Math.min(1, 0.35 + heldT / 5);                     // càng bị giữ lâu càng vùng vẫy mạnh
    angVel += (-60 * ang - 3.4 * angVel + 0.0013 * acc + Math.sin(performance.now() / 70) * 9 * strug) * dt;
    ang = Math.max(-1.1, Math.min(1.1, ang + angVel * dt));
    tilt();
    sayT -= dt;
    if (sayT <= 0) { say(pick(heldT > 5 && Math.random() < 0.6 ? ANGRY_SAY : HOLD_SAY), 1300); sayT = rnd(1.4, 2.3); }
  }
  function release() {
    if (!held) return;
    held = false; falling = true; bounces = 0;
    const v = ptrVel();
    vxF = Math.max(-900, Math.min(900, v.x)); lv = Math.max(-300, Math.min(900, -v.y));   // ném theo hướng chuột
    thrown = Math.hypot(vxF, Math.max(0, lv)) > 450; tossT = 0;   // thả nhẹ = rơi thường; vung mạnh = bị quăng đi
    img.style.transformOrigin = '50% 50%';
    setState('fall', true);
    document.documentElement.classList.remove('mc-grabbing');
    document.body.style.userSelect = '';
    say('Á á á~', 800);
  }
  function fallStep(dt) {
    lv -= 2600 * dt; lift += lv * dt; x += vxF * dt; vxF *= Math.pow(0.35, dt);
    if (x < 0) { x = 0; vxF = Math.abs(vxF) * 0.5; }
    if (x > window.innerWidth - w) { x = window.innerWidth - w; vxF = -Math.abs(vxF) * 0.5; }
    angVel += (-25 * ang - 2.5 * angVel) * dt; ang += angVel * dt; tilt();
    const spF = Math.abs(vxF);
    tossT += dt;
    if (thrown) {                                    // lộn nhào: 1→2→3→4 rồi quay vòng 3→7, sắp chạm đất thì khung 7 (có vệt đập)
      const k = Math.floor(tossT / 0.085);
      showToss(lift < 60 && lv < 0 ? 6 : (k < 7 ? k : 2 + ((k - 2) % 5)));
    }
    else if (lift < 70 && lv < 0) showAct(6);
    else if (spF > 220) showDrag(vxF > 0 ? 'r' : 'l', spF < 400 ? 0 : spF < 650 ? 1 : spF < 900 ? 2 : 3);   // bị ném ngang
    else showAct(lv > -250 ? 4 : 5);
    const top = window.innerHeight - SIZE;
    if (lift > top) { lift = top; if (lv > 0) lv = 0; }
    if (lift <= 0) {
      lift = 0;
      const impact = -lv;
      if (impact > 420 && bounces < 1) { lv = impact * 0.3; bounces++; vxF *= 0.6; } else land();
    }
  }
  function land() {
    falling = false; lift = 0; lv = 0; vxF = 0; ang = 0; angVel = 0;
    img.style.transform = ''; img.style.transformOrigin = '';
    x = clampX(x); target = x;
    setState('land'); if (thrown) showToss(7); else showAct(7);     // ném mạnh: nằm sấp; thả nhẹ: ngồi bệt
    say(pick(thrown ? TOSS_SAY : LAND_SAY), 1500);
    setTimeout(() => { if (state === 'land') startIdle(); }, thrown ? 1100 : 650);
    if (Math.random() < 0.4) setTimeout(() => { if (!held && !falling && !busy) startMove('pout'); }, 1500);   // đôi khi dỗi
  }

  let hover = false;      // con trỏ đổi thành bàn tay "nắm" khi rê lên nhân vật
  document.addEventListener('mousemove', (e) => {
    if (held) return;
    const o = overSprite(e.clientX, e.clientY);
    if (o !== hover) { hover = o; document.documentElement.classList.toggle('mc-hover', o); }
  }, { passive: true });
  document.addEventListener('mousedown', (e) => { if (e.button === 0 && overSprite(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || held || falling || !overSprite(e.clientX, e.clientY)) return;
    e.preventDefault(); e.stopPropagation();
    down = { px: e.clientX, py: e.clientY, t: performance.now() }; samples.length = 0; sample(e);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!down) return;
    sample(e);
    if (!held && Math.hypot(e.clientX - down.px, e.clientY - down.py) > 6) beginHold();
  }, { passive: true });
  const endPress = () => {
    if (!down) return;
    const wasHeld = held; down = null;
    if (wasHeld) release(); else tap();                               // bấm nhanh: xen kẽ bị chọc / ra chiêu thức (xem tap())
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 120);
  };
  document.addEventListener('pointerup', endPress, true);
  document.addEventListener('pointercancel', endPress, true);
  window.addEventListener('blur', () => { if (held) release(); down = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && held) release(); });
  document.addEventListener('click', (e) => {                          // nuốt cú bấm để không bấm trúng thứ nằm dưới nhân vật
    if (e.button === 0 && (suppressClick || overSprite(e.clientX, e.clientY))) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---- vòng lặp chính (rAF tự dừng khi tab ẩn; dt bị chặn trên để quay lại tab không bị "nhảy vọt")
  function pickTarget() {
    const m = maxX();
    let t = rnd(8, m);
    if (Math.abs(t - x) < 140) t = x < m / 2 ? Math.min(m, x + rnd(180, 380)) : Math.max(8, x - rnd(180, 380));
    target = t; speed = rnd(95, 150);          // chạy (có khung chạy riêng) nên nhanh hơn kiểu đi bộ cũ
    setState('walk');
  }
  const startIdle = () => { setState('idle'); idleWait = rnd(1.5, 4); };
  let last = performance.now();
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  startIdle(); place();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (down && !held && now - down.t > 220) beginHold();               // giữ chuột đủ lâu = nhấc lên
    if (held) { heldStep(dt); place(); requestAnimationFrame(tick); return; }
    if (falling) { fallStep(dt); place(); requestAnimationFrame(tick); return; }
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.ms);
      x = tween.from + (tween.to - tween.from) * tween.fn(t);
      if (t >= 1) { const r = tween.res; tween = null; r(); }
    } else if (!busy) {
      if (state === 'walk') {
        const d = target - x, step = speed * dt;
        if (Math.abs(d) <= step) { x = target; startIdle(); }
        else { x += Math.sign(d) * step; setFace(Math.sign(d)); runStep(dt, Math.sign(d)); }
      } else {
        idleWait -= dt;
        if (idleWait <= 0) {
          const r = Math.random();
          if (state === 'idle' && now - lastMove > MOVE_GAP && r < 0.4) startMove();   // tự làm nũng
          else pickTarget();
        }
      }
    }
    place();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
