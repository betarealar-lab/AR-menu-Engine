        // ── Modal ──────────────────────────────────────────────────────
        const modal       = document.getElementById('modal');
        const modalViewer = document.getElementById('modal-viewer');
        // Hands-free auto-spin toggle for the 3D viewer (show the phone, no fingers).
        const modalSpinBtn = document.getElementById('modal-spin');
        let _modalSpin = false;
        function _applyModalSpin() {
            if (_modalSpin) {
                modalViewer.setAttribute('auto-rotate', '');
                modalViewer.setAttribute('auto-rotate-delay', '0');   // resume immediately after a touch
                modalViewer.setAttribute('rotation-per-second', '20deg'); // slow, gentle spin
            } else {
                modalViewer.removeAttribute('auto-rotate');
            }
            modalSpinBtn.classList.toggle('active', _modalSpin);
            modalSpinBtn.setAttribute('aria-pressed', _modalSpin ? 'true' : 'false');
        }
        modalSpinBtn.addEventListener('click', e => { e.stopPropagation(); _modalSpin = !_modalSpin; _applyModalSpin(); });
        const modalTitle  = document.getElementById('modal-title');
        const modalPrice  = document.getElementById('modal-price');

        /* Long dish names ("Beef Stroganoff, garnish: potatoes / chips / rice") used to
           overflow the mobile title and get sliced in half by the 3D viewer below.
           Scale the type down until the whole name fits the height a two-line title
           already occupies — short names keep their full size and the 3D area never
           changes. Desktop hides #modal-title entirely, so this is a no-op there. */
        function _fitModalTitle() {
            if (!modalTitle || !modalTitle.textContent) return;
            modalTitle.style.fontSize = '';
            // Must run while the modal is actually on screen: a hidden element reports
            // scrollHeight 0, which reads as "already fits" and silently does nothing.
            if (!modalTitle.clientHeight) return;
            const cs = getComputedStyle(modalTitle);
            // Measure against the max-height the stylesheet allows, NOT clientHeight:
            // the tight line-height leaves scrollHeight a few px above clientHeight at
            // every size, so comparing those two never settles and crushes the type.
            // The 6px margin keeps the last line's descenders clear of the clip edge.
            const limit = (parseFloat(cs.maxHeight) || modalTitle.clientHeight) - 6;
            let size = parseFloat(cs.fontSize) || 28;
            for (let i = 0; i < 40 && modalTitle.scrollHeight > limit && size > 15; i++) {
                size -= 1;
                modalTitle.style.fontSize = size + 'px';
            }
        }
        // Rotating the phone changes how many lines the name wraps to.
        window.addEventListener('resize', () => {
            if (modal.classList.contains('active')) _fitModalTitle();
        });
        let menuItems  = [];
        let modalItems = [];
        let modalIndex = 0;
        let modalMessage = '';

        const modalQtyCtrl = document.getElementById('modal-qty-ctrl');
        modalQtyCtrl.querySelector('.qty-add-btn').addEventListener('click', e => { e.stopPropagation(); const k = modalQtyCtrl.dataset.idx; addToBasket(k, modalItems[modalIndex]); });
        modalQtyCtrl.querySelector('.qty-dec').addEventListener('click',     e => { e.stopPropagation(); const k = modalQtyCtrl.dataset.idx; const en = _basket.get(k); if (en) _setQty(k, en.qty - 1); });
        modalQtyCtrl.querySelector('.qty-inc').addEventListener('click',     e => { e.stopPropagation(); const k = modalQtyCtrl.dataset.idx; addToBasket(k, modalItems[modalIndex]); });
        document.getElementById('close-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

        // Desktop slide-up drawer — no-op on mobile (<640px)
        (function() {
            const _d  = document.getElementById('modal-drawer');
            const _db = document.getElementById('modal-drawer-body');
            _db.addEventListener('click', e => e.stopPropagation());
            _d.addEventListener('click', () => {
                if (window.innerWidth < 640) return;
                const expanding = !_d.classList.contains('expanded');
                if (expanding) {
                    // Measure body content height to animate viewer shift exactly
                    const inner = _db.querySelector('div');
                    const bodyH = inner ? inner.scrollHeight : 240;
                    const PEEK  = 88;
                    modal.style.setProperty('--drawer-full-h', (PEEK + bodyH + 48) + 'px');
                }
                _d.classList.toggle('expanded');
                modal.classList.toggle('drawer-expanded', expanding);
            });
        })();

        const modalArBtn = document.getElementById('modal-ar-btn');
        modalArBtn.addEventListener('click', () => {
            const idx   = modalIndex;
            const items = modalItems;
            closeModal();
            openAR(idx, items);
        });
        // Step to the next/prev item that actually has a 3D model, so the arrows
        // never land on a photo-only dish (which would show an empty viewer).
        function _stepModalToModel(dir) {
            const n = modalItems.length;
            if (!n) return modalIndex;
            let i = modalIndex;
            for (let s = 0; s < n; s++) {
                i = (i + dir + n) % n;
                if (_isAREnabledMenuItem(modalItems[i])) return i;
            }
            return modalIndex; // no other 3D item — stay put
        }
        document.getElementById('modal-prev').addEventListener('click', e => {
            e.stopPropagation();
            modalIndex = _stepModalToModel(-1);
            updateModal();
        });
        document.getElementById('modal-next').addEventListener('click', e => {
            e.stopPropagation();
            modalIndex = _stepModalToModel(1);
            updateModal();
        });

        function updateModal() {
            const item = modalItems[modalIndex];
            if (!item) return;
            // model-viewer is lazy-loaded; ensure it's defined before setting the source so
            // the modal's 3D viewer renders (it's usually already loaded from thumbnail upgrades).
            const posterUrl = _safeAssetUrl(item.thumbnail_url);
            if (posterUrl) modalViewer.setAttribute('poster', posterUrl);
            else modalViewer.removeAttribute('poster');
            const modalOrbit = _itemCameraOrbit(item);
            if (modalOrbit) modalViewer.setAttribute('camera-orbit', modalOrbit);
            else modalViewer.removeAttribute('camera-orbit');
            _ensureModelViewer().then(() => { modalViewer.src = _safeAssetUrl(item.model) || ''; });
            modalTitle.textContent = t(item, 'name');
            _fitModalTitle();
            document.getElementById('modal-title-d').textContent = t(item, 'name');
            _setPriceWithOld(modalPrice, item.price, item.price_old);
            document.getElementById('modal-description').textContent = t(item, 'description') || '';
            const msgEl = document.getElementById('modal-message');
            msgEl.textContent = modalMessage;
            msgEl.style.display = modalMessage ? 'block' : 'none';
            const key = String(modalIndex);
            document.getElementById('modal-qty-ctrl').dataset.idx = key;
            _syncQtyCtrl(key);
            _applyModalSpin();
        }

        function openModal(localIdx, catItems, fallbackMessage = '') {
            modalItems = catItems || menuItems;
            modalIndex = localIdx;
            modalMessage = fallbackMessage;
            _modalSpin = false;   // each dish opens static; tap the spin button to rotate
            // Arrows only make sense when 2+ dishes in this list are 3D dishes. Test the
            // 3D/AR toggle, not merely "a model file exists" — a dish switched off in the
            // admin panel keeps its uploaded model and must stay out of the 3D viewer.
            const _navModels = modalItems.filter(_isAREnabledMenuItem).length;
            const _navDisp = _navModels > 1 ? '' : 'none';
            document.getElementById('modal-prev').style.display = _navDisp;
            document.getElementById('modal-next').style.display = _navDisp;
            const _viewItem = modalItems[localIdx];
            const _viewIdx  = (_viewItem && menuItems) ? menuItems.indexOf(_viewItem) : null;
            _modalOpenTime = Date.now();
            const _repeatView = _viewIdx >= 0 && _modalViewedItems.has(_viewIdx);
            if (_viewIdx >= 0) _modalViewedItems.add(_viewIdx);
            track('item_view', _viewIdx >= 0 ? _viewIdx : null, _repeatView ? { repeat: true } : null);
            _trackFirstInteraction('3d');
            updateModal();
            // Reset desktop drawer state
            document.getElementById('modal-drawer').classList.remove('expanded');
            modal.classList.remove('drawer-expanded');
            modalArBtn.textContent  = _arButtonLabel(_viewItem);
            modalArBtn.style.display = (_isAREnabledMenuItem(_viewItem) || _canLikelyAR(_viewItem)) ? 'block' : 'none';
            modal.style.display = 'flex';
            // Only now is the title measurable — updateModal() ran while #modal was
            // still display:none, where every height reads as 0.
            _fitModalTitle();
            requestAnimationFrame(() => modal.classList.add('active'));
            document.body.style.overflow = 'hidden';
            // Defer thumbnail teardown past the modal fade-in frame so it doesn't block
            // animation — pause live thumbnails (free their GPU) while the modal is open.
            requestAnimationFrame(() => {
                document.querySelectorAll('.thumb-wrap model-viewer').forEach(mv => {
                    const src = mv.getAttribute('src');
                    if (!src) return;
                    mv.closest('.thumb-wrap')?.classList.remove('thumb-model-ready');
                    mv.dataset.pausedSrc = src;
                    mv.removeAttribute('src');
                });
            });
        }

        function closeModal() {
            const _closeItem = modalItems[modalIndex];
            const _closeIdx  = (_closeItem && menuItems) ? menuItems.indexOf(_closeItem) : null;
            track('modal_close', _closeIdx >= 0 ? _closeIdx : null,
                  { duration_ms: _modalOpenTime ? Date.now() - _modalOpenTime : null });
            _modalOpenTime = null;
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
                modalViewer.removeAttribute('src');
                document.querySelectorAll('.thumb-wrap model-viewer').forEach(mv => {
                    if (!mv.dataset.pausedSrc) return;
                    const src = mv.dataset.pausedSrc;
                    delete mv.dataset.pausedSrc;
                    const r = mv.getBoundingClientRect();
                    const inView = r.bottom > -100 && r.top < window.innerHeight + 100;
                    if (inView) {
                        // Visible: bring the live model back, but keep the poster as the
                        // only visible layer until model-viewer has rendered again.
                        mv.addEventListener('load', () => {
                            mv.closest('.thumb-wrap')?.classList.add('thumb-model-ready');
                        }, { once: true });
                        mv.setAttribute('src', src);
                    } else {
                        // Off-screen: never leave it blank (the old code dropped src here and
                        // the poster <img> beneath was already hidden → an empty tile that
                        // never recovered because `upgraded` stayed set). Tear the live viewer
                        // back down to its poster and re-arm the upgrade so it comes alive
                        // again on scroll — and free its GPU context in the meantime.
                        const wrap = mv.closest('.thumb-wrap');
                        const img  = wrap && wrap.querySelector('.thumb-img');
                        mv.remove();
                        if (img) {
                            wrap?.classList.remove('thumb-model-ready');
                            delete img.dataset.upgraded;
                            _upgradeObserver.observe(img);
                        }
                    }
                });
            }, 200);
            document.body.style.overflow = '';
        }

        // ── Image lightbox / rich photo popup ──────────────────────────
        const _lightbox    = document.getElementById('img-lightbox');
        const _lightboxImg = document.getElementById('lightbox-img');
        const _lbName      = document.getElementById('lightbox-name');
        const _lbDesc      = document.getElementById('lightbox-desc');
        const _lbPrice     = document.getElementById('lightbox-price');
        const _lbPanel     = document.getElementById('lightbox-panel');
        const _lbQtyCtrl   = document.getElementById('lightbox-qty');
        const _lbOptions   = document.getElementById('lightbox-options');
        const _lbCloseBtn  = document.getElementById('lightbox-close');
        let   _lbItem      = null;
        let   _lbIdx       = null;
        let   _lbReturnFocus = null;
        function _lightboxKey() {
            if (_lbItem == null || _lbIdx == null) return '';
            const hasVariants = !!(_lbItem.variants && _lbItem.variants.length);
            const hasAddons = !!(_lbItem.addons && _lbItem.addons.length);
            if (!hasVariants && !hasAddons) return String(_lbIdx);
            const sel = ((window.__addonSel[_lbIdx]) || []).slice().sort((a, b) => a - b);
            const vSel = hasVariants ? _variantIndex(_lbItem, _lbIdx) : null;
            return _basketKey(_lbIdx, vSel, sel);
        }
        function _refreshLightboxSelection() {
            if (_lbItem == null || _lbIdx == null) return;
            const hasVariants = !!(_lbItem.variants && _lbItem.variants.length);
            const vIdx = hasVariants ? _variantIndex(_lbItem, _lbIdx) : -1;
            if (hasVariants) _lbPrice.textContent = _lbItem.variants[vIdx]?.price || '';
            else _setPriceWithOld(_lbPrice, _lbItem.price || '', _lbItem.price_old);
            _lbOptions.querySelectorAll('.variant').forEach(btn => {
                const on = parseInt(btn.dataset.vi, 10) === vIdx;
                btn.classList.toggle('selected', on);
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            _lbOptions.querySelectorAll('.addon').forEach(btn => {
                const selected = window.__addonSel[_lbIdx] || [];
                const on = selected.indexOf(parseInt(btn.dataset.ai, 10)) >= 0;
                btn.classList.toggle('selected', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            _lbQtyCtrl.dataset.idx = _lightboxKey();
            _syncQtyCtrl(_lbQtyCtrl.dataset.idx);
        }
        function _addLightboxItem() {
            if (!_lbItem || _lbIdx == null) return;
            const hasVariants = !!(_lbItem.variants && _lbItem.variants.length);
            const hasAddons = !!(_lbItem.addons && _lbItem.addons.length);
            if (hasVariants || hasAddons) {
                const sel = ((window.__addonSel[_lbIdx]) || []).slice().sort((a, b) => a - b);
                const vSel = hasVariants ? _variantIndex(_lbItem, _lbIdx) : null;
                const key = _basketKey(_lbIdx, vSel, sel);
                addToBasket(key, _lbItem, sel, vSel);
                _lbQtyCtrl.dataset.idx = key;
            } else {
                addToBasket(_lbQtyCtrl.dataset.idx, _lbItem);
            }
        }
        // openLightbox(src, alt)            → plain fullscreen image.
        // openLightbox(src, alt, item, idx) → rich popup: name on top, optional photo,
        //   then description + price + add-to-cart. The panel qty control reuses
        //   the standard .qty-ctrl markup with the item's data-idx, so
        //   _syncQtyCtrl keeps it in step with the card control and basket bar.
        function openLightbox(src, alt, item, idx) {
            if (!src && item == null) return;
            _lbReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (src) _lightboxImg.src = src;
            else _lightboxImg.removeAttribute('src');
            _lightboxImg.alt = alt || '';
            if (item != null && idx != null) {
                _lbItem = item;
                _lbIdx = idx;
                const key = String(idx);
                _lbQtyCtrl.dataset.idx = key;
                _lbName.textContent  = t(item, 'name');
                const d = t(item, 'description') || '';
                _lbDesc.textContent = d;
                _lbDesc.style.display = d ? '' : 'none';
                _lbOptions.innerHTML = _variantsHtml(item, idx) + _addonsHtml(item, idx);
                _lightbox.classList.add('has-panel');
                _lightbox.classList.toggle('no-photo', !src);
                _refreshLightboxSelection();
            } else {
                _lbItem = null;
                _lbIdx = null;
                _lbOptions.innerHTML = '';
                _lightbox.classList.remove('has-panel', 'no-photo');
            }
            _lightbox.classList.add('open');
            _lightbox.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            _lbCloseBtn.focus({ preventScroll: true });
        }
        function closeLightbox() {
            _lightbox.classList.remove('open', 'has-panel', 'no-photo');
            _lightbox.setAttribute('aria-hidden', 'true');
            _lightboxImg.removeAttribute('src');
            _lbItem = null;
            _lbIdx = null;
            _lbOptions.innerHTML = '';
            document.body.style.overflow = '';
            _lbReturnFocus?.focus?.({ preventScroll: true });
            _lbReturnFocus = null;
        }
        // Backdrop / close button / photo tap dismiss; taps on the name or the
        // panel must not.
        _lightbox.addEventListener('click', closeLightbox);
        _lbPanel.addEventListener('click', e => e.stopPropagation());
        _lbName.addEventListener('click', e => e.stopPropagation());
        _lbCloseBtn.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
        _lbQtyCtrl.querySelector('.qty-add-btn').addEventListener('click', e => {
            e.stopPropagation();
            _addLightboxItem();
        });
        _lbQtyCtrl.querySelector('.qty-dec').addEventListener('click', e => { e.stopPropagation(); const k = _lbQtyCtrl.dataset.idx; const en = _basket.get(k); if (en) _setQty(k, en.qty - 1); });
        _lbQtyCtrl.querySelector('.qty-inc').addEventListener('click', e => { e.stopPropagation(); _addLightboxItem(); });
        _lbOptions.addEventListener('click', e => {
            e.stopPropagation();
            if (_lbItem == null || _lbIdx == null) return;
            const variantBtn = e.target.closest('.variant');
            if (variantBtn) {
                window.__variantSel[_lbIdx] = parseInt(variantBtn.dataset.vi, 10);
                _refreshLightboxSelection();
                return;
            }
            const addonBtn = e.target.closest('.addon');
            if (addonBtn) {
                const ai = parseInt(addonBtn.dataset.ai, 10);
                const arr = window.__addonSel[_lbIdx] || (window.__addonSel[_lbIdx] = []);
                const at = arr.indexOf(ai);
                if (at < 0) arr.push(ai);
                else arr.splice(at, 1);
                _refreshLightboxSelection();
            }
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && _lightbox.classList.contains('open')) closeLightbox();
        });

        // ── AR capability detection ────────────────────────────────────
        // Function declarations, not consts: detectAR() and the cached-capability
        // restore both run before the `const _isIOS` line further down would be
        // initialised, so anything they call has to be hoisted.
        function _looksIOS() {
            return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        }

        // Handheld AR needs a camera the guest can point at their table. A device
        // with no touch input and only a fine pointer is a desktop and cannot do
        // it, whatever a user agent claims. Used to stop "VIEW ON TABLE" ever
        // being offered where tapping it could only fail.
        function _deviceCouldDoAR() {
            try {
                if ((navigator.maxTouchPoints || 0) > 0) return true;
                if (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches) return true;
                return false;
            } catch (_) {
                return true;   // can't tell — don't block a real phone
            }
        }

        // A cached capability is a claim about the device running the page right
        // now. localStorage is per-ORIGIN and every ?tenant= menu shares one
        // origin, so a value written on one tenant — or while a phone was being
        // emulated in devtools — is otherwise replayed on the desktop for the
        // next seven days. Re-validate before trusting it.
        function _capStillPlausible(cap) {
            if (!cap || cap === 'none') return false;
            if (!_deviceCouldDoAR()) return false;
            if (cap === 'arkit') return _looksIOS();
            if (cap === 'webxr') return !!navigator.xr;
            return false;
        }

        async function detectAR() {
            const cached = localStorage.getItem('bl-ar-cap');
            const ts = parseInt(localStorage.getItem('bl-ar-cap-ts') || '0');
            if (_capStillPlausible(cached) && (Date.now() - ts < 7 * 24 * 60 * 60 * 1000)) {
                window.__arCap = cached;
                return cached;
            }

            let cap = 'none';
            if (_deviceCouldDoAR()) {
                if (navigator.xr) {
                    try {
                        if (await navigator.xr.isSessionSupported('immersive-ar')) cap = 'webxr';
                    } catch {}
                }
                if (cap === 'none' && _looksIOS()) cap = 'arkit';
            }
            window.__arCap = cap;
            localStorage.setItem('bl-ar-cap', cap);
            localStorage.setItem('bl-ar-cap-ts', String(Date.now()));
            return cap;
        }

        function _modelUrl(item) {
            return String(item?.model || '').trim();
        }

        function _usdzUrl(item) {
            return String(item?.model_usdz || '').trim();
        }

        function _safeAssetUrl(value) {
            const raw = String(value || '').trim();
            if (!raw) return '';
            try {
                const url = new URL(raw, location.href);
                return /^https?:$/.test(url.protocol) ? url.href : '';
            } catch (_) {
                return '';
            }
        }

        function _safeModelUrl(item) {
            return _safeAssetUrl(_modelUrl(item));
        }

        function _hasModel(item) {
            return !!_safeModelUrl(item);
        }

        function _isAREnabledMenuItem(item) {
            return item?.text_only !== true && item?.is_3d !== false && _hasModel(item);
        }

        // Admin-set starting camera view for an item's 3D thumbnail/modal. Stored in
        // theme_config as `item_view_<itemId>` = "h v zoom" (degrees, degrees, percent)
        // and returned as a model-viewer camera-orbit string. Empty string = default view.
        function _itemCameraOrbit(item) {
            const raw = (item && item.id != null) ? _themeConfig['item_view_' + item.id] : '';
            if (!raw) return '';
            const p = String(raw).trim().split(/\s+/).map(Number);
            if (p.length !== 3 || p.some(n => !isFinite(n))) return '';
            const h = Math.max(-360, Math.min(360, p[0]));
            const v = Math.max(0, Math.min(85, p[1]));
            const zoom = Math.max(30, Math.min(300, p[2]));
            return `${h}deg ${v}deg ${zoom}%`;
        }

        function _canLikelyAR(item, cap = window.__arCap) {
            // A dish with the 3D/AR toggle off is a plain photo dish, even though its
            // uploaded model (or USDZ) is still attached in the database.
            if (item?.text_only === true || item?.is_3d === false) return false;
            if (cap === 'webxr') return _hasModel(item);
            if (cap === 'arkit') return !!_usdzUrl(item);
            return false;
        }

        function _arButtonLabel(item) {
            const u = UI[window.__lang];
            return _canLikelyAR(item) ? u.viewAR : u.view3D;
        }

        function setARButtonsState(loading) {
            const u = UI[window.__lang];
            document.querySelectorAll('.ar-btn').forEach(b => {
                const item = menuItems[parseInt(b.dataset.idx, 10)];
                b.textContent = loading ? u.loading : _arButtonLabel(item);
                b.disabled    = loading;
            });
            if (modalArBtn) {
                const item = modalItems[modalIndex];
                modalArBtn.textContent = loading ? u.loading : _arButtonLabel(item);
                modalArBtn.disabled = loading;
                modalArBtn.style.display = (_isAREnabledMenuItem(item) || _canLikelyAR(item)) ? 'block' : 'none';
            }
        }

        async function _validateModelUrl(url) {
            const href = _safeAssetUrl(url);
            if (!href) return false;
            async function probe(method, headers) {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 6000);
                try {
                    const res = await fetch(href, { method, headers, cache: 'no-store', mode: 'cors', signal: ctrl.signal });
                    if (res.body) res.body.cancel().catch(() => {});
                    return res.ok || res.status === 206;
                } catch (_) {
                    return false;
                } finally {
                    clearTimeout(timer);
                }
            }
            if (await probe('HEAD')) return true;
            return probe('GET', { Range: 'bytes=0-0' });
        }

        function _fallbackTo3D(localIdx, items, message) {
            const _fbItems = items || _arCatItems || menuItems;
            const _fbItem  = _fbItems[localIdx];
            const _fbIdx   = (_fbItem && menuItems) ? menuItems.indexOf(_fbItem) : null;
            track('ar_fallback', _fbIdx >= 0 ? _fbIdx : null);
            setARButtonsState(false);
            _arOpening = false;
            openModal(localIdx, _fbItems, message || UI[window.__lang].arFailed);
        }

        // ── iOS AR launcher — hidden model-viewers pre-load so activateAR()
        //    can fire synchronously from the tap without losing the gesture context.
        //    Cache key includes ar_scale so items with different scales get distinct launchers.
        const _arLaunchers = {};
        function _getARLauncher(src, arScale) {
            const scale = arScale || 1.0;
            const key   = scale !== 1.0 ? `${src}::${scale}` : src;
            if (!_arLaunchers[key]) {
                _ensureModelViewer(); // legacy no-USDZ path needs the lazy-loaded library
                const mv = document.createElement('model-viewer');
                mv.setAttribute('ar', '');
                mv.setAttribute('ar-modes', 'quick-look');
                mv.src = src;
                // Bake ar_scale into the USDZ so Quick Look places the model at the same
                // real-world size that the Android Three.js renderer applies via ar_scale.
                if (scale !== 1.0) mv.setAttribute('scale', `${scale} ${scale} ${scale}`);
                mv.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;left:-9999px;';
                mv.addEventListener('load', () => {
                    if (!mv.model) return;
                    mv.model.materials.forEach(mat => {
                        const pbr = mat.pbrMetallicRoughness;
                        if (pbr) pbr.setMetallicFactor(0);
                    });
                });
                document.body.appendChild(mv);
                // After Three.js finishes decoding all models, swap to a y-offset-corrected
                // GLB blob so Quick Look places the model on the surface, not below it.
                window.XR?._preloadDone?.then(() =>
                    window.XR.getSeatedBlob?.(src, scale).then(blobUrl => {
                        if (blobUrl && mv.isConnected) {
                            mv.removeAttribute('scale'); // scale is baked into the seated blob
                            mv.src = blobUrl;
                        }
                    })
                );
                _arLaunchers[key] = mv;
            }
            return _arLaunchers[key];
        }

        const _isIOS = _looksIOS();
        // Seeding arkit from the user agent alone would offer "VIEW ON TABLE" on
        // any machine that merely looks iOS-ish; gate it on the device actually
        // being able to run a handheld session.
        if (_isIOS && _deviceCouldDoAR() && !window.__arCap) window.__arCap = 'arkit';

        function _launchIOSAR(launcher, localIdx) {
            // activateAR() silently does nothing if the model hasn't finished loading.
            // Fall back to 3D modal so the user gets content; they can retry AR once
            // the launcher has finished downloading the GLB and converting to USDZ.
            if (!launcher.loaded) {
                _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arNoUsdz);
                return;
            }
            function onARStatus(e) {
                const s = e.detail.status;
                const _iosItem = _arCatItems ? _arCatItems[localIdx] : null;
                const _iosIdx  = (_iosItem && menuItems) ? menuItems.indexOf(_iosItem) : null;
                const _iosGIdx = _iosIdx >= 0 ? _iosIdx : null;
                if (s === 'failed') {
                    launcher.removeEventListener('ar-status', onARStatus);
                    _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arFailed);
                } else if (s === 'session-started') {
                    launcher.removeEventListener('ar-status', onARStatus);
                    track('ar_success', _iosGIdx);
                }
            }
            launcher.addEventListener('ar-status', onARStatus);
            launcher.activateAR();
            setTimeout(() => { setARButtonsState(false); _arOpening = false; }, 2500);
        }

        // ── Native iOS Quick Look ──────────────────────────────────────
        // When an item has a prebuilt USDZ (generated in the admin at upload time),
        // hand it straight to Safari via an <a rel="ar"> click inside the tap
        // gesture. No model-viewer, no GLB download, no on-device conversion racing
        // the gesture — the file is already seated, scaled, and ready.
        function _launchQuickLook(usdzUrl, localIdx) {
            const href = _safeAssetUrl(usdzUrl);
            if (!href) {
                _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arNoUsdz);
                return;
            }
            const _item = _arCatItems ? _arCatItems[localIdx] : null;
            const _idx  = (_item && menuItems) ? menuItems.indexOf(_item) : null;
            const a = document.createElement('a');
            a.setAttribute('rel', 'ar');
            a.href = href;
            // Quick Look only triggers from a click on an <a rel="ar"> that holds an <img>.
            a.appendChild(document.createElement('img'));
            document.body.appendChild(a);
            a.click();
            track('ar_success', _idx >= 0 ? _idx : null);
            setTimeout(() => a.remove(), 1000);
            setARButtonsState(false);
            _arOpening = false;
        }

        // ── AR routing ─────────────────────────────────────────────────
        let _arOpening  = false;
        let _arCatItems = null;

        async function openAR(localIdx, catItems) {
            if (_arOpening) return;
            _arOpening  = true;
            _arCatItems = catItems || menuItems;
            const _tapItem = _arCatItems[localIdx];
            const _tapIdx  = (_tapItem && menuItems) ? menuItems.indexOf(_tapItem) : null;
            track('ar_tap', _tapIdx >= 0 ? _tapIdx : null,
                  { source: modal.classList.contains('active') ? 'modal' : 'card' });
            _trackFirstInteraction('ar');
            setARButtonsState(true);

            const cap  = window.__arCap ?? await detectAR();
            const item = _arCatItems[localIdx];

            if (!item) { setARButtonsState(false); _arOpening = false; return; }
            const modelUrl = _safeModelUrl(item);
            const usdzUrl = _usdzUrl(item);

            if (cap === 'webxr' && window.XR) {
                if (!modelUrl) {
                    _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arNoModel);
                    return;
                }
                if (!await _validateModelUrl(modelUrl)) {
                    _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arModelMissing);
                    return;
                }
                try {
                    // Carousel navigates only 3D-model items, so photo-only dishes
                    // never appear as empty slots. Remap the index into that list.
                    const _arList = _arCatItems.filter(_isAREnabledMenuItem);
                    const _arIdx  = Math.max(0, _arList.indexOf(item));
                    await window.XR.start(_arIdx, _arList);
                } catch (err) {
                    console.error('XR start failed:', err);
                    _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arFailed);
                }
            } else if (cap === 'arkit') {
                if (usdzUrl) {
                    // Prebuilt USDZ (made at upload time) — hand it straight to Quick Look.
                    _launchQuickLook(usdzUrl, localIdx);
                } else if (modelUrl) {
                    // No prebuilt USDZ (legacy item, or upload-time conversion was skipped):
                    // still give iPhone users AR via on-device seated conversion, instead of
                    // dropping straight to the 3D modal. Falls back to 3D on its own if the
                    // model hasn't finished loading. (Ported from the single-tenant app.)
                    _launchIOSAR(_getARLauncher(modelUrl, item.ar_scale), localIdx);
                } else {
                    _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arNoUsdz);
                }
            } else {
                // No AR support (non-ARCore Android, desktop) — open 3D modal
                _fallbackTo3D(localIdx, _arCatItems, UI[window.__lang].arUnsupported);
            }
        }

        // ── Lazy model-viewer loader ───────────────────────────────────────
        // model-viewer is loaded on demand (after first paint, or on modal open) — not
        // in <head> — so its ~250KB + multi-second eval never blocks the cold load.
        let _mvPromise = null;
        function _ensureModelViewer() {
            if (_mvPromise) return _mvPromise;
            _mvPromise = new Promise(resolve => {
                if (window.customElements && customElements.get('model-viewer')) return resolve();
                const s = document.createElement('script');
                s.type = 'module';
                s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js';
                s.onload  = () => customElements.whenDefined('model-viewer').then(resolve);
                s.onerror = () => resolve(); // fail open — thumbnails just stay as posters
                document.head.appendChild(s);
            });
            return _mvPromise;
        }

        // ── Poster → live-3D thumbnail upgrade ──────────────────────────────
        // Thumbnails render first as plain <img> posters (no WebGL, paint with the menu).
        // After first paint, in-view thumbnails upgrade to a live <model-viewer> that
        // stays invisible while the external poster <img> remains the only visible
        // layer. Once the model loads, the wrapper flips to the live model.
        const _upgradePending = new Set();
        let   _upgradeTimer   = null;

        function _drainUpgrades() {
            _upgradeTimer = null;
            const img = _upgradePending.values().next().value;
            if (!img) return;
            _upgradePending.delete(img);
            _upgradeThumb(img);
            if (_upgradePending.size > 0) _upgradeTimer = setTimeout(_drainUpgrades, 150);
        }

        function _upgradeThumb(img) {
            if (!img || img.dataset.upgraded || !img.isConnected) return;
            const model = img.dataset.model;
            if (!model) return;
            img.dataset.upgraded = '1';
            const wrap = img.closest('.thumb-wrap');
            const gIdx = parseInt(img.dataset.globalIdx, 10);
            _ensureModelViewer().then(() => {
                if (!wrap || !wrap.isConnected) return;
                wrap.classList.remove('thumb-model-ready');
                const mv = document.createElement('model-viewer');
                mv.setAttribute('camera-controls', '');
                mv.setAttribute('shadow-intensity', '0');
                mv.setAttribute('interaction-prompt', 'none');
                mv.setAttribute('min-camera-orbit', 'auto 0deg auto');
                mv.setAttribute('max-camera-orbit', 'auto 85deg auto');
                const orbit = _itemCameraOrbit(menuItems[gIdx]);
                if (orbit) mv.setAttribute('camera-orbit', orbit);
                wrap.insertBefore(mv, wrap.firstChild);
                let _px = 0, _py = 0;
                mv.addEventListener('pointerdown', e => { _px = e.clientX; _py = e.clientY; });
                mv.addEventListener('pointerup', e => {
                    if (Math.abs(e.clientX - _px) < 6 && Math.abs(e.clientY - _py) < 6)
                        openModal(gIdx, menuItems);
                });
                mv.addEventListener('load', () => {
                    wrap.classList.add('thumb-model-ready');
                }, { once: true });
                mv.setAttribute('src', model);
            });
        }

        const _upgradeObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting && entry.target.dataset.model && !entry.target.dataset.upgraded) {
                    _upgradePending.add(entry.target);
                    if (!_upgradeTimer) _upgradeTimer = setTimeout(_drainUpgrades, 0);
                }
            });
        }, { rootMargin: '200px' });

        // Begin upgrading posters to live 3D — called on idle after first paint.
        function _startThumbUpgrades() {
            document.querySelectorAll('.thumb-img[data-model]').forEach(img => {
                if (img.dataset.model && !img.dataset.upgraded) _upgradeObserver.observe(img);
            });
        }

        // ── Build menu ─────────────────────────────────────────────────

        // Parse theme_config.drink_categories into a Set of lowercased category
        // name_en. Accepts a JSON array (["Coffee","Tea"]) or a plain comma/newline
        // list. Empty/invalid → empty Set (no Food/Drinks switch).
        function _parseDrinkCats(raw) {
            const out = new Set();
            if (!raw) return out;
            const s = String(raw).trim();
            let list = [];
            if (s[0] === '[') { try { list = JSON.parse(s); } catch (e) { list = []; } }
            if (!list.length) list = s.replace(/^\[|\]$/g, '').split(/[,;\n]/);
            list.forEach(v => {
                const n = String(v).replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase();
                if (n) out.add(n);
            });
            return out;
        }