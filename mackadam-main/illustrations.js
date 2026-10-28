// =============================================================================
// WORKS > ILLUSTRATION - "Placard Wall" (prototype)
// -----------------------------------------------------------------------------
// A salon hang on a dark wall. Click a piece: its frame comes off the wall
// toward the viewer while the room holds still, and a gallery placard slides
// in beside it. Phones get one column; a tap flips the piece up full-screen
// with the placard underneath.
//
// Paths resolve from this module, so it works both standalone (works.html)
// and when index.html injects the Works panel and imports works.js.
// =============================================================================

const DATA_URL = new URL('./illustrations/illustrations.json', import.meta.url).href;
const IMG_BASE = new URL('./illustrations/', import.meta.url).href;

// Prototype switch: marks fields still listed as "unconfirmed" in the JSON
// with a dotted underline and a note at the foot of the placard. Turn off
// once every field is confirmed.
const SHOW_DRAFT_MARKS = true;

// Frame geometry in units of 1% of the image height, so a frame keeps its
// proportions at any size (wall thumbnail or pulled-forward close-up).
const FRAMES = {
    'thin-black':      { mat: 7,  border: 1.6 },
    'matted-paper':    { mat: 13, border: 1.4 },
    'matted-colour':   { mat: 11, border: 1.8 },
    'sketchbook-tape': { mat: 0,  border: 0 },
    'none-dark':       { mat: 0,  border: 0 },
    'none-light':      { mat: 0,  border: 0 },
};

// Salon hang: pieces are not all the same size. Applied in display order.
const SIZE_PATTERN = [1, 0.8, 0.92, 0.74, 0.97, 0.84, 0.7, 1, 0.86, 0.78, 0.9, 0.82];
// Small vertical drift so rows don't read as a grid.
const DRIFT_PATTERN = [0, -0.05, 0.04, -0.02, 0.06, -0.04, 0.02, -0.06, 0.03, 0, -0.03, 0.05];

const MOBILE_QUERY = window.matchMedia('(max-width: 768px)');
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
    items: [],          // JSON items + natural aspect, sorted for display
    pieces: [],         // { item, li, btn, frame }
    order: 'newest',
    current: null,      // index into pieces of the piece that is out
    clone: null,        // the pulled-forward frame
    loaded: false,
    roomOpen: false,
};

let els = {};

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

// Newest-first needs a number even where the year is still a range or a note.
function sortYear(item) {
    if (typeof item.year === 'number') return item.year;
    const note = (item.yearNote || '').toLowerCase();
    if (note === 'recent') return 2026.5;
    const range = note.match(/(\d{4})\s*[-–]\s*(\d{4})/);
    if (range) return (Number(range[1]) + Number(range[2])) / 2;
    const before = note.match(/before\s+(\d{4})/);
    if (before) return Number(before[1]) - 1;
    return 2020; // no year at all: parked between the ranges, flagged as draft
}

function yearLabel(item) {
    if (typeof item.year === 'number') return String(item.year);
    const note = (item.yearNote || '').trim();
    if (!note) return 'Year unknown';
    return note.replace(/(\d{4})\s*-\s*(\d{4})/, '$1–$2').replace(/^./, (c) => c.toUpperCase());
}

function unconfirmedFields(item) {
    return (item.unconfirmed || []).map((f) => String(f).split(':')[0].trim());
}

function isDraft(item, field) {
    return SHOW_DRAFT_MARKS && unconfirmedFields(item).includes(field);
}

function loadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function loadData() {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching illustrations.json`);
    const json = await res.json();
    const items = await Promise.all(json.items.map(async (item, i) => {
        const src = IMG_BASE + item.file;
        const img = await loadImage(src);
        const aspect = img ? img.naturalWidth / img.naturalHeight : 0.75;
        return { ...item, src, aspect, sourceIndex: i };
    }));
    state.items = items;
}

function sortedItems() {
    const dir = state.order === 'newest' ? -1 : 1;
    return [...state.items].sort((a, b) =>
        (sortYear(a) - sortYear(b)) * dir || a.sourceIndex - b.sourceIndex);
}

// -----------------------------------------------------------------------------
// Frames
// -----------------------------------------------------------------------------

function frameSpec(item) {
    return FRAMES[item.frame] || FRAMES['none-dark'];
}

// Outer size of a framed piece whose image is `imgH` px tall.
function frameOuter(item, imgH) {
    const f = frameSpec(item);
    const u = imgH / 100;
    const edge = 2 * (f.mat + f.border) * u;
    return { w: imgH * item.aspect + edge, h: imgH + edge };
}

function makeFrame(item, imgH) {
    const f = frameSpec(item);
    const u = imgH / 100;
    const frame = document.createElement('div');
    frame.className = `illo-frame illo-frame--${item.frame || 'none-dark'}`;
    frame.style.setProperty('--u', `${u}px`);
    frame.style.padding = `${f.mat * u}px`;
    frame.style.borderWidth = `${f.border * u}px`;

    const img = document.createElement('img');
    img.src = item.src;
    img.alt = `${item.title}, ${yearLabel(item)}, ${item.medium}`;
    img.draggable = false;
    img.width = Math.round(imgH * item.aspect);
    img.height = Math.round(imgH);
    img.style.width = `${imgH * item.aspect}px`;
    img.style.height = `${imgH}px`;
    frame.appendChild(img);
    return frame;
}

// Image height that makes the framed piece fit inside a w x h box.
function fitImageHeight(item, boxW, boxH) {
    const unit = frameOuter(item, 100); // outer size per 100px of image height
    return 100 * Math.min(boxW / unit.w, boxH / unit.h);
}

// -----------------------------------------------------------------------------
// Wall layout (salon hang, reading order preserved left-to-right)
// -----------------------------------------------------------------------------

function layoutWall() {
    const wall = els.wall;
    const items = sortedItems();
    const width = wall.clientWidth;
    const mobile = MOBILE_QUERY.matches;
    const gap = mobile ? 56 : Math.max(36, width * 0.035);

    wall.innerHTML = '';
    state.pieces = [];

    // Plan sizes.
    const planned = items.map((item, i) => {
        const s = SIZE_PATTERN[i % SIZE_PATTERN.length];
        let imgH;
        if (mobile) {
            const target = width * (0.8 + 0.12 * s);
            imgH = fitImageHeight(item, target, window.innerHeight * 0.7);
        } else {
            const base = Math.min(380, Math.max(210, width / 4.4));
            imgH = base * s;
        }
        return { item, imgH, outer: frameOuter(item, imgH), drift: DRIFT_PATTERN[i % DRIFT_PATTERN.length] };
    });

    // Pack into rows.
    const rows = [];
    let row = [];
    let rowW = 0;
    for (const p of planned) {
        const add = (row.length ? gap : 0) + p.outer.w;
        if (!mobile && row.length && rowW + add > width) {
            rows.push(row);
            row = [];
            rowW = 0;
        }
        if (mobile && row.length) {
            rows.push(row);
            row = [];
            rowW = 0;
        }
        row.push(p);
        rowW += (row.length > 1 ? gap : 0) + p.outer.w;
    }
    if (row.length) rows.push(row);

    // Justify each row (linear: everything scales with image height).
    rows.forEach((r, ri) => {
        let k = 1;
        if (!mobile) {
            const sum = r.reduce((a, p) => a + p.outer.w, 0);
            k = (width - gap * (r.length - 1)) / sum;
            const isLast = ri === rows.length - 1;
            k = Math.min(k, isLast ? 1.05 : 1.3);
        }
        const rowEl = document.createElement('div');
        rowEl.className = 'illo-row';
        rowEl.style.gap = `${gap}px`;
        r.forEach((p) => {
            const imgH = p.imgH * k;
            const outerH = frameOuter(p.item, imgH).h;
            rowEl.appendChild(buildPiece(p.item, imgH, mobile ? 0 : p.drift * outerH));
        });
        wall.appendChild(rowEl);
    });

    if (state.current != null) {
        const piece = state.pieces[state.current];
        if (piece) piece.li.classList.add('is-out');
    }
}

function buildPiece(item, imgH, driftPx) {
    const index = state.pieces.length;
    const li = document.createElement('div');
    li.className = 'illo-piece';
    li.setAttribute('role', 'listitem');
    li.style.setProperty('--drift', `${driftPx}px`);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'illo-piece__btn';
    btn.setAttribute('aria-label', `${item.title}, ${yearLabel(item)}. Open placard.`);
    btn.dataset.index = String(index);

    const frame = makeFrame(item, imgH);
    btn.appendChild(frame);

    const tag = document.createElement('span');
    tag.className = 'illo-piece__tag';
    tag.textContent = `${item.title} · ${yearLabel(item)}`;
    btn.appendChild(tag);

    li.appendChild(btn);
    btn.addEventListener('click', () => openPiece(index));

    state.pieces.push({ item, li, btn, frame });
    return li;
}

// -----------------------------------------------------------------------------
// Placard
// -----------------------------------------------------------------------------

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function fillPlacard(index) {
    const { item } = state.pieces[index];
    const n = state.pieces.length;
    const draft = (field) => (isDraft(item, field) ? ' is-draft' : '');
    const drafts = SHOW_DRAFT_MARKS ? unconfirmedFields(item) : [];

    els.placard.innerHTML = `
        <div class="illo-placard__card">
            <div class="illo-placard__rule" aria-hidden="true"></div>
            <p class="illo-placard__count">${String(index + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</p>
            <h3 class="illo-placard__title" id="illoPlacardTitle">${escapeHtml(item.title)}</h3>
            <p class="illo-placard__artist"><span class="illo-placard__sig">Brian MacAdam</span></p>
            <dl class="illo-placard__meta">
                <div><dt>Year</dt><dd class="${draft('year')}">${escapeHtml(yearLabel(item))}</dd></div>
                <div><dt>Medium</dt><dd class="${draft('medium')}">${escapeHtml(item.medium)}</dd></div>
            </dl>
            <p class="illo-placard__caption">${escapeHtml(item.caption)}</p>
            <p class="illo-placard__desc">${escapeHtml(item.description)}</p>
            ${item.documentationPhoto ? `
                <p class="illo-placard__doc"><span aria-hidden="true">◐</span> Documentation photo, original no longer exists.</p>` : ''}
            ${drafts.length ? `
                <p class="illo-placard__draftnote">Draft: ${escapeHtml(drafts.join(', '))} unconfirmed</p>` : ''}
        </div>
        <div class="illo-placard__nav">
            <button type="button" class="illo-placard__btn" data-act="prev" aria-label="Previous piece">←</button>
            <button type="button" class="illo-placard__btn illo-placard__close" data-act="close" aria-label="Put it back on the wall">Back to wall <kbd>Esc</kbd></button>
            <button type="button" class="illo-placard__btn" data-act="next" aria-label="Next piece">→</button>
        </div>`;
    els.placard.setAttribute('aria-labelledby', 'illoPlacardTitle');
}

// -----------------------------------------------------------------------------
// Pull forward / put back
// -----------------------------------------------------------------------------

function motion(ms) {
    return REDUCED_MOTION.matches ? 1 : ms;
}

// Desktop: the piece takes the left ~60% of the screen, the placard the right.
function desktopTarget(item) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placardW = Math.min(380, vw * 0.3);
    const areaX = vw * 0.05;
    const areaW = vw - placardW - vw * 0.05 - vw * 0.09;
    const areaY = vh * 0.08;
    const areaH = vh * 0.84;
    const imgH = fitImageHeight(item, areaW, areaH);
    const outer = frameOuter(item, imgH);
    return {
        imgH,
        left: areaX + (areaW - outer.w) / 2,
        top: areaY + (areaH - outer.h) / 2,
    };
}

function flipKeyframes(first, last, { flip = false } = {}) {
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const s = first.width / last.width;
    const mid = s + (1 - s) * 0.5;
    const start = `translate(${dx}px, ${dy}px) scale(${s})`;
    const middle = flip
        ? `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${mid}) rotateY(90deg)`
        : `translate(${dx * 0.45}px, ${dy * 0.45}px) scale(${mid * 1.04}) translateZ(60px) rotateX(3deg)`;
    return [
        { transform: start, offset: 0 },
        { transform: middle, offset: flip ? 0.5 : 0.42 },
        { transform: 'none', offset: 1 },
    ];
}

function openPiece(index) {
    if (index < 0 || index >= state.pieces.length) return;
    if (state.current === index) return;

    const mobile = MOBILE_QUERY.matches;
    const previous = state.current;
    if (previous != null) putBack(previous, { quick: true });

    state.current = index;
    const piece = state.pieces[index];
    const { item } = piece;

    // The wall never scrolls while a piece is out: the room holds still. A
    // piece hung off-screen simply comes in from where it hangs.
    const first = piece.frame.getBoundingClientRect();

    fillPlacard(index);
    els.room.classList.add('is-viewing');
    els.stage.classList.toggle('is-sheet', mobile);

    let clone;
    if (mobile) {
        // Full-screen sheet: the piece on top, the placard underneath.
        els.stage.innerHTML = '';
        const vw = window.innerWidth;
        const imgH = fitImageHeight(item, vw - 32, window.innerHeight * 0.72);
        clone = makeFrame(item, imgH);
        clone.classList.add('illo-clone');
        const holder = document.createElement('div');
        holder.className = 'illo-sheet__piece';
        holder.appendChild(clone);
        els.stage.append(holder, els.placard);
        els.stage.scrollTop = 0;
    } else {
        if (els.placard.parentElement !== els.room) els.room.appendChild(els.placard);
        const t = desktopTarget(item);
        clone = makeFrame(item, t.imgH);
        clone.classList.add('illo-clone');
        clone.style.left = `${t.left}px`;
        clone.style.top = `${t.top}px`;
        els.stage.appendChild(clone);
    }

    piece.li.classList.add('is-out');
    const last = clone.getBoundingClientRect();
    clone.animate(flipKeyframes(first, last, { flip: mobile }), {
        duration: motion(mobile ? 620 : 760),
        easing: 'cubic-bezier(.2,.75,.12,1)',
    });
    clone.animate(
        [{ boxShadow: '0 4px 14px rgba(0,0,0,.5)' }, { boxShadow: '0 50px 120px rgba(0,0,0,.85), 0 18px 40px rgba(0,0,0,.6)' }],
        { duration: motion(760), easing: 'ease-out', fill: 'forwards' },
    );

    state.clone = clone;
    els.placard.classList.remove('is-in');
    void els.placard.offsetWidth;
    els.placard.classList.add('is-in');
    els.room.setAttribute('data-open-piece', item.id);

    // Keep focus inside the viewing state.
    const closeBtn = els.placard.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
}

function putBack(index, { quick = false, focus = false } = {}) {
    const piece = state.pieces[index];
    const clone = state.clone;
    state.clone = null;
    if (!piece || !clone) return;

    const mobile = els.stage.classList.contains('is-sheet');
    const done = () => {
        clone.remove();
        piece.li.classList.remove('is-out');
        if (focus) piece.btn.focus({ preventScroll: true });
    };

    if (mobile) {
        // The sheet fades away; the wall underneath already has the piece back.
        done();
        return;
    }

    if (quick) {
        // Stepping to another piece: this one recedes in place and is back on
        // the wall by the time the next one arrives.
        clone.style.zIndex = '0';
        const a = clone.animate([
            { transform: 'none', opacity: 1 },
            { transform: 'translate(2%, 2%) scale(0.94)', opacity: 0 },
        ], { duration: motion(320), easing: 'ease-in', fill: 'forwards' });
        a.onfinish = done;
        a.oncancel = done;
        return;
    }

    const from = clone.getBoundingClientRect();
    const to = piece.frame.getBoundingClientRect();
    // Re-anchor the clone to animate *to* the wall slot.
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const s = to.width / from.width;
    clone.style.transformOrigin = 'top left';
    clone.style.zIndex = '0';
    const anim = clone.animate([
        { transform: 'none', boxShadow: '0 50px 120px rgba(0,0,0,.85)' },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, boxShadow: '0 4px 14px rgba(0,0,0,.5)' },
    ], {
        duration: motion(560),
        easing: 'cubic-bezier(.5,0,.2,1)',
        fill: 'forwards',
    });
    anim.onfinish = done;
    anim.oncancel = done;
}

function closePiece() {
    if (state.current == null) return;
    const index = state.current;
    const wasSheet = els.stage.classList.contains('is-sheet');
    const slot = state.pieces[index];
    if (slot && !wasSheet) {
        const r = slot.btn.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) {
            slot.btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
    }
    putBack(index, { focus: true });
    state.current = null;
    els.room.classList.remove('is-viewing');
    els.room.removeAttribute('data-open-piece');
    els.placard.classList.remove('is-in');
    if (wasSheet) {
        setTimeout(() => {
            els.stage.classList.remove('is-sheet');
            els.room.appendChild(els.placard);
        }, motion(350));
    }
}

function step(delta) {
    const n = state.pieces.length;
    if (!n) return;
    const from = state.current ?? 0;
    openPiece((from + delta + n) % n);
}

// -----------------------------------------------------------------------------
// Room open / close
// -----------------------------------------------------------------------------

async function openRoom() {
    if (state.roomOpen) return;
    state.roomOpen = true;
    els.room.classList.add('is-open');
    els.room.setAttribute('aria-hidden', 'false');
    document.getElementById('dropdown')?.classList.remove('active');

    if (!state.loaded) {
        els.wall.innerHTML = '<p class="illo-loading">Hanging the wall…</p>';
        try {
            await loadData();
            state.loaded = true;
        } catch (err) {
            console.error('Illustration wall:', err);
            els.wall.innerHTML = '<p class="illo-loading">Could not load the drawings.</p>';
            return;
        }
    }
    layoutWall();
    els.scroll.scrollTop = 0;
    if (!MOBILE_QUERY.matches) state.pieces[0]?.btn.focus({ preventScroll: true, focusVisible: false });
}

function closeRoom() {
    if (state.current != null) closePiece();
    state.roomOpen = false;
    els.room.classList.remove('is-open');
    els.room.setAttribute('aria-hidden', 'true');
    document.querySelector('[data-open="illustration"]')?.focus({ preventScroll: true });
}

// -----------------------------------------------------------------------------
// Keyboard: arrows walk the wall (or step through pieces once one is out),
// Enter opens, Esc puts the piece back, Esc again leaves the room.
// -----------------------------------------------------------------------------

function nearestInDirection(fromIndex, dir) {
    const from = state.pieces[fromIndex].btn.getBoundingClientRect();
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    let best = null;
    let bestScore = Infinity;
    state.pieces.forEach((p, i) => {
        if (i === fromIndex) return;
        const r = p.btn.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dy = cy - fy;
        if (dir === 'down' && dy <= from.height * 0.3) return;
        if (dir === 'up' && dy >= -from.height * 0.3) return;
        const score = Math.abs(dy) + Math.abs(cx - fx) * 1.5;
        if (score < bestScore) { bestScore = score; best = i; }
    });
    return best;
}

function onKey(e) {
    if (!state.roomOpen) return;
    const viewing = state.current != null;

    if (e.key === 'Escape') {
        e.preventDefault();
        if (viewing) closePiece(); else closeRoom();
        return;
    }

    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!arrows.includes(e.key)) return;
    e.preventDefault();

    if (viewing) {
        step(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        return;
    }

    const active = document.activeElement;
    const at = active?.classList.contains('illo-piece__btn') ? Number(active.dataset.index) : -1;
    const n = state.pieces.length;
    let next;
    if (at < 0) next = 0;
    else if (e.key === 'ArrowLeft') next = Math.max(0, at - 1);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, at + 1);
    else next = nearestInDirection(at, e.key === 'ArrowDown' ? 'down' : 'up') ?? at;
    const btn = state.pieces[next]?.btn;
    if (btn) {
        btn.focus({ preventScroll: true });
        btn.scrollIntoView({ block: 'nearest', behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth' });
    }
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function initIllustrationWall() {
    els = {
        room: document.getElementById('illoRoom'),
        scroll: document.getElementById('illoScroll'),
        wall: document.getElementById('illoWall'),
        stage: document.getElementById('illoStage'),
        placard: document.getElementById('illoPlacard'),
    };
    if (!els.room || els.room.dataset.ready) return;
    els.room.dataset.ready = '1';

    document.querySelectorAll('[data-open="illustration"]').forEach((b) =>
        b.addEventListener('click', (e) => { e.stopPropagation(); openRoom(); }));

    els.room.querySelector('.illo-back')?.addEventListener('click', closeRoom);
    els.room.querySelector('.illo-dim')?.addEventListener('click', closePiece);
    els.stage.addEventListener('click', (e) => {
        // Clicking the empty stage (not the piece) puts it back.
        if (e.target === els.stage) closePiece();
    });

    els.placard.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'prev') step(-1);
        if (act === 'next') step(1);
        if (act === 'close') closePiece();
    });

    els.room.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => {
        if (state.order === b.dataset.order) return;
        if (state.current != null) closePiece();
        state.order = b.dataset.order;
        els.room.querySelectorAll('[data-order]').forEach((o) =>
            o.setAttribute('aria-pressed', String(o.dataset.order === state.order)));
        layoutWall();
    }));

    document.addEventListener('keydown', onKey);

    window.addEventListener('resize', debounce(() => {
        if (!state.roomOpen || !state.loaded) return;
        const open = state.current;
        if (open != null) closePiece();
        layoutWall();
        if (open != null && !MOBILE_QUERY.matches) openPiece(open);
    }, 180));

    // Deep link for review: works.html#illustration opens the wall.
    if (location.hash === '#illustration') openRoom();
}
