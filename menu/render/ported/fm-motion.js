// Food & Market's UI motion, verbatim from the platform (extract_food_market.py).
// Do not edit; re-run the extractor.
// Only runs while <html data-fm-motion> is set (both Food & Market sites).
    // Buzz and doodle drift need data-fm-motion-lab too (test copy only).
    // Cards reveal on scroll, a kitchen switch slides sideways, the basket bar bumps
    // with a dish flying into it, haptic ticks, photos zoom out of their thumbnail.
    // Doodle drift is CSS only. Reduced-motion users get none of it.
    (function () {
        const root = document.documentElement;
        const on = () => root.hasAttribute('data-fm-motion')
            && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const buzz = ms => {
            if (!root.hasAttribute('data-fm-motion-lab')) return;
            try { navigator.vibrate?.(ms); } catch (_) {}
        };

        // Cards reveal as they scroll in; a kitchen switch sets the slide direction.
        const list = document.getElementById('menu-list');
        if (list && 'IntersectionObserver' in window) {
            let batch = 0, batchTimer = null;
            const io = new IntersectionObserver(entries => {
                entries.forEach(en => {
                    if (!en.isIntersecting) return;
                    io.unobserve(en.target);
                    en.target.style.setProperty('--fmm-delay', Math.min(batch++ * 55, 275) + 'ms');
                    en.target.classList.add('fmm-in');
                    requestAnimationFrame(() => en.target.classList.remove('fmm-pending'));
                });
                clearTimeout(batchTimer);
                batchTimer = setTimeout(() => { batch = 0; }, 120);
            }, { rootMargin: '0px 0px -8% 0px' });
            const prime = () => {
                if (!on()) return;
                list.querySelectorAll('.menu-item:not(.fmm-in):not(.fmm-pending)').forEach(card => {
                    card.classList.add('fmm-pending');
                    io.observe(card);
                });
            };
            new MutationObserver(prime).observe(list, { childList: true, subtree: true });
            new MutationObserver(prime).observe(root, { attributes: true, attributeFilter: ['data-fm-motion'] });
        }
        let lastGroup = root.dataset.fmGroup, dxTimer = null;
        new MutationObserver(() => {
            const g = root.dataset.fmGroup;
            if (g === lastGroup) return;
            const keys = [...document.querySelectorAll('.group-btn')].map(b => b.dataset.group);
            const dir = keys.indexOf(g) >= keys.indexOf(lastGroup) ? 1 : -1;
            lastGroup = g;
            if (!on()) return;
            root.style.setProperty('--fmm-dx', (dir * 36) + 'px');
            clearTimeout(dxTimer);
            dxTimer = setTimeout(() => root.style.removeProperty('--fmm-dx'), 900);
            buzz(8);
        }).observe(root, { attributes: true, attributeFilter: ['data-fm-group'] });

        // Basket: bar bump, count tick, the dish photo flying into the bar, haptics.
        let lastTap = null;
        document.addEventListener('pointerdown', e => {
            const btn = e.target.closest('.qty-add-btn, .qty-inc, .qty-btn[data-delta="1"]');
            if (!btn) return;
            const r = btn.getBoundingClientRect();
            const img = btn.closest('.menu-item')?.querySelector('img');
            lastTap = { x: r.left + r.width / 2, y: r.top + r.height / 2, src: img?.currentSrc || img?.src || '', t: performance.now() };
        }, true);
        const countEl = document.getElementById('basket-bar-count');
        const bar = document.getElementById('basket-bar');
        let lastCount = 0;
        const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
        function fly(tap, barHidden) {
            const b = bar.getBoundingClientRect();
            // A hidden bar is still parked below the screen; aim where it slides up to.
            const by = barHidden ? innerHeight - b.height / 2 : b.top + b.height / 2;
            const el = document.createElement(tap.src ? 'img' : 'div');
            el.className = 'fmm-fly';
            if (tap.src) { el.src = tap.src; el.alt = ''; }
            el.style.left = tap.x + 'px'; el.style.top = tap.y + 'px';
            document.body.appendChild(el);
            const dx = b.left + b.width / 2 - tap.x, dy = by - tap.y;
            const anim = el.animate([
                { transform: 'translate(0,0) scale(0.6)', opacity: 0.95 },
                { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(1)`, opacity: 1, offset: 0.45 },
                { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.4 }
            ], { duration: 600, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' });
            anim.onfinish = anim.oncancel = () => el.remove();
            return anim;
        }
        if (countEl && bar) {
            new MutationObserver(() => {
                const n = parseInt(countEl.textContent, 10) || 0;
                const prev = lastCount; lastCount = n;
                if (!on() || n === prev) return;
                if (n > prev) {
                    buzz(12);
                    const tap = lastTap && performance.now() - lastTap.t < 800 ? lastTap : null;
                    lastTap = null;
                    const bump = () => { replay(bar, 'fmm-bump'); replay(countEl, 'fmm-tick'); };
                    if (tap) fly(tap, prev === 0).finished.then(bump, bump); else bump();
                } else {
                    buzz(6);
                    replay(countEl, 'fmm-tick-down');
                }
            }).observe(countEl, { childList: true, characterData: true, subtree: true });
        }

        // Photo-only dishes: the fullscreen photo zooms out of the tapped thumbnail.
        const lb = document.getElementById('img-lightbox'), lbImg = document.getElementById('lightbox-img');
        let fromRect = null;
        document.addEventListener('click', e => {
            const img = e.target.closest('.menu-item img');
            fromRect = img ? img.getBoundingClientRect() : null;
        }, true);
        const zoomIn = () => {
            const to = lbImg.getBoundingClientRect();
            if (!fromRect || !to.width) return;
            const sx = fromRect.width / to.width, sy = fromRect.height / to.height;
            const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
            const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
            lbImg.animate([
                { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
                { transform: 'none' }
            ], { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
            fromRect = null;
        };
        if (lb && lbImg) {
            new MutationObserver(() => {
                if (!on() || !lb.classList.contains('open') || lb.classList.contains('has-panel')) return;
                buzz(6);
                if (lbImg.complete && lbImg.naturalWidth) zoomIn();
                else lbImg.addEventListener('load', zoomIn, { once: true });
            }).observe(lb, { attributes: true, attributeFilter: ['class'] });
        }
    })();
