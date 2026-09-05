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