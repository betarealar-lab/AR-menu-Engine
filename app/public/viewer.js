        let THREE, GLTFLoader, GLTFExporter;
        let renderer, scene, camera, reticle, xrCanvas;
        let carouselRoot, slotGroups = [];
        let gestureLayer, xrOverlay;
        let hitTestSource = null, xrSession = null, xrStarting = false;
        let placed = false, isAnimating = false, _ignoreNextSelect = false;
        let _reticleWasVisible = false;
        let _xrSingleItem = (localStorage.getItem('bl-xr-view') || 'single') === 'single';

        let MENU = [], N = 0;
        const mod = i => ((i % N) + N) % N;
        let currentCenterMenu = 0;
        let slotOf     = { left: 0, center: 1, right: 2, hidden: 3 };
        let menuOf     = [0, 0, 0, 0];
        let hiddenSide = 'farRight';
        const meshObjs   = [null, null, null, null];
        const modelGLTFs = {};
        let loader;
        let labelMesh = null, labelCanvas = null, labelCtx = null, labelTexture = null;
        let labelMode = localStorage.getItem('bl-xr-label') || 'float';

        const CFG = {
            farLeft:  { x: -0.35, z: -0.12, s: 0.85, opacity: 0    },
            left:     { x: -0.14, z: -0.08, s: 0.85, opacity: 0.65 },
            center:   { x:  0,    z:  0,    s: 1.0,  opacity: 1.0  },
            right:    { x:  0.14, z: -0.08, s: 0.85, opacity: 0.65 },
            farRight: { x:  0.35, z: -0.12, s: 0.85, opacity: 0    },
        };
        // Returns target opacity for a role based on current view mode
        const _roleOp = role => _xrSingleItem ? (role === 'center' ? 1.0 : 0) : CFG[role].opacity;

        const INIT_ROLES    = ['left', 'center', 'right', 'farRight'];
        const DUR           = 350;
        const ROTATE_SCALE  = 0.0125;
        const INERTIA_DAMP  = 0.88;
        let   _rotVelocity  = 0;
        const SCALE_MIN     = 0.2;
        const SCALE_MAX     = 4.0;
        const DEAD_ZONE     = 3;
        const MAX_DELTA     = 40;
        const activeTouches = new Map();
        let _pinchDist0 = null, _pinchScale0 = null, _scaleHideTimer = null;
        let _xrUIHidden = false;
        let _lastTouchStart = null;
        const _LOG_MIN = Math.log(SCALE_MIN), _LOG_MAX = Math.log(SCALE_MAX);
        function _showScaleGauge() {
            if (_xrUIHidden) return;
            const s = carouselRoot.scale.x;
            const fill = (Math.log(s) - _LOG_MIN) / (_LOG_MAX - _LOG_MIN) * 100;
            document.getElementById('xr-scale-fill').style.width = fill.toFixed(1) + '%';
            document.getElementById('xr-scale-pct').textContent  = Math.round(s * 100) + '%';
            document.getElementById('xr-scale-gauge').style.display = 'block';
            if (_scaleHideTimer) { clearTimeout(_scaleHideTimer); _scaleHideTimer = null; }
        }
        function _hideScaleGauge(delay) {
            if (_scaleHideTimer) clearTimeout(_scaleHideTimer);
            _scaleHideTimer = setTimeout(() => {
                document.getElementById('xr-scale-gauge').style.display = 'none';
                _scaleHideTimer = null;
            }, delay);
        }

        // ── AR label (museum card) ────────────────────────────────────
        function _rrPath(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arcTo(x + w, y,     x + w, y + r,     r);
            ctx.lineTo(x + w, y + h - r);
            ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h);
            ctx.arcTo(x,     y + h, x,         y + h - r, r);
            ctx.lineTo(x, y + r);
            ctx.arcTo(x,     y,     x + r,     y,         r);
            ctx.closePath();
        }

        function _wrapText(ctx, text, x, y, maxW, lh, maxLines) {
            const words = text.split(' ');
            let line = '', count = 0;
            for (const word of words) {
                const test = line ? line + ' ' + word : word;
                if (ctx.measureText(test).width > maxW && line) {
                    ctx.fillText(line, x, y + count * lh);
                    if (++count >= maxLines) return;
                    line = word;
                } else { line = test; }
            }
            if (line) ctx.fillText(line, x, y + count * lh);
        }

        // Card geometry. LABEL_H is the height of a card whose name fits one line;
        // a name that wraps makes the card taller, nothing else moves.
        const LABEL_W = 512, LABEL_H = 210, LABEL_PLANE_W = 0.15;
        const TITLE_MAX = 44, TITLE_MIN = 24, TITLE_LINES = 3, DESC_LH = 28;

        // Break `text` into as many lines as it needs at the ctx's current font.
        function _labelLines(ctx, text, maxW) {
            const lines = [];
            let line = '';
            for (const word of String(text).split(/\s+/)) {
                if (!word) continue;
                const test = line ? line + ' ' + word : word;
                if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; }
                else line = test;
            }
            if (line) lines.push(line);
            return lines;
        }

        function _ellipsize(ctx, text, maxW) {
            let s = String(text);
            while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
            return s.replace(/[\s,.:;/-]+$/, '') + '…';
        }

        // Largest title size whose name fits in TITLE_LINES lines.
        // fillText's maxWidth argument is deliberately not used anywhere here: it
        // squeezes the glyphs horizontally instead of scaling them, which is what
        // turned long names into an unreadable condensed smear in AR.
        function _fitLabelTitle(ctx, name, maxW) {
            let size = TITLE_MAX, lines;
            for (;;) {
                ctx.font = 'bold ' + size + 'px Arial, sans-serif';
                lines = _labelLines(ctx, name, maxW);
                if (lines.length <= TITLE_LINES || size <= TITLE_MIN) break;
                size -= 2;
            }
            // Past TITLE_MIN readability wins over completeness: clip the tail.
            if (lines.length > TITLE_LINES) {
                lines = lines.slice(0, TITLE_LINES);
                lines[TITLE_LINES - 1] = _ellipsize(ctx, lines[TITLE_LINES - 1], maxW);
            }
            // A single unbreakable token can still be wider than the card.
            lines = lines.map(l => ctx.measureText(l).width > maxW ? _ellipsize(ctx, l, maxW) : l);
            // A nameless item still gets a full-height card rather than a squashed one.
            if (!lines.length) lines = [''];
            return { size: size, lines: lines };
        }

        // The mesh is positioned by its centre in both label modes, so a taller card
        // simply grows evenly up and down — no anchor maths needed.
        //
        // The texture must be REPLACED, not just flagged dirty: three.js allocates a
        // canvas texture with immutable storage (texStorage2D) sized to the first
        // upload and afterwards only texSubImage2D's into it. Resizing the canvas
        // alone therefore paints a shorter card inside the taller card's old block
        // and leaves the previous dish's pixels visible around it.
        function _resizeLabel(H) {
            labelCanvas.height = H;   // note: this also resets the 2D context state
            if (labelTexture) {
                labelTexture.dispose();
                labelTexture = new THREE.CanvasTexture(labelCanvas);
            }
            if (!labelMesh) return;
            labelMesh.material.map = labelTexture;
            labelMesh.material.needsUpdate = true;
            labelMesh.geometry.dispose();
            labelMesh.geometry = new THREE.PlaneGeometry(LABEL_PLANE_W, LABEL_PLANE_W * H / LABEL_W);
        }

        function drawLabel(item) {
            if (!labelCtx) return;
            const ctx = labelCtx;
            const W = labelCanvas.width;
            const lang = window.__lang || 'en';
            const name = (lang === 'ka' && item.name_ka)        ? item.name_ka        : item.name;
            const desc = (lang === 'ka' && item.description_ka) ? item.description_ka : item.description;

            // The title is measured first: it decides how tall the card has to be.
            const fit      = _fitLabelTitle(ctx, name || '', W - 56);
            const titleLH  = Math.round(fit.size * 1.15);
            // 0.716 is Arial's cap height, so the gap above the first line stays 20px
            // whatever the size — at 44px this reproduces the original baseline of 52.
            const baseline = Math.round(20 + fit.size * 0.716);
            const dividerY = baseline + (fit.lines.length - 1) * titleLH + 14;
            const descY    = dividerY + 22;
            const H        = descY + 2 * DESC_LH + 66;
            if (labelCanvas.height !== H) _resizeLabel(H);

            ctx.clearRect(0, 0, W, H);

            ctx.fillStyle = 'rgba(8, 8, 8, 0.92)';
            _rrPath(ctx, 6, 6, W - 12, H - 12, 20);
            ctx.fill();

            ctx.strokeStyle = 'rgba(240, 192, 64, 0.7)';
            ctx.lineWidth = 3;
            _rrPath(ctx, 6, 6, W - 12, H - 12, 20);
            ctx.stroke();

            ctx.fillStyle = '#f0c040';
            ctx.font = 'bold ' + fit.size + 'px Arial, sans-serif';
            fit.lines.forEach(function (line, i) { ctx.fillText(line, 28, baseline + i * titleLH); });

            ctx.strokeStyle = 'rgba(240, 192, 64, 0.30)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(28, dividerY); ctx.lineTo(W - 28, dividerY); ctx.stroke();

            ctx.fillStyle = '#c0c0c0';
            ctx.font = '22px Arial, sans-serif';
            _wrapText(ctx, desc || '', 28, descY, W - 56, DESC_LH, 3);

            ctx.fillStyle = '#f0c040';
            ctx.font = 'bold 36px Arial, sans-serif';
            ctx.fillText(item.price, 28, H - 20);

            if (labelTexture) labelTexture.needsUpdate = true;
        }

        function createLabelMesh() {
            labelCanvas = document.createElement('canvas');
            labelCanvas.width = LABEL_W; labelCanvas.height = LABEL_H;
            labelCtx = labelCanvas.getContext('2d');
            labelTexture = new THREE.CanvasTexture(labelCanvas);
            const mat = new THREE.MeshBasicMaterial({
                map: labelTexture, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide
            });
            const planeH = LABEL_PLANE_W * LABEL_H / LABEL_W;
            labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_PLANE_W, planeH), mat);
            labelMesh.position.set(0, 0.22, 0.015);
            labelMesh.visible = false;
            carouselRoot.add(labelMesh);
        }

        function updateLabelTransform() {
            if (!labelMesh) return;
            if (labelMode === 'float') {
                labelMesh.position.set(0, 0.22, 0.015);
            }
            // surface rotation updated per-frame in render loop
            const btn = document.getElementById('xr-label-toggle');
            const u = UI[window.__lang || 'en'];
            if (btn) btn.textContent = labelMode === 'float' ? u.onTable : u.floating;
        }

        // ── Models ────────────────────────────────────────────────────
        function preloadModels() {
            const paths = [...new Set(MENU.filter(_isAREnabledMenuItem).map(m => _safeAssetUrl(m.model) || m.model).filter(Boolean))];
            return Promise.allSettled(paths.map(p => {
                if (modelGLTFs[p]) return Promise.resolve();
                if (_modelLoadPromises[p]) return _modelLoadPromises[p];
                _modelLoadPromises[p] = new Promise((res, rej) =>
                    loader.load(p, gltf => { modelGLTFs[p] = gltf; res(); }, undefined, rej)
                );
                return _modelLoadPromises[p];
            })).then(results => {
                const failed = results.filter(r => r.status === 'rejected');
                if (failed.length) console.warn('Model load failures:', failed.map(f => f.reason));
                return failed;
            });
        }

        function cloneModel(menuIdx) {
            const modelUrl = _safeAssetUrl(MENU[menuIdx].model) || MENU[menuIdx].model || 'food.glb';
            const gltf = modelGLTFs[modelUrl];
            if (!gltf) return null;
            const obj = gltf.scene.clone(true);
            obj.traverse(n => { if (n.isMesh && n.material) n.material = n.material.clone(); });
            return obj;
        }

        function setSlotModel(slotIdx, menuIdx) {
            const old = meshObjs[slotIdx];
            if (old) slotGroups[slotIdx].remove(old);
            const obj = cloneModel(menuIdx);
            if (obj) {
                // Trust the GLB's own scale (1 unit = 1 metre).
                // ar_scale is an optional per-item override (default 1.0 = no change).
                const arScale = MENU[menuIdx].ar_scale || 1.0;
                if (arScale !== 1.0) obj.scale.setScalar(arScale);
                // Seat the model: bottom of bounding box sits at y=0
                const seated = new THREE.Box3().setFromObject(obj);
                if (isFinite(seated.min.y)) obj.position.y = -seated.min.y;
                slotGroups[slotIdx].add(obj);
                meshObjs[slotIdx] = obj;
            }
        }

        function initSlots() {
            const c = currentCenterMenu;
            menuOf = [mod(c - 1), c, mod(c + 1), mod(c + 2)];
            for (let i = 0; i < 4; i++) setSlotModel(i, menuOf[i]);
            const opacities = [_roleOp('left'), _roleOp('center'), _roleOp('right'), 0];
            INIT_ROLES.forEach((role, i) => {
                slotGroups[i].position.x = CFG[role].x;
                slotGroups[i].position.z = CFG[role].z;
                slotGroups[i].scale.setScalar(CFG[role].s);
                slotGroups[i].rotation.set(0, 0, 0);
                setOpacity(i, opacities[i]);
            });
            _syncXRAddBtn();
        }

        // ── Opacity ───────────────────────────────────────────────────
        function setOpacity(idx, opacity) {
            const obj = meshObjs[idx];
            if (!obj) return;
            obj.traverse(n => {
                if (n.isMesh && n.material) {
                    n.material.transparent = opacity < 1.0;
                    n.material.opacity     = Math.max(0, Math.min(1, opacity));
                    n.material.needsUpdate = true;
                }
            });
        }

        function animOpacity(idx, from, to, dur) {
            const t0 = performance.now();
            (function tick(now) {
                const t = Math.min((now - t0) / dur, 1);
                const e = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
                setOpacity(idx, from + (to - from) * e);
                if (t < 1) requestAnimationFrame(tick);
            })(performance.now());
        }

        // ── Slot animation ────────────────────────────────────────────
        function snapSlot(idx, role) {
            slotGroups[idx].position.x = CFG[role].x;
            slotGroups[idx].position.z = CFG[role].z;
            slotGroups[idx].scale.setScalar(CFG[role].s);
        }

        function animSlot(idx, role, dur) {
            const x0 = slotGroups[idx].position.x, x1 = CFG[role].x;
            const z0 = slotGroups[idx].position.z, z1 = CFG[role].z;
            const s0 = slotGroups[idx].scale.x,    s1 = CFG[role].s;
            const t0 = performance.now();
            (function tick(now) {
                const t = Math.min((now - t0) / dur, 1);
                const e = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
                slotGroups[idx].position.x = x0 + (x1 - x0) * e;
                slotGroups[idx].position.z = z0 + (z1 - z0) * e;
                slotGroups[idx].scale.setScalar(s0 + (s1 - s0) * e);
                if (t < 1) requestAnimationFrame(tick);
            })(performance.now());
        }

        // ── Navigation ────────────────────────────────────────────────
        function goNext() {
            if (isAnimating) return;
            isAnimating = true;
            const { left: lIdx, center: cIdx, right: rIdx, hidden: hIdx } = slotOf;
            if (hiddenSide === 'farLeft') snapSlot(hIdx, 'farRight');
            menuOf[hIdx] = mod(menuOf[rIdx] + 1);
            setSlotModel(hIdx, menuOf[hIdx]); setOpacity(hIdx, 0);
            animSlot(lIdx, 'farLeft', DUR); animSlot(cIdx, 'left',  DUR);
            animSlot(rIdx, 'center',  DUR); animSlot(hIdx, 'right', DUR);
            animOpacity(lIdx, _roleOp('left'),    0,                DUR);
            animOpacity(cIdx, _roleOp('center'),  _roleOp('left'),  DUR);
            animOpacity(rIdx, _roleOp('right'),   _roleOp('center'), DUR);
            animOpacity(hIdx, 0,                  _roleOp('right'), DUR);
            setTimeout(() => {
                slotOf = { left: cIdx, center: rIdx, right: hIdx, hidden: lIdx };
                hiddenSide = 'farLeft'; currentCenterMenu = mod(currentCenterMenu + 1);
                isAnimating = false;
                if (labelMesh && labelMesh.visible) drawLabel(MENU[currentCenterMenu]);
                _syncXRAddBtn();
                const _nItem = MENU[currentCenterMenu];
                const _nIdx  = (_nItem && window.__menuItems) ? window.__menuItems.indexOf(_nItem) : -1;
                if (_nIdx >= 0) window._arViewedItems?.add(_nIdx);
                window.track?.('xr_nav', _nIdx >= 0 ? _nIdx : null, { direction: 'next' });
            }, DUR + 10);
        }

        function goPrev() {
            if (isAnimating) return;
            isAnimating = true;
            const { left: lIdx, center: cIdx, right: rIdx, hidden: hIdx } = slotOf;
            if (hiddenSide === 'farRight') snapSlot(hIdx, 'farLeft');
            menuOf[hIdx] = mod(menuOf[lIdx] - 1);
            setSlotModel(hIdx, menuOf[hIdx]); setOpacity(hIdx, 0);
            animSlot(rIdx, 'farRight', DUR); animSlot(cIdx, 'right', DUR);
            animSlot(lIdx, 'center',   DUR); animSlot(hIdx, 'left',  DUR);
            animOpacity(rIdx, _roleOp('right'),   0,                 DUR);
            animOpacity(cIdx, _roleOp('center'),  _roleOp('right'),  DUR);
            animOpacity(lIdx, _roleOp('left'),    _roleOp('center'), DUR);
            animOpacity(hIdx, 0,                  _roleOp('left'),   DUR);
            setTimeout(() => {
                slotOf = { left: hIdx, center: lIdx, right: cIdx, hidden: rIdx };
                hiddenSide = 'farRight'; currentCenterMenu = mod(currentCenterMenu - 1);
                isAnimating = false;
                if (labelMesh && labelMesh.visible) drawLabel(MENU[currentCenterMenu]);
                _syncXRAddBtn();
                const _pItem = MENU[currentCenterMenu];
                const _pIdx  = (_pItem && window.__menuItems) ? window.__menuItems.indexOf(_pItem) : -1;
                if (_pIdx >= 0) window._arViewedItems?.add(_pIdx);
                window.track?.('xr_nav', _pIdx >= 0 ? _pIdx : null, { direction: 'prev' });
            }, DUR + 10);
        }

        // ── Scan/tap hint state ───────────────────────────────────────
        function _updateScanHint(found) {
            const stepEl = document.getElementById('xr-hint-step');
            const mainEl = document.getElementById('xr-hint-main');
            if (!stepEl) return;
            const u = UI[window.__lang || 'en'];
            stepEl.textContent = found ? u.hintStep2 : u.hintStep1;
            mainEl.textContent = found ? u.hintTap   : u.hintScan;
        }

        // ── Add-btn basket state sync ─────────────────────────────────
        function _syncXRAddBtn() {
            const btn = document.getElementById('xr-add-btn');
            if (!btn || !window.__menuItems) return;
            const item = MENU.length ? MENU[currentCenterMenu] : null;
            const idx  = item ? window.__menuItems.indexOf(item) : -1;
            const inBasket = idx >= 0 && window._basket && window._basket.has(String(idx));
            btn.classList.toggle('in-basket', inBasket);
        }

        function _applyUIHidden(hidden) {
            _xrUIHidden = hidden;
            const u = UI[window.__lang || 'en'];
            const hideBtn = document.getElementById('xr-hide-ui');
            if (!hideBtn) return;
            // Hidden: collapse info clutter; keep exit, place-again, arrows, cart visible
            if (hidden) {
                document.getElementById('xr-move-hint').style.display      = 'none';
                document.getElementById('xr-carousel-toggle').style.display = 'none';
                document.getElementById('xr-label-toggle').style.display    = 'none';
                document.getElementById('xr-scale-gauge').style.display     = 'none';
                if (labelMesh) labelMesh.visible = false;
                hideBtn.textContent = u.showUI;
            } else {
                if (placed) {
                    document.getElementById('xr-move-hint').style.display      = 'block';
                    document.getElementById('xr-carousel-toggle').style.display = 'block';
                    document.getElementById('xr-label-toggle').style.display    = 'block';
                    if (labelMesh) { drawLabel(MENU[currentCenterMenu]); updateLabelTransform(); labelMesh.visible = true; }
                }
                hideBtn.textContent = u.hideUI;
            }
        }

        // ── Placement ─────────────────────────────────────────────────
        function onSelect() {
            if (_ignoreNextSelect) { _ignoreNextSelect = false; return; }
            if (placed || !reticle.visible) return;
            carouselRoot.position.setFromMatrixPosition(reticle.matrix);
            carouselRoot.quaternion.setFromRotationMatrix(reticle.matrix);
            carouselRoot.visible = true;
            reticle.visible      = false;
            placed               = true;
            const _plItem = MENU[currentCenterMenu];
            const _plIdx  = (_plItem && window.__menuItems) ? window.__menuItems.indexOf(_plItem) : -1;
            window.track?.('ar_placed', _plIdx >= 0 ? _plIdx : null);
            gestureLayer.style.display = 'block';
            document.getElementById('xr-place-hint').style.display      = 'none';
            document.getElementById('xr-place-again').style.display     = 'block';
            document.getElementById('xr-nav-row').style.display          = 'flex';
            document.getElementById('xr-move-hint').style.display        = 'block';
            document.getElementById('xr-carousel-toggle').style.display  = 'block';
            if (labelMesh) { drawLabel(MENU[currentCenterMenu]); updateLabelTransform(); labelMesh.visible = true; }
            document.getElementById('xr-label-toggle').style.display = 'block';
            const _hBtn = document.getElementById('xr-hide-ui');
            _hBtn.textContent = UI[window.__lang || 'en'].hideUI;
        }

        function _resetPlacement() {
            _ignoreNextSelect = true;
            placed = false;
            carouselRoot.scale.setScalar(1);
            _pinchDist0 = null; _pinchScale0 = null;
            if (_scaleHideTimer) { clearTimeout(_scaleHideTimer); _scaleHideTimer = null; }
            document.getElementById('xr-scale-gauge').style.display = 'none';
            carouselRoot.visible = false;
            reticle.visible = false;
            gestureLayer.style.display = 'none';
            document.getElementById('xr-place-hint').style.display      = '';
            _reticleWasVisible = false; _updateScanHint(false);
            document.getElementById('xr-place-again').style.display     = 'none';
            document.getElementById('xr-nav-row').style.display          = 'none';
            document.getElementById('xr-move-hint').style.display        = 'none';
            document.getElementById('xr-carousel-toggle').style.display  = 'none';
            document.getElementById('xr-label-toggle').style.display     = 'none';
            if (labelMesh) labelMesh.visible = false;
            _xrUIHidden = false;
            _lastTouchStart = null;
            const _hBtnR = document.getElementById('xr-hide-ui');
            _hBtnR.classList.remove('ui-hidden');
            _hBtnR.textContent = UI[window.__lang || 'en'].hideUI;
        }

        // ── Loader bootstrap (shared between bg preload and _setup) ───
        let _setupDone = false;
        let _loaderPromise = null;
        const _modelLoadPromises = {};

        async function _ensureLoader() {
            if (loader) return;
            if (!_loaderPromise) {
                _loaderPromise = Promise.all([
                    import('https://esm.sh/three@0.155.0'),
                    import('https://esm.sh/three@0.155.0/examples/jsm/loaders/GLTFLoader'),
                    import('https://esm.sh/three@0.155.0/examples/jsm/exporters/GLTFExporter'),
                    import('https://esm.sh/three@0.155.0/examples/jsm/loaders/DRACOLoader'),
                ]);
            }
            const [threeNS, loaderMod, exporterMod, dracoMod] = await _loaderPromise;
            if (loader) return; // concurrent call already finished
            THREE        = threeNS;
            GLTFLoader   = loaderMod.GLTFLoader;
            GLTFExporter = exporterMod.GLTFExporter;
            loader       = new GLTFLoader();
            // Draco support for the WebXR carousel. model-viewer (3D modal + thumbnails)
            // bundles its own Draco decoder, but this Three.js path never did — that's
            // why Draco GLBs broke in AR before. The decoder is fetched lazily (only when
            // a model actually uses Draco) so non-Draco models pay nothing, and the SW
            // caches it after first use.
            const draco = new dracoMod.DRACOLoader();
            draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
            draco.setDecoderConfig({ type: 'wasm' });
            loader.setDRACOLoader(draco);
        }

        // ── iOS y-offset correction ───────────────────────────────────────────
        // Quick Look places the GLB's raw origin on the detected surface.
        // Most 3D tools export with origin at the model centre, so half the model
        // sinks below the table.  After backgroundPreload decodes every GLB with
        // Three.js we re-export a seated version (same fix as Android's setSlotModel)
        // and swap the launcher's src to the corrected blob.
        const _iosSeatedBlobs = {};
        let _resolvePreload;
        const _preloadDone = new Promise(res => { _resolvePreload = res; });

        async function _makeSeatedBlob(modelUrl, arScale) {
            const safeModelUrl = _safeAssetUrl(modelUrl) || modelUrl;
            const gltf = modelGLTFs[safeModelUrl];
            if (!gltf || !GLTFExporter) return null;
            const scale    = arScale || 1.0;
            const cacheKey = scale !== 1.0 ? `${safeModelUrl}::${scale}` : safeModelUrl;
            if (_iosSeatedBlobs[cacheKey]) return _iosSeatedBlobs[cacheKey];
            // Clone, apply ar_scale, seat so bottom sits at y=0
            const root = gltf.scene.clone(true);
            root.traverse(n => { if (n.isMesh && n.material) n.material = n.material.clone(); });
            if (scale !== 1.0) root.scale.setScalar(scale);
            root.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(root);
            if (isFinite(box.min.y) && box.min.y < -0.001) {
                root.position.y = -box.min.y;
                root.updateMatrixWorld(true);
            }
            return new Promise(resolve => {
                try {
                    new GLTFExporter().parse(
                        root,
                        glb => {
                            const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
                            _iosSeatedBlobs[cacheKey] = url;
                            resolve(url);
                        },
                        err => { console.warn('iOS seat export:', err); resolve(null); },
                        { binary: true }
                    );
                } catch (e) { console.warn('iOS seat export:', e); resolve(null); }
            });
        }

        // ── One-time init — deferred until first AR tap ───────────────
        async function _setup() {
            if (_setupDone) return;
            _setupDone = true;

            await _ensureLoader();

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.xr.enabled = true;
            renderer.xr.setReferenceSpaceType('local');
            xrCanvas = renderer.domElement;
            Object.assign(xrCanvas.style, {
                position: 'fixed', top: '0', left: '0',
                zIndex: '50', display: 'none'
            });
            document.body.appendChild(xrCanvas);

            scene  = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
            scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
            const dirLight = new THREE.DirectionalLight(0xffffff, 1);
            dirLight.position.set(0.5, 1, 0.25);
            scene.add(dirLight);

            reticle = new THREE.Mesh(
                new THREE.RingGeometry(0.04, 0.07, 32),
                new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
            );
            reticle.rotation.x       = -Math.PI / 2;
            reticle.matrixAutoUpdate = false;
            reticle.visible          = false;
            scene.add(reticle);

            carouselRoot = new THREE.Group();
            scene.add(carouselRoot);
            carouselRoot.visible = false;
            slotGroups = Array.from({ length: 4 }, () => {
                const g = new THREE.Group(); carouselRoot.add(g); return g;
            });
            createLabelMesh();

            gestureLayer = document.getElementById('xr-gesture-layer');
            xrOverlay    = document.getElementById('xr-overlay');

            // Touch gestures on the gesture layer inside dom-overlay.
            // Canvas touch events are consumed by the XR runtime during a session;
            // dom-overlay elements receive normal HTML touch events instead.
            gestureLayer.addEventListener('touchstart', e => {
                _rotVelocity = 0;
                for (const t of e.changedTouches)
                    activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY, prevX: t.clientX, prevY: t.clientY });
                if (activeTouches.size === 1) {
                    const t = e.changedTouches[0];
                    _lastTouchStart = { x: t.clientX, y: t.clientY };
                } else {
                    _lastTouchStart = null;
                }
                if (activeTouches.size >= 2) {
                    const [a, b] = [...activeTouches.values()];
                    _pinchDist0  = Math.hypot(a.x - b.x, a.y - b.y);
                    _pinchScale0 = carouselRoot.scale.x;
                }
            }, { passive: true });

            gestureLayer.addEventListener('touchmove', e => {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    const p = activeTouches.get(t.identifier);
                    if (p) activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY, prevX: p.x, prevY: p.y });
                }
                const all = [...activeTouches.values()];
                if (all.length === 1) {
                    let dx = all[0].x - all[0].prevX;
                    if (Math.abs(dx) < DEAD_ZONE) return;
                    dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dx));
                    _rotVelocity = dx * ROTATE_SCALE;
                    slotGroups[slotOf.center].rotation.y += _rotVelocity;
                } else if (all.length >= 2 && _pinchDist0) {
                    const [a, b] = all;
                    const dist = Math.hypot(a.x - b.x, a.y - b.y);
                    const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, _pinchScale0 * (dist / _pinchDist0)));
                    carouselRoot.scale.setScalar(s);
                    _showScaleGauge();
                }
            }, { passive: false });

            gestureLayer.addEventListener('touchend', e => {
                for (const t of e.changedTouches) {
                    if (_xrUIHidden && placed && _lastTouchStart && activeTouches.size === 1) {
                        const dx = t.clientX - _lastTouchStart.x;
                        const dy = t.clientY - _lastTouchStart.y;
                        if (Math.hypot(dx, dy) < 10) _applyUIHidden(false);
                    }
                    activeTouches.delete(t.identifier);
                }
                if (activeTouches.size < 2) {
                    _pinchDist0 = null; _pinchScale0 = null;
                    _lastTouchStart = null;
                    _hideScaleGauge(1200);
                }
            }, { passive: true });

            renderer.xr.addEventListener('sessionstart', async () => {
                _reticleWasVisible = false;
                _updateScanHint(false);
                const _hBtnStart = document.getElementById('xr-hide-ui');
                if (_hBtnStart) _hBtnStart.textContent = UI[window.__lang || 'en'].hideUI;
                try {
                    const session     = renderer.xr.getSession();
                    const viewerSpace = await session.requestReferenceSpace('viewer');
                    hitTestSource     = await session.requestHitTestSource({ space: viewerSpace });
                } catch (e) { console.error('Hit-test setup failed:', e); }
            });

            renderer.xr.addEventListener('sessionend', () => {
                hitTestSource = null; placed = false; _reticleWasVisible = false;
                xrSession = null; xrStarting = false;
                carouselRoot.visible = false; reticle.visible = false;
                if (labelMesh) labelMesh.visible = false;
                xrCanvas.style.display       = 'none';
                xrOverlay.style.display      = 'none';
                gestureLayer.style.display   = 'none';
                document.getElementById('xr-place-hint').style.display     = 'block';
                document.getElementById('xr-nav-row').style.display         = 'none';
                document.getElementById('xr-move-hint').style.display       = 'none';
                document.getElementById('xr-carousel-toggle').style.display = 'none';
                document.getElementById('xr-label-toggle').style.display    = 'none';
                _xrUIHidden = false;
                _lastTouchStart = null;
                const _hBtnS = document.getElementById('xr-hide-ui');
                _hBtnS.classList.remove('ui-hidden');
                activeTouches.clear();
                _rotVelocity = 0;
                _xrAddedKeys.clear();
                _pinchDist0 = null; _pinchScale0 = null;
                if (_scaleHideTimer) { clearTimeout(_scaleHideTimer); _scaleHideTimer = null; }
                document.getElementById('xr-scale-gauge').style.display = 'none';
                carouselRoot.scale.setScalar(1);
                slotOf = { left: 0, center: 1, right: 2, hidden: 3 };
                hiddenSide = 'farRight'; isAnimating = false;
                initSlots();
                document.dispatchEvent(new CustomEvent('xr-session-end'));
            });

            renderer.setAnimationLoop((time, frame) => {
                if (frame && !placed && hitTestSource) {
                    const refSpace = renderer.xr.getReferenceSpace();
                    if (refSpace) {
                        const results = frame.getHitTestResults(hitTestSource);
                        if (results.length > 0) {
                            const pose = results[0].getPose(refSpace);
                            if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
                        } else { reticle.visible = false; }
                    }
                }
                const _rvNow = !placed && reticle.visible;
                if (_rvNow !== _reticleWasVisible) { _reticleWasVisible = _rvNow; _updateScanHint(_rvNow); }
                if (placed && Math.abs(_rotVelocity) > 0.0001) {
                    slotGroups[slotOf.center].rotation.y += _rotVelocity;
                    _rotVelocity *= INERTIA_DAMP;
                }
                // Always sync label scale regardless of visibility
                if (labelMesh) {
                    const _cs = carouselRoot.scale.x;
                    labelMesh.scale.setScalar(_cs < 1 ? 1 / _cs : 1);
                }
                if (labelMesh && labelMesh.visible) {
                    const _cs = carouselRoot.scale.x;
                    if (_cs < 1) {
                        labelMesh.position.set(0, 0.22 / _cs, 0.015 / _cs);
                    } else {
                        labelMesh.position.set(0, 0.22, 0.015);
                    }
                    const _camPos = new THREE.Vector3();
                    camera.getWorldPosition(_camPos);
                    if (labelMode === 'float') {
                        const _mPos = new THREE.Vector3();
                        labelMesh.getWorldPosition(_mPos);
                        labelMesh.lookAt(new THREE.Vector3(_camPos.x, _mPos.y, _camPos.z));
                    } else {
                        const _rPos = new THREE.Vector3();
                        carouselRoot.getWorldPosition(_rPos);
                        const _ang = Math.atan2(_camPos.x - _rPos.x, _camPos.z - _rPos.z);
                        const _r = 0.223, _h = 0.004;
                        const _lp = new THREE.Vector3(
                            _rPos.x + Math.sin(_ang) * _r,
                            _rPos.y + _h,
                            _rPos.z + Math.cos(_ang) * _r
                        );
                        carouselRoot.worldToLocal(_lp);
                        labelMesh.position.copy(_lp);
                        // flatten first (Rx -90°), then spin around WORLD Y — quaternion
                        // composition avoids Euler-order tilt on second axis
                        const _qFl = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -Math.PI/2);
                        const _qYw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), _ang);
                        const _wQ  = _qYw.clone().multiply(_qFl);
                        const _pQ  = new THREE.Quaternion();
                        carouselRoot.getWorldQuaternion(_pQ);
                        labelMesh.quaternion.multiplyQuaternions(_pQ.clone().invert(), _wQ);
                    }
                }
                renderer.render(scene, camera);
            });

            document.getElementById('xr-exit').addEventListener('click', () => xrSession?.end());
            document.getElementById('xr-place-again').addEventListener('click', _resetPlacement);
            document.getElementById('xr-prev').addEventListener('click', goPrev);
            document.getElementById('xr-next').addEventListener('click', goNext);
            document.getElementById('xr-label-toggle').addEventListener('click', () => {
                labelMode = labelMode === 'float' ? 'surface' : 'float';
                localStorage.setItem('bl-xr-label', labelMode);
                updateLabelTransform();
            });
            document.getElementById('xr-hide-ui').addEventListener('click', () => _applyUIHidden(!_xrUIHidden));

            function updateXRToggleBtn() {
    const u = UI[window.__lang || 'en'];
    document.getElementById('xr-carousel-toggle').textContent =
        _xrSingleItem ? u.carouselBtn : u.singleBtn;
}
            updateXRToggleBtn();
            updateLabelTransform();

            document.getElementById('xr-carousel-toggle').addEventListener('click', () => {
                _xrSingleItem = !_xrSingleItem;
                localStorage.setItem('bl-xr-view', _xrSingleItem ? 'single' : 'multi');
                updateXRToggleBtn();
                const { left: lIdx, right: rIdx } = slotOf;
                const from = _xrSingleItem ? CFG.left.opacity : 0;
                const to   = _xrSingleItem ? 0 : CFG.left.opacity;
                animOpacity(lIdx, from, to, DUR);
                animOpacity(rIdx, from, to, DUR);
            });
        }

        // ── Public API ────────────────────────────────────────────────
        window.XR = {
            getCurrentItem() { return MENU.length ? MENU[currentCenterMenu] : null; },
            isUIHidden() { return _xrUIHidden; },
            refreshHint() { if (_setupDone) _updateScanHint(_reticleWasVisible); },
            _preloadDone,
            getSeatedBlob: _makeSeatedBlob,
            // Called right after menu renders — imports Three.js + decodes all models
            // in the background so the first AR tap finds everything ready.
            async backgroundPreload(items) {
                MENU = items; N = MENU.length;
                try {
                    await _ensureLoader();
                    await preloadModels();
                } catch (e) { console.warn('XR bg preload:', e); } finally {
                    _resolvePreload?.();
                }
            },
            async start(itemIndex, items) {
                if (xrStarting || xrSession) return;
                xrStarting = true;

                MENU = items; N = MENU.length;
                currentCenterMenu = Math.max(0, Math.min(itemIndex, N - 1));

                try {
                    await _setup();
                    await preloadModels();
                    const activeModel = _safeAssetUrl(MENU[currentCenterMenu]?.model) || MENU[currentCenterMenu]?.model;
                    if (!activeModel || !modelGLTFs[activeModel]) {
                        throw new Error('model-load-failed');
                    }
                } catch (e) {
                    xrStarting = false;
                    throw e;
                }

                initSlots();

                let _xrReq;
                try {
                    _xrReq = navigator.xr.requestSession('immersive-ar', {
                        requiredFeatures: ['hit-test'],
                        optionalFeatures: ['dom-overlay'],
                        domOverlay: { root: xrOverlay }
                    });
                    // ARCore needs recovery time after a previous session ends.
                    // requestSession can hang indefinitely — race it against an 8s timeout.
                    const _xrTimeout = new Promise((_, rej) =>
                        setTimeout(() => rej(new Error('xr-timeout')), 8000)
                    );
                    xrSession = await Promise.race([_xrReq, _xrTimeout]);
                } catch (e) {
                    console.error('XR session failed:', e);
                    // If the timed-out requestSession eventually resolves, end the ghost session.
                    if (_xrReq) _xrReq.then(s => s.end()).catch(() => {});
                    // Clear cache so next page load re-runs detection fresh
                    localStorage.removeItem('bl-ar-cap');
                    localStorage.removeItem('bl-ar-cap-ts');
                    xrStarting = false;
                    document.dispatchEvent(new CustomEvent('xr-session-end', {
                        detail: { fallbackIdx: itemIndex, message: 'Could not start AR. Showing the 3D model instead.' }
                    }));
                    return;
                }

                xrSession.addEventListener('select', onSelect);
                await renderer.xr.setSession(xrSession);
                localStorage.setItem('bl-ar-cap', 'webxr');
                localStorage.setItem('bl-ar-cap-ts', String(Date.now()));
                xrCanvas.style.display  = 'block';
                xrOverlay.style.display = 'block';
                document.dispatchEvent(new CustomEvent('xr-session-start'));
            }
        };
;
// shim.js — everything the ported viewer expects from the app it was lifted out of.
//
// `viewer.js` and `xr.js` are VERBATIM from the live platform's index.html. They are not
// edited, because the whole point of taking them is that they already work on real phones
// in real restaurants. What they need from around them is small and listed here, and this
// file is the only place our menu and their code meet.
//
// Nine symbols, and each stub says honestly what it is:
//
//   menuItems              built from the page's own cards, in their item shape
//   _themeConfig           carries per-item camera angles, same key format
//   UI / window.__lang     the English strings the viewer shows
//   track                  analytics. A no-op HERE, with a queue, because the menu has
//                          no analytics yet and a silent drop would be a lie
//   idle                   requestIdleCallback with a setTimeout fallback
//   _trackFirstInteraction the funnel marker. No-op for the same reason as track
//   addToBasket / _setQty / _syncQtyCtrl / _basketKey / _basket
//                          the basket. There ISN'T one in the self-serve menu yet, so
//                          these are stubs and the qty controls are hidden by CSS. When
//                          the basket is built, this is where it connects.

(function () {
  "use strict";

  // ── DOM the ported code wires up at top level ─────────────────────────────────
  // `viewer.js` binds its listeners as the script runs, not lazily. Any element it
  // expects and does not find is `null.addEventListener` - a TypeError that aborts the
  // REST of the block, leaving every `let` after it in the temporal dead zone. The
  // symptom is baffling: openModal exists (function declarations hoist) but throws
  // "Cannot access '_mvPromise' before initialization" when called.
  //
  // These nine are the photo LIGHTBOX - tap a photo-only dish to see it full size. We
  // have no item photos yet (`items.photo_key` exists and nothing writes to it), so the
  // feature has nothing to show and its markup was not ported. Stubs rather than edits
  // to viewer.js: when photos arrive, port the real markup and delete this list.
  ["img-lightbox", "lightbox-panel", "lightbox-img", "lightbox-name", "lightbox-desc",
   "lightbox-price", "lightbox-options", "lightbox-close", "lightbox-qty"
  //
  // The stubs need CHILDREN too, not just ids: the wiring reaches inside them, e.g.
  // `_lbQtyCtrl.querySelector('.qty-add-btn').addEventListener(...)`. An empty <div>
  // gets one line further and fails the same way.
  ].forEach(function (id) {
    if (document.getElementById(id)) return;
    const el = document.createElement("div");
    el.id = id;
    el.hidden = true;
    el.style.display = "none";
    if (id.endsWith("qty")) {
      ["qty-add-btn", "qty-dec", "qty-inc"].forEach(function (cls) {
        const b = document.createElement("button");
        b.className = cls;
        el.appendChild(b);
      });
    }
    document.body.appendChild(el);
  });

  window.__lang = "en";
  window.UI = {
    en: {
      view: "View 3D",
      view3D: "View 3D",
      viewAR: "View on your table",
      loading: "Loading...",
      onTable: "On your table",
      floating: "Floating",
      singleBtn: "One dish",
      carouselBtn: "All dishes",
      hideUI: "Hide controls",
      showUI: "Show controls",
      hintScan: "Move your phone slowly to find a surface",
      hintStep: "Point at your table",
      hintTap: "Tap to place",
      arNoModel: "This dish has no 3D model yet.",
      arNoUsdz: "AR is not ready for this dish yet.",
      arModelMissing: "The 3D model could not be loaded.",
      arFailed: "AR could not start on this device.",
      arUnsupported: "This device does not support AR.",
    },
  };

  // Analytics. The engine has a verdict log; the MENU has no event pipeline yet
  // (MENU-PLATFORM §2.5 - events go to an append-only sink, deliberately not built).
  // Queued rather than dropped so that when the sink exists, the calls are already in
  // the right places and nothing has to be re-instrumented.
  window.__events = [];
  window.track = function (event, itemIndex, extra) {
    window.__events.push({ event, itemIndex, extra, t: Date.now() });
  };
  window._trackFirstInteraction = function () {};

  window.idle = function (fn) {
    (window.requestIdleCallback || function (f) { return setTimeout(f, 1); })(fn);
  };

  // No basket in the self-serve menu yet. Stubs rather than deletions, so `viewer.js`
  // stays byte-identical to production and a future basket is a matter of filling these
  // in rather than re-porting.
  window._basket = new Map();
  window._basketKey = function (idx) { return String(idx); };
  window.addToBasket = function () {};
  window._setQty = function () {};
  window._syncQtyCtrl = function () {};

  // The platform's per-field translation picker, reproduced rather than stubbed because
  // it is on the render path for every dish name and description: t(item, 'name')
  // returns the _ka or _ru variant when one exists for the current language. The menu is
  // English-only today, so this is the fallback branch - but it is here in full so that
  // adding Georgian means putting name_ka on the item, exactly as production does it,
  // rather than discovering this function missing later.
  window._cleanText = window._cleanText || function (v) {
    return v == null ? "" : String(v).trim();
  };
  window.t = function (item, field) {
    const lang = window.__lang;
    if (lang === "ru" && item[field + "_ru"]) return _cleanText(item[field + "_ru"]);
    if (lang === "ka" && item[field + "_ka"]) return _cleanText(item[field + "_ka"]);
    return _cleanText(item[field]);
  };

  window._escapeHtml = window._escapeHtml || function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // Reproduced from the platform verbatim in behaviour: the modal price, with an
  // optional struck-through "was". Not a stub, because it is on the render path for
  // every dish in the 3D modal and returning nothing would leave the price blank.
  window._setPriceWithOld = function (el, price, priceOld) {
    if (!el) return;
    el.textContent = "";
    const was = _cleanText(priceOld);
    if (was) {
      const sp = document.createElement("span");
      sp.className = "price-was";
      sp.textContent = was;
      el.appendChild(sp);
    }
    el.appendChild(document.createTextNode(_cleanText(price)));
  };

  // Variants (sizes) and add-ons. A real platform feature that the self-serve schema has
  // no columns for yet - `items` has name, price, description and one model, and adding
  // variants is a migration plus admin UI, not a shim. Returning "" is exactly what the
  // platform's own functions do for an item without them, so the modal renders the same
  // way it does for a plain dish.
  window.__variantSel = {};
  window.__addonSel = {};
  window._variantIndex = function () { return 0; };
  window._variantsHtml = function () { return ""; };
  window._addonsHtml = function () { return ""; };

  // Per-item camera angle, in the platform's own key format so `_itemCameraOrbit` works
  // unmodified: theme_config["item_view_<id>"] = "h v zoom".
  window._themeConfig = {};

  /** Build the item list the viewer works on, out of the cards already in the page.
   *
   *  The snapshot is not re-parsed and nothing is fetched: every card already carries its
   *  model url, its usdz, its name and its camera angle, because the page was rendered
   *  complete (MENU-PLATFORM §2.1a). This just reads them back.
   */
  window.menuItems = [];
  function build() {
    const cards = [].slice.call(document.querySelectorAll(".menu-item[data-idx]"));
    window.menuItems = cards.map(function (el, i) {
      const d = el.dataset;
      if (d.orbit) window._themeConfig["item_view_" + i] = d.orbit;
      return {
        id: i,
        name: d.name || "",
        name_ka: "",
        description: d.desc || "",
        description_ka: "",
        price: d.price || "",
        // Their field names. `model` is the GLB a viewer loads, `usdz` is what Quick Look
        // gets. Both are already at real-world size - see viewer.mjs on why `ar_scale`
        // is 1 here and not a number somebody has to maintain.
        model: d.glb || "",
        model_url: d.glb || "",
        usdz: d.usdz || "",
        usdz_url: d.usdz || "",
        thumbnail_url: d.poster || "",
        ar_scale: 1,
        is_3d: !!d.glb,
        text_only: !d.glb,
      };
    });
    return window.menuItems;
  }

  window.__bootViewer = function () {
    build();
    if (typeof _startThumbUpgrades === "function") _startThumbUpgrades();
    // Preload the AR carousel's models in the background, exactly as the platform does
    // after its menu renders, so the first AR tap finds them decoded.
    const ar = window.menuItems.filter(function (i) { return i.is_3d; });
    if (ar.length && window.XR && window.XR.backgroundPreload) {
      window.idle(function () { window.XR.backgroundPreload(ar); });
    }
    // The platform binds the modal to the THUMBNAIL, not the card:
    //     thumbImg.addEventListener('click', () => openModal(globalIdx, menuItems))
    // ...and once a poster upgrades to a live <model-viewer>, `_upgradeThumb` puts its
    // own pointerdown/pointerup pair on the viewer so a DRAG rotates the dish and only a
    // real tap opens the modal. Binding the card instead - which an earlier version did -
    // fights that: every rotation ends in a click that bubbles, and the modal opens when
    // the diner was only turning the plate round.
    document.querySelectorAll(".thumb-img").forEach(function (img) {
      const idx = parseInt(img.dataset.globalIdx, 10);
      if (!(window.menuItems[idx] || {}).is_3d) return;
      img.addEventListener("click", function () { openModal(idx, window.menuItems); });
    });
    // The name and the price are not the plate, so tapping them is unambiguous and opens
    // the modal directly.
    document.querySelectorAll(".menu-item[data-idx]").forEach(function (el) {
      const idx = parseInt(el.dataset.idx, 10);
      if (!(window.menuItems[idx] || {}).is_3d) return;
      el.querySelectorAll(".item-name, .price").forEach(function (hit) {
        hit.style.cursor = "pointer";
        hit.addEventListener("click", function (ev) {
          ev.stopPropagation();
          openModal(idx, window.menuItems);
        });
      });
    });
    document.querySelectorAll(".ar-btn").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openAR(parseInt(b.dataset.idx, 10), window.menuItems);
      });
    });
    if (typeof setARButtonsState === "function") setARButtonsState(false);
  };
})();

;
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
;
// page.js — the menu page's own behaviour: category filtering and the language switch.
//
// NOT ported. `viewer.js` and `xr.js` are the platform's code because they are the part
// that already works on real phones and would be idiotic to rewrite. This is the other
// kind: UI glue that is a dozen lines when written against markup we control, and would
// be several hundred if lifted out of an app that also has a basket, three fixture
// loaders, drink categories and per-tenant special cases woven through the same
// functions.
//
// The behaviour it reproduces is the platform's, and two details are deliberate:
//
//   The 3D pill is a SENTINEL (`__ar3d`), not a category name, so a restaurant with a
//   real category called "3D" does not collide with it.
//
//   A 3D dish appears in BOTH the 3D pill and its own category. Temo chose that
//   explicitly after the platform's first version moved 3D items out of their categories
//   and diners could not find them any more.

(function () {
  "use strict";

  const $$ = (s) => [].slice.call(document.querySelectorAll(s));

  // ── categories ────────────────────────────────────────────────────
  function applyFilter(cat) {
    for (const card of $$(".menu-item")) {
      const mine = card.dataset.cat || "";
      const is3d = !!card.dataset.glb;
      card.hidden = !(cat === "" || (cat === "__ar3d" ? is3d : mine === cat));
    }
    // A section heading with nothing under it is worse than no heading, and the
    // platform's list has none - the cards carry their own category.
    const bar = document.getElementById("cat-filter");
    if (bar) {
      for (const p of bar.querySelectorAll(".cat-pill")) {
        p.classList.toggle("active", (p.dataset.cat || "") === cat);
      }
    }
  }

  function wireCategories() {
    const bar = document.getElementById("cat-filter");
    if (!bar) return;
    bar.addEventListener("click", (ev) => {
      const pill = ev.target.closest(".cat-pill");
      if (pill) applyFilter(pill.dataset.cat || "");
    });

    // The scroll arrows only mean anything when the pills actually overflow, which
    // depends on the phone, the language and how many categories a restaurant has -
    // so it is measured rather than assumed. Monday Greens has 26.
    const scroller = bar;
    const left = document.querySelector(".cat-nav-l");
    const right = document.querySelector(".cat-nav-r");
    const sync = () => {
      const over = scroller.scrollWidth > scroller.clientWidth + 4;
      if (left) left.hidden = !over || scroller.scrollLeft <= 2;
      if (right) {
        right.hidden =
          !over ||
          scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
      }
    };
    const nudge = (dir) =>
      scroller.scrollBy({ left: dir * scroller.clientWidth * 0.7, behavior: "smooth" });
    if (left) left.addEventListener("click", () => nudge(-1));
    if (right) right.addEventListener("click", () => nudge(1));
    scroller.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync);
    sync();
  }

  // ── language and theme ────────────────────────────────────────────
  // Every translation is already in the page - the card carries `data-name-ka` and the
  // server rendered the primary language into the text. Switching is a swap, not a
  // re-fetch and not a re-render: a diner changing language must not watch the menu
  // reload, which is the same principle as the whole no-flash design.
  const LABEL = { en: "EN", ka: "ქარ", ru: "RU" };

  function applyLang(lang, langs) {
    document.documentElement.lang = lang;
    window.__lang = lang;
    for (const card of $$(".menu-item")) {
      const el = card.querySelector(".item-name");
      if (!el) continue;
      const alt = card.dataset["name" + lang.charAt(0).toUpperCase() + lang.slice(1)];
      const wanted = lang === "en" ? card.dataset.name : alt || card.dataset.name;
      if (wanted && el.textContent !== wanted) el.textContent = wanted;
    }
    for (const p of $$(".cat-pill")) {
      if (!p.dataset.catEn) p.dataset.catEn = p.textContent;
      const ka = p.dataset.catKa;
      p.textContent = lang !== "en" && ka ? ka : p.dataset.catEn;
    }
    const btn = document.getElementById("lang-toggle");
    if (btn && langs.length > 1) {
      // The button always offers the OTHER language, so its label is never the one you
      // are already reading.
      const next = langs[(langs.indexOf(lang) + 1) % langs.length];
      btn.textContent = LABEL[next] || next.toUpperCase();
      btn.dataset.next = next;
    }
  }

  function wireLanguage() {
    const btn = document.getElementById("lang-toggle");
    if (!btn) return;
    const langs = (btn.dataset.langs || "en").split(",");
    applyLang(langs[0], langs);
    btn.addEventListener("click", () => applyLang(btn.dataset.next || langs[0], langs));
  }

  // Day/night. The platform stores the choice per visitor; the SERVER already rendered
  // the tenant's default into `data-theme`, so this only has to flip it.
  function wireTheme() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const root = document.documentElement;
    const sync = () => {
      const day = root.dataset.theme === "day";
      btn.textContent = day ? "Night" : "Day";
    };
    sync();
    btn.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "day" ? "night" : "day";
      sync();
    });
  }

  function start() {
    wireCategories();
    wireLanguage();
    wireTheme();
  }

  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
