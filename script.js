/* ==============================================
   ROMAN & ELIZAVETA — WEDDING INVITATION
   ============================================== */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    /* ═══════ FORCE-LIGHT: detect & fix browser dark mode ═══════ */
    (function forceLightDetect() {
        // Create test element with known light color
        const test = document.createElement('div');
        test.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;background-color:#F4EEE4;pointer-events:none;';
        document.body.appendChild(test);
        const computed = getComputedStyle(test).backgroundColor;
        document.body.removeChild(test);

        // Parse RGB
        const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return;
        const lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];

        // If luminance is still bright (>180), force-dark is NOT active
        if (lum > 180) return;

        // Force-dark detected! Apply aggressive inline fixes
        console.log('[Wedding] Force-dark detected (lum=' + lum.toFixed(0) + '). Applying light mode fixes.');

        const colorMap = {
            // selector → [bgColor, textColor]
            'html': ['#F4EEE4', null],
            'body': ['#F4EEE4', '#2E2E26'],
            '.envelope-screen': ['#F4EEE4', null],
            '.envelope-letter': ['#F4EEE4', null],
            '.welcome-section': ['#E7DDCD', null],
            '.countdown-section': ['#F4EEE4', null],
            '.countdown-cell': ['#E7DDCD', null],
            '.venue-section': ['#E7DDCD', null],
            '.venue-card': ['#F4EEE4', null],
            '.schedule-section': ['#F4EEE4', null],
            '.tl-card': ['#E7DDCD', null],
            '.tl-dot': ['#F4EEE4', null],
            '.gallery-section': ['#E7DDCD', null],
            '.dresscode-section': ['#F4EEE4', null],
            '.wishes-section': ['#E7DDCD', null],
            '.wish-item': ['#F4EEE4', null],
            '.rsvp-section': ['#F4EEE4', null],
            '.rsvp-ok': ['#F4EEE4', null],
            '.final-section': ['#E7DDCD', null],
            '.btn-submit': ['#404738', '#F4EEE4'],
            '.copy-toast': ['#404738', '#F4EEE4'],
            '.music-btn': ['rgba(231,221,205,.92)', '#404738'],
            '.volume-slider-wrap': ['rgba(231,221,205,.92)', null],
        };

        const textColorMap = {
            '.section-label': '#2C2F25',
            '.hero-initial': '#2C2F25',
            '.hero-name-first': '#2C2F25',
            '.hero-name-second': '#2C2F25',
            '.hero-name-and': '#7D856B',
            '.hero-amp': '#7D856B',
            '.hero-subtitle': '#4A4840',
            '.hero-date-text': '#2C2F25',
            '.welcome-text p': '#2E2E26',
            '.welcome-greeting': '#404738',
            '.dresscode-text': '#2E2E26',
            '.dresscode-note': '#4A4840',
            '.dresscode-copy-hint': '#7A7768',
            '.countdown-num': '#2C2F25',
            '.countdown-word': '#7A7768',
            '.countdown-date': '#4A4840',
            '.countdown-sep': '#7D856B',
            '.venue-name': '#2C2F25',
            '.venue-address': '#4A4840',
            '.tl-time': '#404738',
            '.tl-card h4': '#2C2F25',
            '.tl-card p': '#4A4840',
            '.tl-icon': '#7D856B',
            '.wish-item p': '#2E2E26',
            '.wish-icon': '#7D856B',
            '.rsvp-intro': '#4A4840',
            '.rsvp-intro strong': '#404738',
            '.field label': '#7A7768',
            '.final-script': '#7D856B',
            '.final-names': '#2C2F25',
            '.final-date': '#7A7768',
            '.final-copy': '#7A7768',
        };

        // Apply background fixes
        for (const [sel, [bg, txt]] of Object.entries(colorMap)) {
            document.querySelectorAll(sel).forEach(el => {
                el.style.setProperty('background-image', `linear-gradient(0deg, ${bg}, ${bg})`, 'important');
                el.style.setProperty('background-color', bg, 'important');
                if (txt) {
                    el.style.setProperty('color', txt, 'important');
                    el.style.setProperty('-webkit-text-fill-color', txt, 'important');
                }
            });
        }

        // Apply text color fixes
        for (const [sel, color] of Object.entries(textColorMap)) {
            document.querySelectorAll(sel).forEach(el => {
                el.style.setProperty('color', color, 'important');
                el.style.setProperty('-webkit-text-fill-color', color, 'important');
            });
        }

        // Fix dress code swatches
        const swatchColors = ['#E7DDCD', '#CBB2A3', '#C9A38F', '#B88F79', '#A7AF98', '#7D856B', '#5D654F', '#404738'];
        document.querySelectorAll('.dc-swatch').forEach((sw, i) => {
            const c = swatchColors[i] || sw.dataset.color;
            if (c) {
                sw.style.setProperty('background-color', c, 'important');
                sw.style.setProperty('background-image', `linear-gradient(0deg, ${c}, ${c})`, 'important');
            }
        });

        // Fix form inputs
        document.querySelectorAll('.field input, .field select, .field textarea, .guest-name-field input').forEach(el => {
            el.style.setProperty('background-color', '#E7DDCD', 'important');
            el.style.setProperty('background-image', 'linear-gradient(0deg, #E7DDCD, #E7DDCD)', 'important');
            el.style.setProperty('color', '#2E2E26', 'important');
            el.style.setProperty('-webkit-text-fill-color', '#2E2E26', 'important');
        });

        // Fix images & canvas
        document.querySelectorAll('img, canvas, svg').forEach(el => {
            el.style.setProperty('filter', 'none', 'important');
        });
    })();

    /* ═══════ CONFIG ═══════ */
    const WEDDING_DATE = new Date('2026-08-08T16:00:00+03:00').getTime();
    const MAX_GALLERY = 50;
    const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp'];

    /* ═══════ FALLING ROSE PETALS — envelope screen only ═══════ */
    const petalCanvas = document.getElementById('petals-canvas');
    const pCtx = petalCanvas.getContext('2d');
    let petals = [];
    let petalsActive = true;

    function resizePetalCanvas() {
        petalCanvas.width = window.innerWidth;
        petalCanvas.height = window.innerHeight;
    }
    resizePetalCanvas();
    window.addEventListener('resize', () => {
        resizePetalCanvas();
        resizeSparkleCanvas();
    });

    class Petal {
        constructor(init) { this.reset(init) }
        reset(init) {
            this.x = Math.random() * petalCanvas.width;
            this.y = init ? Math.random() * petalCanvas.height : -20;
            this.size = Math.random() * 7 + 4;
            this.speedY = Math.random() * 0.4 + 0.15;
            this.speedX = (Math.random() - 0.5) * 0.3;
            this.rotation = Math.random() * Math.PI * 2;
            this.rotSpeed = (Math.random() - 0.5) * 0.008;
            this.opacity = Math.random() * 0.18 + 0.06;
            this.wobble = Math.random() * Math.PI * 2;
            this.wobbleSpeed = Math.random() * 0.008 + 0.003;
            const pinks = [[220, 175, 168], [215, 185, 178], [225, 190, 185], [210, 170, 165], [230, 200, 195]];
            this.color = pinks[Math.floor(Math.random() * pinks.length)];
        }
        update() {
            this.y += this.speedY;
            this.wobble += this.wobbleSpeed;
            this.x += this.speedX + Math.sin(this.wobble) * 0.3;
            this.rotation += this.rotSpeed;
            if (this.y > petalCanvas.height + 20) this.reset(false);
        }
        draw() {
            pCtx.save();
            pCtx.translate(this.x, this.y);
            pCtx.rotate(this.rotation);
            pCtx.globalAlpha = this.opacity;
            const [r, g, b] = this.color;
            pCtx.fillStyle = `rgb(${r},${g},${b})`;
            const s = this.size;
            pCtx.beginPath();
            pCtx.moveTo(0, 0);
            pCtx.bezierCurveTo(s * 0.5, -s * 0.8, s, -s * 0.3, 0, s);
            pCtx.bezierCurveTo(-s, -s * 0.3, -s * 0.5, -s * 0.8, 0, 0);
            pCtx.fill();
            pCtx.restore();
        }
    }

    for (let i = 0; i < 15; i++) petals.push(new Petal(true));

    function animPetals() {
        if (!petalsActive) { pCtx.clearRect(0, 0, petalCanvas.width, petalCanvas.height); return }
        pCtx.clearRect(0, 0, petalCanvas.width, petalCanvas.height);
        petals.forEach(p => { p.update(); p.draw() });
        requestAnimationFrame(animPetals);
    }
    animPetals();

    /* ═══════ SPARKLE / RHINESTONE SHIMMER — main page ═══════ */
    const sparkCanvas = document.getElementById('sparkle-canvas');
    const sCtx = sparkCanvas.getContext('2d');
    let sparkles = [];
    let sparkleActive = false;

    function resizeSparkleCanvas() {
        sparkCanvas.width = window.innerWidth;
        sparkCanvas.height = window.innerHeight;
    }
    resizeSparkleCanvas();

    class Sparkle {
        constructor() { this.reset(true) }
        reset(init) {
            this.x = Math.random() * sparkCanvas.width;
            this.y = Math.random() * sparkCanvas.height;
            this.size = Math.random() * 2.5 + 0.5;
            this.maxLife = Math.random() * 180 + 60;
            this.life = init ? Math.random() * this.maxLife : 0;
            this.opacity = 0;
            // Rhinestone/crystal colors — warm whites, golds, soft pinks
            const colors = [
                [255, 255, 240],  // ivory white
                [255, 248, 220],  // cornsilk
                [250, 235, 215],  // antique white
                [245, 222, 179],  // wheat gold
                [255, 228, 196],  // bisque
                [230, 210, 200],  // soft pink
                [220, 215, 200],  // warm silver
            ];
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }
        update() {
            this.life++;
            const halfLife = this.maxLife / 2;
            if (this.life < halfLife) {
                this.opacity = (this.life / halfLife) * 0.7;
            } else {
                this.opacity = ((this.maxLife - this.life) / halfLife) * 0.7;
            }
            if (this.life >= this.maxLife) this.reset(false);
        }
        draw() {
            if (this.opacity <= 0) return;
            sCtx.save();
            sCtx.globalAlpha = this.opacity;
            const [r, g, b] = this.color;

            // Glow
            sCtx.shadowColor = `rgba(${r},${g},${b},0.6)`;
            sCtx.shadowBlur = this.size * 4;

            // Cross-star shape (rhinestone sparkle)
            sCtx.fillStyle = `rgb(${r},${g},${b})`;
            const s = this.size;
            sCtx.beginPath();
            sCtx.moveTo(this.x, this.y - s * 2);
            sCtx.lineTo(this.x + s * 0.4, this.y - s * 0.4);
            sCtx.lineTo(this.x + s * 2, this.y);
            sCtx.lineTo(this.x + s * 0.4, this.y + s * 0.4);
            sCtx.lineTo(this.x, this.y + s * 2);
            sCtx.lineTo(this.x - s * 0.4, this.y + s * 0.4);
            sCtx.lineTo(this.x - s * 2, this.y);
            sCtx.lineTo(this.x - s * 0.4, this.y - s * 0.4);
            sCtx.closePath();
            sCtx.fill();

            // Bright center dot
            sCtx.shadowBlur = 0;
            sCtx.globalAlpha = this.opacity * 1.2;
            sCtx.beginPath();
            sCtx.arc(this.x, this.y, s * 0.3, 0, Math.PI * 2);
            sCtx.fill();

            sCtx.restore();
        }
    }

    // Create sparkle particles
    for (let i = 0; i < 35; i++) sparkles.push(new Sparkle());

    function animSparkle() {
        if (!sparkleActive) return;
        sCtx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
        sparkles.forEach(s => { s.update(); s.draw() });
        requestAnimationFrame(animSparkle);
    }

    /* ═══════ ENVELOPE ═══════ */
    const envScreen = document.getElementById('envelope-screen');
    const envelope = document.getElementById('envelope');
    const mainCont = document.getElementById('main-content');
    const musicPanel = document.getElementById('music-panel');
    const musicBtn = document.getElementById('music-btn');
    const bgMusic = document.getElementById('bg-music');
    const volWrap = document.getElementById('volume-slider-wrap');
    const volSlider = document.getElementById('volume-slider');

    function openEnvelope() {
        if (envelope.classList.contains('is-open')) return;
        envelope.classList.add('is-open');
        tryPlayMusic();
        setTimeout(() => {
            envScreen.classList.add('is-gone');
            mainCont.classList.add('is-shown');
            musicPanel.classList.add('is-show');
            document.body.style.overflow = '';

            // Stop petals, start sparkle
            petalsActive = false;
            petalCanvas.style.display = 'none';
            sparkleActive = true;
            sparkCanvas.classList.add('is-active');
            animSparkle();

            setTimeout(initScrollAnimations, 400);
        }, 1400);
    }

    envelope.addEventListener('click', openEnvelope);
    document.body.style.overflow = 'hidden';

    /* ═══════ MUSIC + VOLUME ═══════ */
    let isMuted = true;
    musicBtn.classList.add('is-muted');

    function tryPlayMusic() {
        if (!bgMusic) return;
        bgMusic.volume = volSlider.value / 100;
        bgMusic.play().then(() => {
            isMuted = false;
            musicBtn.classList.remove('is-muted');
            musicBtn.classList.add('is-playing');
            volWrap.classList.add('is-show');
        }).catch(() => {
            isMuted = true;
            musicBtn.classList.add('is-muted');
        });
    }

    musicBtn.addEventListener('click', () => {
        if (!bgMusic) return;
        if (isMuted || bgMusic.paused) {
            bgMusic.volume = volSlider.value / 100;
            bgMusic.play().then(() => {
                isMuted = false;
                musicBtn.classList.remove('is-muted');
                musicBtn.classList.add('is-playing');
                volWrap.classList.add('is-show');
            }).catch(() => { });
        } else {
            bgMusic.pause();
            isMuted = true;
            musicBtn.classList.add('is-muted');
            musicBtn.classList.remove('is-playing');
            volWrap.classList.remove('is-show');
        }
    });

    volSlider.addEventListener('input', () => {
        const val = volSlider.value / 100;
        if (bgMusic) bgMusic.volume = val;
        volSlider.style.background = `linear-gradient(to right, #7D856B 0%, #7D856B ${volSlider.value}%, #D9CCBA ${volSlider.value}%, #D9CCBA 100%)`;
    });
    volSlider.style.background = `linear-gradient(to right, #7D856B 0%, #7D856B 35%, #D9CCBA 35%, #D9CCBA 100%)`;

    /* ═══════ COUNTDOWN ═══════ */
    const elD = document.getElementById('cd-days'), elH = document.getElementById('cd-hours'), elM = document.getElementById('cd-mins'), elS = document.getElementById('cd-secs');
    function tick() {
        const diff = WEDDING_DATE - Date.now();
        if (diff <= 0) { elD.textContent = '🎉'; elH.textContent = '🥂'; elM.textContent = '💒'; elS.textContent = '💍'; return }
        setN(elD, Math.floor(diff / 86400000)); setN(elH, Math.floor((diff % 86400000) / 3600000));
        setN(elM, Math.floor((diff % 3600000) / 60000)); setN(elS, Math.floor((diff % 60000) / 1000));
    }
    function setN(el, v) {
        const s = String(v).padStart(2, '0');
        if (el.textContent !== s) { el.style.opacity = '.4'; el.style.transform = 'translateY(-4px)'; setTimeout(() => { el.textContent = s; el.style.opacity = '1'; el.style.transform = 'translateY(0)' }, 120) }
    }
    tick(); setInterval(tick, 1000);

    /* ═══════ SCROLL ANIMATIONS ═══════ */
    function initScrollAnimations() {
        const items = document.querySelectorAll('[data-anim]');
        const obs = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) { const d = parseInt(e.target.dataset.delay || '0', 10); setTimeout(() => e.target.classList.add('is-visible'), d); obs.unobserve(e.target) } });
        }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
        items.forEach(el => obs.observe(el));
    }

    /* ═══════ DYNAMIC GALLERY ═══════ */
    const galGrid = document.getElementById('gallery-grid');
    const galSrcs = [];

    function tryImg(n) {
        return new Promise((resolve, reject) => {
            function attempt(ei) {
                if (ei >= IMG_EXT.length) { reject(); return }
                const src = `images/${n}.${IMG_EXT[ei]}`;
                const img = new Image();
                img.onload = () => resolve(src);
                img.onerror = () => attempt(ei + 1);
                img.src = src;
            }
            attempt(0);
        });
    }

    async function loadGallery() {
        for (let i = 1; i <= MAX_GALLERY; i++) {
            try {
                const src = await tryImg(i);
                galSrcs.push(src);
                const div = document.createElement('div');
                div.className = 'gal-item';
                div.dataset.index = galSrcs.length - 1;
                const img = document.createElement('img');
                img.src = src; img.alt = `Фото ${i}`; img.loading = 'lazy';
                div.appendChild(img); galGrid.appendChild(div);
                div.addEventListener('click', () => openLB(parseInt(div.dataset.index)));
            } catch { continue }
        }
        if (!galSrcs.length) {
            galGrid.innerHTML = '<p style="text-align:center;color:#7A7768;font-style:italic;padding:40px 0">Фото будуть додані пізніше...</p>';
        }
    }
    loadGallery();

    /* ═══════ LIGHTBOX ═══════ */
    const lb = document.getElementById('lightbox'), lbImg = document.getElementById('lb-img'), lbCnt = document.getElementById('lb-counter');
    let curIdx = 0;
    function openLB(i) { if (!galSrcs.length) return; curIdx = i; lbImg.src = galSrcs[i]; lbCnt.textContent = `${i + 1} / ${galSrcs.length}`; lb.classList.add('is-open'); document.body.style.overflow = 'hidden' }
    function closeLB() { lb.classList.remove('is-open'); document.body.style.overflow = '' }
    function prevLB() { curIdx = (curIdx - 1 + galSrcs.length) % galSrcs.length; lbImg.style.opacity = '0'; setTimeout(() => { lbImg.src = galSrcs[curIdx]; lbCnt.textContent = `${curIdx + 1} / ${galSrcs.length}`; lbImg.style.opacity = '1' }, 200) }
    function nextLB() { curIdx = (curIdx + 1) % galSrcs.length; lbImg.style.opacity = '0'; setTimeout(() => { lbImg.src = galSrcs[curIdx]; lbCnt.textContent = `${curIdx + 1} / ${galSrcs.length}`; lbImg.style.opacity = '1' }, 200) }
    document.getElementById('lb-close').addEventListener('click', closeLB);
    document.getElementById('lb-prev').addEventListener('click', prevLB);
    document.getElementById('lb-next').addEventListener('click', nextLB);
    lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('lb-img-wrap')) closeLB() });
    document.addEventListener('keydown', e => { if (!lb.classList.contains('is-open')) return; if (e.key === 'Escape') closeLB(); if (e.key === 'ArrowLeft') prevLB(); if (e.key === 'ArrowRight') nextLB() });
    let touchX = 0;
    lb.addEventListener('touchstart', e => { touchX = e.changedTouches[0].clientX }, { passive: true });
    lb.addEventListener('touchend', e => { const d = e.changedTouches[0].clientX - touchX; if (Math.abs(d) > 50) d > 0 ? prevLB() : nextLB() }, { passive: true });

    /* ═══════ COLOR COPY ═══════ */
    const copyToast = document.getElementById('copy-toast');
    document.querySelectorAll('.dc-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
            const color = sw.dataset.color; if (!color) return;
            navigator.clipboard.writeText(color).then(() => {
                copyToast.textContent = `${color} скопійовано!`;
                copyToast.classList.add('is-show'); sw.classList.add('is-copied');
                setTimeout(() => { copyToast.classList.remove('is-show'); sw.classList.remove('is-copied') }, 1800);
            }).catch(() => {
                const ta = document.createElement('textarea'); ta.value = color; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                copyToast.textContent = `${color} скопійовано!`; copyToast.classList.add('is-show');
                setTimeout(() => copyToast.classList.remove('is-show'), 1800);
            });
        });
    });

    /* ═══════ DYNAMIC GUEST FIELDS ═══════ */
    const guestSel = document.getElementById('f-guests'), guestBox = document.getElementById('guest-names-container');
    function updateGuestFields() {
        const count = parseInt(guestSel.value, 10); guestBox.innerHTML = '';
        for (let i = 1; i <= count; i++) {
            const wrap = document.createElement('div'); wrap.className = 'guest-name-field'; wrap.style.animationDelay = `${i * 0.1}s`;
            const label = document.createElement('label'); label.setAttribute('for', `guest-name-${i}`); label.textContent = `Ім'я гостя ${i}`;
            const input = document.createElement('input'); input.type = 'text'; input.id = `guest-name-${i}`; input.name = `guest_name_${i}`; input.placeholder = `Ім'я гостя ${i}`;
            wrap.appendChild(label); wrap.appendChild(input); guestBox.appendChild(wrap);
        }
    }
    guestSel.addEventListener('change', updateGuestFields);

    /* ═══════ RSVP ═══════ */
    const rsvpForm = document.getElementById('rsvp-form'), rsvpOk = document.getElementById('rsvp-ok'), rsvpErr = document.getElementById('rsvp-error');

    rsvpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-submit');
        btn.innerHTML = '<span>Надсилаємо...</span>'; btn.disabled = true;
        rsvpErr.classList.remove('is-show');

        const fd = new FormData(rsvpForm);
        const gc = parseInt(fd.get('guests') || '0', 10);
        const gn = [];
        for (let i = 1; i <= gc; i++) { const n = fd.get(`guest_name_${i}`); if (n && n.trim()) gn.push(n.trim()) }

        const attendance = fd.get('attend') === 'yes' ? 'Так, з радістю!' : 'На жаль, ні';
        const transferVal = fd.get('transfer') === 'yes' ? 'Так, потрібен' : 'Ні, самостійно';
        const guestsStr = gc === 0 ? 'Тільки я' : '+' + gc + (gn.length ? ' (' + gn.join(', ') + ')' : '');

        const payload = {
            fullName: fd.get('name') || '',
            attendance: attendance,
            guests: guestsStr,
            transfer: transferVal,
            comment: fd.get('comment') || ''
        };

        try {
            const res = await fetch('https://wedding-rsvp.liza-zhizhikinadt.workers.dev/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (result.success) {
                rsvpForm.style.display = 'none';
                rsvpOk.classList.add('is-show');
            } else {
                btn.innerHTML = '<span>Надіслати відповідь</span>'; btn.disabled = false;
                rsvpErr.classList.add('is-show');
            }
        } catch (err) {
            console.error('RSVP error:', err);
            btn.innerHTML = '<span>Надіслати відповідь</span>'; btn.disabled = false;
            rsvpErr.classList.add('is-show');
        }
    });

    /* ═══════ PARALLAX ═══════ */
    const heroCont = document.querySelector('.hero-content'), heroBg = document.querySelector('.hero-bg-img');
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                const sy = window.scrollY;
                if (heroCont && sy < window.innerHeight) { heroCont.style.transform = `translateY(${sy * .25}px)`; heroCont.style.opacity = Math.max(0, 1 - sy / (window.innerHeight * .7)) }
                if (heroBg && sy < window.innerHeight) { heroBg.style.transform = `scale(1.08) translateY(${sy * .08}px)` }
                ticking = false;
            });
            ticking = true;
        }
    });

});
