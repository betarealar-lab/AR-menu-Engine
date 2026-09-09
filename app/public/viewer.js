/* ---- ui.js ---- */
// ui.js - the platform's UI strings, taken verbatim by extract_ui.py.
// Every key, en/ka/ru, exactly as index.html has them. DO NOT EDIT: re-run the
// extractor. A hand-maintained copy of this object is how the menu ended up
// showing the word "undefined" to Georgian diners.
//
// `window.UI` because that is what the ported viewer, the AR overlay and the
// basket all read - `UI[window.__lang].loading` and forty-one more.

window.UI = {
    en: {
        tagline:   'Taste the Wild',
        viewAR:    'VIEW ON TABLE',
        view3D:    'VIEW IN 3D',
        loading:   'Loading...',
        close:     'Close',
        tip:       'Drag to rotate',
        spin:      'Auto-spin',
        placeHint: 'Scan a well-lit, textured table slowly, then tap to place',
        moveHint:  'Drag to rotate · Pinch to scale',
        exitAR:    'Exit Model view',
        placeAgain:'Place Again',
        hintStep1: 'STEP 1 OF 2',
        hintScan:  'Slowly scan a well-lit, textured table',
        hintStep2: 'STEP 2 OF 2',
        hintTap:   'Tap to place your dish',
        coachScan:    'Find a table',
        coachScanSub: 'Move your phone slowly over a flat, textured table',
        coachFound:   'Surface Found!',
        coachFoundSub:'Ready to place your dish',
        langBtn:   'ქარ',
        themeDay:  'Day',
        themeNight:'Night',
        carouselBtn:  'CAROUSEL',
    singleBtn:    'SINGLE ITEM',
    onTable:      'ON TABLE',
    floating:     'FLOATING',
    addBtn:       'ADD',
    basketTitle:  'Basket',
    emptyBasket:  'Your basket is empty',
    total:        'Total',
    clearBasket:  'Clear',
    showWaiter:   'Show to staff',
    waiterHint:   'Staff scans this to get your order instantly',
    readyBtn:     '✓ Ready to Order',
    readyDone:    '✓ Order Noted!',
    hideUI:       'HIDE UI',
    showUI:       'SHOW UI',
    arNoUsdz:     'iPhone AR needs a USDZ model. Showing 3D instead.',
    arNoModel:    '3D model is not available for this item.',
    arModelMissing:'Could not load the 3D model. Showing 3D instead.',
    arFailed:     'Could not start AR. Showing 3D instead.',
    arUnsupported:'AR is not available on this device. Showing 3D instead.',
    },
    ka: {
        tagline:   'გასინჯე ველური გემო',
        viewAR:    'ᲛᲐᲒᲘᲓᲐᲖᲔ ᲜᲐᲮᲕᲐ',
        view3D:    '3D-ში ᲜᲐᲮᲕᲐ',
        loading:   'იტვირთება...',
        close:     'დახურვა',
        tip:       'გაასრიალეთ მოსაბრუნებლად',
        spin:      'ავტო-ტრიალი',
        placeHint: 'მიუშვირე კარგად განათებულ, ტექსტურიან ბრტყელ მაგიდას და ნელა ამოძრავე',
        moveHint:  'გასაბრუნებლად გაასრიალე · პინჩი მასშტაბისთვის',
        exitAR:    'მოდელის დახურვა',
        placeAgain:'ხელახლა დადება',
        hintStep1: 'ნაბიჯი 1 / 2',
        hintScan:  'ნელა დაასკანერე განათებული, ტექსტურიანი მაგიდა',
        hintStep2: 'ნაბიჯი 2 / 2',
        hintTap:   'შეეხე ეკრანს მოთავსებისთვის',
        coachScan:    'მაგიდის ძიება',
        coachScanSub: 'ნელა ამოძრავეთ ტელეფონი ტექსტურიან ბრტყელ მაგიდაზე',
        coachFound:   'ზედაპირი ნაპოვნია!',
        coachFoundSub:'მზადაა კერძის დასადებად',
        langBtn:   'RU',
        themeDay:  'ნათელი თემა',
        themeNight:'მუქი თემა',
        carouselBtn:  'კარუსელი',
    singleBtn:    'ცალი',
    onTable:      'მაგიდაზე ტექსტი ',
    floating:     'მოლივლივე ტექსტი',
    addBtn:       'დამატება',
    basketTitle:  'კალათა',
    emptyBasket:  'კალათა ცარიელია',
    total:        'სულ',
    clearBasket:  'გასუფთავება',
    showWaiter:   'აჩვენეთ სერვისის თანამშრომელს',
    waiterHint:   'სერვისის თანამშრომელი დაასკანერებს და მყისვე მიიღებს შენს შეკვეთას',
    readyBtn:     '✓ შეკვეთა მზადაა',
    readyDone:    '✓ მიღებულია!',
    hideUI:       'UI დამალვა',
    showUI:       'UI ჩვენება',
    arNoUsdz:     'iPhone-ზე AR-ს USDZ მოდელი სჭირდება. იხსნება 3D.',
    arNoModel:    'ამ ნივთისთვის 3D მოდელი არ არის.',
    arModelMissing:'3D მოდელი ვერ ჩაიტვირთა. იხსნება 3D.',
    arFailed:     'AR ვერ გაეშვა. იხსნება 3D.',
    arUnsupported:'ამ მოწყობილობაზე AR მიუწვდომელია. იხსნება 3D.',
    },
    ru: {
        tagline:   'Попробуй дикий вкус',
        viewAR:    'ПОКАЗАТЬ НА СТОЛЕ',
        view3D:    'СМОТРЕТЬ В 3D',
        loading:   'Загрузка...',
        close:     'Закрыть',
        tip:       'Проведите пальцем, чтобы повернуть',
        spin:      'Автовращение',
        placeHint: 'Наведите на хорошо освещённый стол с текстурой и медленно двигайте телефон',
        moveHint:  'Проведите пальцем — поворот · Сведите пальцы — масштаб',
        exitAR:    'Закрыть модель',
        placeAgain:'Разместить снова',
        hintStep1: 'ШАГ 1 ИЗ 2',
        hintScan:  'Медленно наведите на освещённый стол с текстурой',
        hintStep2: 'ШАГ 2 ИЗ 2',
        hintTap:   'Коснитесь экрана, чтобы разместить блюдо',
        coachScan:    'Найдите стол',
        coachScanSub: 'Медленно двигайте телефон над плоским столом с текстурой',
        coachFound:   'Поверхность найдена!',
        coachFoundSub:'Готово к размещению блюда',
        langBtn:   'EN',
        themeDay:  'Светлая тема',
        themeNight:'Тёмная тема',
        carouselBtn:  'КАРУСЕЛЬ',
        singleBtn:    'ОДНО БЛЮДО',
        onTable:      'НА СТОЛЕ',
        floating:     'В ВОЗДУХЕ',
        addBtn:       'ДОБАВИТЬ',
        basketTitle:  'Корзина',
        emptyBasket:  'Ваша корзина пуста',
        total:        'Итого',
        clearBasket:  'Очистить',
        showWaiter:   'Показать официанту',
        waiterHint:   'Официант отсканирует и сразу получит ваш заказ',
        readyBtn:     '✓ Заказ готов',
        readyDone:    '✓ Заказ принят!',
        hideUI:       'Скрыть интерфейс',
        showUI:       'Показать интерфейс',
        arNoUsdz:     'Для AR на iPhone нужна модель USDZ. Открываем 3D.',
        arNoModel:    'Для этого блюда 3D-модель недоступна.',
        arModelMissing:'Не удалось загрузить 3D-модель. Открываем 3D.',
        arFailed:     'Не удалось запустить AR. Открываем 3D.',
        arUnsupported:'AR недоступен на этом устройстве. Открываем 3D.',
    }
};

/* ---- xr.js ---- */
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
/* ---- shim.js ---- */
// shim.js — the ONLY adapter between the ported viewer and our page.
//
// `viewer.js`, `xr.js` and `hero.js` are VERBATIM from the live platform's index.html.
// They are not edited, because the whole point of taking them is that they already work on
// real phones in real restaurants. What they need from around them is listed here.
//
// **This file used to be where features went to die.** It contained:
//
//     window.addToBasket   = function () {};              // the basket
//     window._variantsHtml = function () { return ""; };  // glass / bottle
//
// ...and nine fake hidden <div>s wearing the photo lightbox's ids. Every one of those was
// written to stop `viewer.js` throwing, and every one of them silently deleted a feature.
// They are gone: the markup now comes from `chrome.html` and the behaviour from
// `platform.js`, both copied from the platform rather than invented here.
//
// The rule this file is now held to: **an adapter translates, it does not substitute.**
// Anything in here either renames one of our fields to one of theirs, or wires our page's
// own reality (an event sink, a table number, a config object) into a call they already
// make. If something starts returning "" or doing nothing, it does not belong here.

(function () {
  "use strict";

  // ── language ──────────────────────────────────────────────────────────────────────
  // The server rendered the restaurant's primary language into the markup, and it is on
  // the <html> element. Reading it back rather than defaulting to English means the first
  // frame and the first script agree - the platform's own version defaults to 'ka' and
  // then corrects itself, which is a flash.
  window.__lang = (document.documentElement.lang || "en").slice(0, 2);

  // `window.UI` comes from `ui.js`, extracted verbatim - all 42 strings in all three
  // languages. It used to be eleven English strings typed by hand here, which is how
  // Georgian diners were shown the word "undefined".

  // ── analytics ─────────────────────────────────────────────────────────────────────
  //
  // The viewer's own `track()` calls are unchanged and stay exactly where the platform put
  // them. Only the sink is ours.
  //
  // Names are TRANSLATED to our whitelist rather than passed through. The platform's
  // vocabulary grew over two years and has several spellings of the same idea; an open
  // name column becomes a junk drawer within a year and then no query can be trusted.
  // Anything unrecognised is counted locally and never sent.
  // **Every key on the left is a name the ported code actually calls.** The first version
  // of this map was written from the platform's vocabulary as I remembered it, and the
  // three that mattered most were not in it:
  //
  //     track('item_view', ...)   the 3D modal opening - the single number this company
  //                               is a bet on. Dropped. "Opened a dish in 3D" read 0.
  //     track('ar_tap', ...)      a diner asking for AR. Dropped.
  //     track('view')             never fired at all, because the platform fires it from
  //                               `buildMenu`, which we do not have. So the funnel's own
  //                               DENOMINATOR was zero while later stages were not - a
  //                               funnel that widens as it goes, which is impossible and
  //                               reads as broken to the one person paying for it.
  //
  // Anything unrecognised is counted locally and never sent, which is the right rule and
  // is exactly why the gap was silent. So `check_features.py` now reads every `track('x')`
  // out of the built bundle and fails if `x` is neither translated here nor named in
  // NOT_COUNTED below. The map cannot drift from the code again without going red.
  const EVENT_NAME = {
    view: "view", page_view: "view", page_load: "view", menu_view: "view",
    hero_pass: "hero_pass", scroll_past_hero: "hero_pass",
    category: "category", category_change: "category", category_filter: "category",
    // A dish opened in the 3D viewer, however it was reached. `ar_fallback` belongs here
    // and not under AR: it fires when AR could not start and the diner got the 3D modal
    // instead, so counting it as an AR open would inflate the number we most need honest.
    open_modal: "item_open", view_3d: "item_open", item_open: "item_open",
    item_view: "item_open", ar_fallback: "item_open",
    // Asked for AR, and AR actually started. Both are "reached AR" - the funnel counts
    // distinct sessions, so a diner who does both is one, not two.
    ar: "ar_open", ar_open: "ar_open", view_ar: "ar_open",
    ar_tap: "ar_open", ar_success: "ar_open",
    ar_placed: "ar_placed", ar_place: "ar_placed",
    // The funnel this company is a bet on: a dish added to the basket, and whether the
    // diner had seen it in 3D or in AR first.
    basket_add: "basket_add", basket_remove: "basket_remove",
    basket_open: "basket_open", basket_clear: "basket_clear",
    waiter_qr_shown: "waiter_qr",
    delivery: "delivery", order: "delivery",
    lang: "lang", theme: "theme", theme_change: "theme",
  };

  // Called by the ported code, and deliberately not sent. Named rather than ignored, so
  // that "we decided not to count this" and "we forgot this exists" stop looking alike.
  //
  //   modal_close   how long a dish was held open. Interesting later, and it would double
  //                 the rows in `events` to learn it. Not while the question is still
  //                 "does 3D sell food".
  //   ar_duration   the same argument, for AR.
  const NOT_COUNTED = ["modal_close", "ar_duration"];
  window.__notCounted = NOT_COUNTED;

  // Random, per tab, forgotten when it closes. Its only job is to tell one diner opening
  // four dishes apart from four diners opening one each. Deliberately sessionStorage and
  // not localStorage: a value that survives the tab is a value that follows somebody.
  function sessionId() {
    try {
      let id = sessionStorage.getItem("br_s");
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()))
          .replace(/-/g, "").slice(0, 24);
        sessionStorage.setItem("br_s", id);
      }
      return id;
    } catch (_) {
      // Private mode, or storage blocked. Still countable as one visit; just not
      // recognisable as the same one twice.
      return String(Date.now()) + String(Math.random()).slice(2, 8);
    }
  }

  const TENANT = (window.__CFG && window.__CFG.tenant_id) || "";

  // Which table this code was on. The per-table QR codes carry `?t=<n>`, and it is read
  // ONCE here rather than per event: a diner navigating within the menu keeps the same
  // table, and re-reading the URL would lose it the moment anything touched the query
  // string.
  const TABLE = (function () {
    try {
      const t = new URLSearchParams(location.search).get("t") || "";
      // Bounded and digits-only: it is printed on a card, not typed, so anything else is
      // somebody playing with the URL and does not belong in a restaurant's numbers.
      return /^\d{1,4}$/.test(t) ? t : "";
    } catch (_) { return ""; }
  })();

  // **The theme editor is not a diner.**
  //
  // The editor renders the real menu in an iframe at `/{slug}?preview`, and that page is
  // the real page: same markup, same viewer, same `__CFG.tenant_id`. So `init.js` fired
  // `track("view")` on every load and the count went into the restaurant's own analytics
  // - along with a `category` for every filter the owner clicked while choosing colours,
  // and a `hero_pass` every time click-to-edit scrolled the frame.
  //
  // `view` is the DENOMINATOR of the funnel. Inflating it does not add a visible spike;
  // it quietly drags every percentage underneath it down, so "13% of diners open a 3D
  // model" reads worse than the truth and the conclusion drawn from it is wrong in the
  // direction nobody checks.
  //
  // Read from the URL rather than passed in from the server, because that is the same
  // fact the page itself uses to decide it is a preview (`Astro.url.searchParams.has
  // ("preview")` in `[slug].astro`). One source, two readers, no way for them to drift.
  // A diner who types `?preview` on the end suppresses their own counts, which is
  // opting out, not poisoning.
  const PREVIEW = (function () {
    try { return new URLSearchParams(location.search).has("preview"); }
    catch (_) { return false; }
  })();

  let pending = [];
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending.length || !TENANT || PREVIEW) return;
    const body = JSON.stringify({
      tenant: TENANT, session: sessionId(), events: pending.splice(0, 50),
    });
    try {
      // sendBeacon survives the page being closed, which is exactly when the last and most
      // interesting events happen. `fetch` with keepalive is the fallback; a plain fetch
      // would be cancelled by the navigation that triggered it.
      if (!(navigator.sendBeacon && navigator.sendBeacon("/e", body))) {
        fetch("/e", { method: "POST", body, keepalive: true }).catch(function () {});
      }
    } catch (_) { /* never let a count break a menu */ }
  }

  window.__events = [];
  window.track = function (event, itemIndex, extra) {
    window.__events.push({ event, itemIndex, extra, t: Date.now() });
    const name = EVENT_NAME[event];
    // `window.__events` above still records everything: it is what `check_features.py`
    // reads and what makes a preview debuggable. Only the SINK is closed.
    if (!name || !TENANT || PREVIEW) return;

    // The viewer counts in its own array positions; the sink wants the dish's real id,
    // which the card already carries because the page was rendered complete.
    let item = "";
    const el = document.querySelector('.menu-item[data-idx="' + itemIndex + '"]');
    if (el && el.dataset && el.dataset.id) item = el.dataset.id;

    const meta = (extra && typeof extra === "object") ? Object.assign({}, extra) : {};
    if (TABLE) meta.t = TABLE;
    pending.push({ name: name, item: item, meta: meta });
    // Batched. One beacon per burst rather than one per tap: opening a dish fires three
    // events within a second and three requests to say so is three times the cost for the
    // same information.
    if (pending.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 4000);
  };

  // The last flush, and the one that matters most - a diner who reached AR and then closed
  // the tab is the whole funnel. `visibilitychange` fires where `unload` does not, which
  // is every iOS browser.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);

  // The platform's marker for "this visitor did something". Ours fires the one event it
  // is really for and then gets out of the way.
  let _interacted = false;
  window._trackFirstInteraction = function (type) {
    if (_interacted) return;
    _interacted = true;
    window.track("hero_pass", null, { via: type || "" });
  };

  window.idle = function (fn) {
    (window.requestIdleCallback || function (f) { return setTimeout(f, 1); })(fn);
  };

  // ── text helpers the render path calls for every dish ─────────────────────────────

  window._cleanText = window._cleanText || function (v) {
    return v == null ? "" : String(v).trim();
  };

  // The platform's per-field translation picker: t(item, 'name') returns the _ka or _ru
  // variant when one exists for the current language.
  window.t = function (item, field) {
    if (!item) return "";
    const lang = window.__lang;
    if (lang === "ru" && item[field + "_ru"]) return window._cleanText(item[field + "_ru"]);
    if (lang === "ka" && item[field + "_ka"]) return window._cleanText(item[field + "_ka"]);
    return window._cleanText(item[field]);
  };

  window._escapeHtml = window._escapeHtml || function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // theme_config stores lists as JSON strings - hero_images, drink_categories. Their
  // parser, verbatim, because a malformed value must yield an empty list rather than throw
  // and take the rest of the boot with it.
  window._parseConfigList = function (raw) {
    const t = String(raw || "").trim();
    if (!t) return [];
    try {
      const list = JSON.parse(t);
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  };

  // The modal price, with an optional struck-through "was".
  window._setPriceWithOld = function (el, price, priceOld) {
    if (!el) return;
    el.textContent = "";
    const was = window._cleanText(priceOld);
    if (was) {
      const sp = document.createElement("span");
      sp.className = "price-was";
      sp.textContent = was;
      el.appendChild(sp);
    }
    el.appendChild(document.createTextNode(window._cleanText(price)));
  };

  // Per-item camera angle, in the platform's own key format so `_itemCameraOrbit` works
  // unmodified: theme_config["item_view_<idx>"] = "h v zoom".
  window._themeConfig = window._themeConfig || {};

  /** Build the item list the viewer works on, out of the cards already in the page.
   *
   *  Nothing is fetched and the snapshot is not re-parsed: every card already carries its
   *  model url, its usdz, its name, its price and its camera angle, because the page was
   *  rendered complete. This reads them back.
   *
   *  The two exceptions are `variants` and `addons`. Those are structured data with prices
   *  in them - "Glass 16 ₾ / Bottle 70 ₾" - and reading prices back out of markup to then
   *  do arithmetic with them is the kind of shortcut that puts a wrong total in front of a
   *  paying customer. The server emits them as JSON in `window.__ITEMS`, keyed by index,
   *  for the ~18% of dishes that have any. Everything else stays in the markup, once.
   */
  window.menuItems = [];
  function build() {
    const extras = window.__ITEMS || {};
    const cards = [].slice.call(document.querySelectorAll(".menu-item[data-idx]"));
    const out = [];
    for (const el of cards) {
      const d = el.dataset;
      const i = parseInt(d.idx, 10);
      // The 3D pill renders a second card for the same dish, exactly as the platform does
      // (both carry the same index so the basket, AR and analytics treat them as one
      // item). Only the first one becomes an entry.
      if (out[i]) continue;
      // Keyed by the dish's REAL id, because `_itemCameraOrbit` looks up
      // `_themeConfig["item_view_" + item.id]`. Keyed by index it silently missed every
      // time and every model opened at the default angle.
      if (d.orbit && d.id) window._themeConfig["item_view_" + d.id] = d.orbit;
      const ex = extras[i] || extras[String(i)] || {};
      const desc = el.querySelector(".ingredients");
      out[i] = {
        // The dish's real id, for the staff QR and for the event sink. A position is
        // meaningless to both.
        id: d.id || "",
        name: d.name || "",
        name_ka: d.nameKa || "",
        name_ru: d.nameRu || "",
        description: desc ? desc.textContent.trim() : "",
        description_ka: "",
        price: d.price || "",
        price_old: d.priceOld || "",
        // Their field names. `model` is the GLB a viewer loads, `usdz` is what Quick Look
        // gets. Both are already at real-world size, which is why `ar_scale` is 1 for
        // anything from our pipeline and only an imported model carries a multiplier.
        model: d.glb || "",
        model_url: d.glb || "",
        usdz: d.usdz || "",
        usdz_url: d.usdz || "",
        thumbnail_url: d.poster || "",
        ar_scale: d.arScale ? parseFloat(d.arScale) : 1,
        // The card's own answer, not "does it have a GLB". See markup.js on `data-is3d`:
        // a dish can keep its model and still be a photo dish, and that is the owner's
        // call to make.
        is_3d: d.is3d === "1",
        text_only: el.classList.contains("no-image"),
        variants: ex.v || [],
        addons: ex.a || [],
      };
    }
    // A hole here would mean a card claimed an index no other card did, which cannot
    // happen from our renderer - but `menuItems[i]` is indexed by the whole viewer, so a
    // sparse array is worth collapsing loudly rather than carrying.
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = { id: "", name: "" };
    window.menuItems = out;
    return out;
  }

  window.__bootViewer = function () {
    build();
    // `viewer.js` keeps its OWN `let menuItems` at the top of the bundle's shared scope,
    // and uses it for `menuItems.indexOf(item)` when it reports which dish was viewed.
    // Left empty, every 3D and AR event was filed against index -1 - the counts existed
    // and were all wrong. Both names now point at one array.
    try { menuItems = window.menuItems; } catch (_) { /* viewer.js absent (tests) */ }

    if (typeof _startThumbUpgrades === "function") _startThumbUpgrades();
    // Preload the AR carousel's models in the background, exactly as the platform does
    // after its menu renders, so the first AR tap finds them decoded.
    const ar = window.menuItems.filter(function (i) { return i.is_3d; });
    if (ar.length && window.XR && window.XR.backgroundPreload) {
      window.idle(function () { window.XR.backgroundPreload(ar); });
    }
    // The modal is bound to the THUMBNAIL here rather than in the delegated card handler,
    // because once a poster upgrades to a live <model-viewer>, `_upgradeThumb` puts its own
    // pointerdown/pointerup pair on the viewer so a DRAG rotates the dish and only a real
    // tap opens the modal. A delegated click on the card would fight that: every rotation
    // ends in a click that bubbles, and the modal opens when the diner was only turning
    // the plate round.
    document.querySelectorAll(".thumb-img").forEach(function (img) {
      const idx = parseInt(img.dataset.globalIdx, 10);
      const item = window.menuItems[idx];
      if (!item) return;
      img.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (item.is_3d) openModal(idx, window.menuItems);
        else if (item.thumbnail_url) {
          openLightbox(item.thumbnail_url, window.t(item, "name"), item, idx);
        }
      });
    });
    // Every quantity control on the page starts in the right state - the basket survives a
    // filter change, and a diner who added two coffees and then tapped "Coffee" must still
    // see 2.
    document.querySelectorAll(".qty-ctrl[data-idx]").forEach(function (c) {
      if (typeof window._syncQtyCtrl === "function") window._syncQtyCtrl(c.dataset.idx);
    });
    if (typeof setARButtonsState === "function") setARButtonsState(false);
  };
})();

/* ---- platform.js ---- */
// platform.js — the features every menu has, whatever it looks like.
//
// **This file exists because I stubbed these instead of porting them.** `shim.js` used to
// contain:
//
//     window.addToBasket   = function () {};              // the basket
//     window._variantsHtml = function () { return ""; };  // glass / bottle
//
// ...plus nine fake hidden <div>s standing in for the photo lightbox. Those stubs let
// `viewer.js` boot without crashing, which is all they were written to do. They also
// removed half the product, and the page still looked plausible, so nothing caught it
// until Temo opened it on a phone in a restaurant:
//
//   > "this is not a copy of og monday greens it is something that tried to be a copy of a
//   >  copy and failed. and considering u have access to the files u should have done
//   >  better."
//
// He also drew the line this file is named after:
//
//   > "make sure to differentiate what are normal website features and what are template
//   >  additions, like add to cart, category sorted, 3d on top, 3d and AR view, show to
//   >  waiter, view the cart, these and some others are baisc features not template
//   >  specific."
//
// So: **platform features live here and every template gets them.** Add to cart, view the
// cart, show to waiter, variants, add-ons, the quantity stepper. A template changes the
// palette, the fonts, the hero and the card shape - it does not get to not have a basket.
// Nothing in this file reads `data-template`, and that is the point: there is no way for
// a template to switch a feature off, because there is no switch.
//
// (Category filtering, the 3D-first ordering, the theme switch and the language switch
// are the other platform features; they live in `page.js` because they are about the LIST
// rather than about a dish.)
//
// ── what is verbatim and what is adapted ─────────────────────────────────────────────
//
// The behaviour is the platform's, function for function, from `index.html`. Two things
// are genuinely different, and both are because our page is rendered on the SERVER:
//
//   1. **Wiring is delegated.** `renderMenuCard` attaches nine listeners to every card as
//      it builds it. Our cards are already in the HTML when this file runs, so there is
//      nothing to attach them during. One listener on `#menu-list` does the same job for
//      170 cards, and keeps working when the filter shows and hides them.
//
//   2. **Items come from `window.__ITEMS`.** Their `menuItems` array is what the fetch
//      returned. Ours is rebuilt from the cards (see `shim.js`), which carries everything
//      except variants and add-ons - those are structured data with prices in them and
//      cannot be read back out of markup honestly. So the server emits exactly those two
//      fields, for the ~18% of dishes that have them, and nothing else is duplicated.
//
// Three tenant special cases from the original are deliberately dropped: Mugsy's basket
// thumbnails, BAOMA's empty-basket suppression, and Burger Planet's three hardcoded
// delivery links. Each is one restaurant's arrangement, not a platform feature.

(function () {
  "use strict";

  // ── selections, shared with the lightbox and the modal ────────────────────────────
  // Kept on `window` because `viewer.js` reads them by those exact names. A diner who
  // picks "Bottle" on the card and then opens the dish sees Bottle selected there too;
  // that is one selection, stored once.
  window.__variantSel = window.__variantSel || {};
  window.__addonSel = window.__addonSel || {};

  // The basket. A Map keyed by `_basketKey` - not by item index - because one dish can be
  // in the basket twice with different sizes, and those are two lines, not one.
  window._basket = window._basket || new Map();

  // Which dishes this diner has already seen in 3D or in AR. `viewer.js` writes to them
  // and `addToBasket` reads them, because "did 3D make them order it" is the one number
  // this whole company is a bet on.
  window._arViewedItems = window._arViewedItems || new Set();
  window._modalViewedItems = window._modalViewedItems || new Set();
  window._xrAddedKeys = window._xrAddedKeys || new Set();

  const $ = (id) => document.getElementById(id);
  const esc = window._escapeHtml;

  // ── prices ────────────────────────────────────────────────────────────────────────
  // Their arithmetic, unchanged. Prices are free text on a menu ("16 / 70 ₾", "from 12"),
  // so the basket parses the digits out rather than assuming a number - and a line that
  // parses to nothing contributes nothing rather than NaN, which would poison the total.

  function _parsePrice(str) {
    return parseFloat(String(str).replace(/[^\d.]/g, "")) || 0;
  }
  function _fmtPrice(num) {
    const n = Math.round(num * 10) / 10;
    return n + " ₾";
  }
  // Unit price of a basket line = item price + any selected add-on prices.
  function _addonSum(entry) {
    const list = (entry.item && entry.item.addons) || [];
    return (entry.aIdx || []).reduce(
      (s, i) => s + _parsePrice(list[i] && list[i].price), 0);
  }
  // Base price = the chosen variant's price when the item has variants, otherwise the
  // item's own price. Add-on prices stack on top of either.
  function _lineBase(entry) {
    const item = entry.item;
    if (entry.vIdx != null && item.variants && item.variants[entry.vIdx]) {
      return _parsePrice(item.variants[entry.vIdx].price);
    }
    return _parsePrice(item.price);
  }
  function _lineUnit(entry) { return _lineBase(entry) + _addonSum(entry); }

  function _basketTotal() {
    let s = 0;
    window._basket.forEach((entry) => { s += _lineUnit(entry) * entry.qty; });
    return s;
  }
  function _basketCount() {
    let n = 0;
    window._basket.forEach(({ qty }) => { n += qty; });
    return n;
  }

  // Russian counts three ways and getting it wrong reads as a machine wrote the menu.
  function _ruPlural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ── the key ───────────────────────────────────────────────────────────────────────
  // "12", "12~v1", "12~v1#0,3". A dish, optionally a size, optionally a set of add-ons.
  // Sorted before joining so that picking bacon then cheese and cheese then bacon are the
  // same line rather than two.
  function _basketKey(globalIdx, vIdx, aIdxSorted) {
    let k = String(globalIdx);
    if (typeof vIdx === "number" && vIdx >= 0) k += "~v" + vIdx;
    if (aIdxSorted && aIdxSorted.length) k += "#" + aIdxSorted.join(",");
    return k;
  }

  // ── markup the modal and the lightbox ask for ─────────────────────────────────────
  // `viewer.js` calls all four of these while building its panels. They were the stubs
  // that returned "".

  // A saved customer choice wins; otherwise choose the first choice with a photo. That
  // prevents a pictureless first choice (for example Veggie) from becoming the default
  // card state when the available photo is Chicken.
  function _variantIndex(item, globalIdx) {
    const s = window.__variantSel[globalIdx];
    if (typeof s === "number" && item.variants && item.variants[s]) return s;
    const pictured = (item.variants || []).findIndex(
      (v) => v && v.image_url);
    return pictured >= 0 ? pictured : 0;
  }

  function _selectedVariantImage(item, globalIdx) {
    if (!item.variants || !item.variants.length) return "";
    const v = item.variants[_variantIndex(item, globalIdx)];
    return (v && v.image_url) || "";
  }

  function _choiceLabel(c, lang) {
    return (c && (c[lang] || c.en || c.ka)) || "";
  }

  // Single-select size/price pills (e.g. Glass / Bottle). Empty -> nothing shown.
  function _variantsHtml(item, globalIdx) {
    if (!item.variants || !item.variants.length) return "";
    const sel = _variantIndex(item, globalIdx);
    const rows = item.variants.map(function (v, i) {
      // Same rule as markup.js: the label is stored under its language code, so a
      // third language needs a key and not a code change.
      const n = esc(_choiceLabel(v, window.__lang));
      const p = esc(v.price || "");
      const on = i === sel;
      return `<button type="button" class="variant${on ? " selected" : ""}" data-vi="${i}"` +
        ` role="radio" aria-checked="${on}">` +
        `<span class="variant-name">${n}</span>` +
        `<span class="variant-price">${p}</span></button>`;
    }).join("");
    return `<div class="variants" role="radiogroup">${rows}</div>`;
  }

  function _addonsHtml(item, globalIdx) {
    if (!item.addons || !item.addons.length) return "";
    const sel = window.__addonSel[globalIdx] || [];
    const rows = item.addons.map(function (a, i) {
      const n = esc(_choiceLabel(a, window.__lang));
      const p = esc(a.price || "");
      const on = sel.indexOf(i) >= 0;
      return `<button type="button" class="addon${on ? " selected" : ""}" data-ai="${i}"` +
        ` aria-pressed="${on}">` +
        `<span class="addon-l"><span class="addon-check" aria-hidden="true"></span>` +
        `<span class="addon-name">${n}</span></span>` +
        `<span class="addon-price">+${p}</span></button>`;
    }).join("");
    return `<div class="addons">${rows}</div>`;
  }

  // Add-to-basket control. Shared by photo cards and text-only cards so the two cannot
  // drift apart. Starts as the cart button; `_syncQtyCtrl` swaps in the stepper once the
  // item is in the basket. The server renders one of these into every card - this copy is
  // for the modal and the lightbox, which build their panels at runtime.
  const CART_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
    '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

  function _qtyCtrlHtml(globalIdx) {
    return `<div class="qty-ctrl" data-idx="${globalIdx}">` +
      `<button class="qty-add-btn" aria-label="Add to basket">${CART_SVG}</button>` +
      `<div class="qty-stepper">` +
      `<button class="qty-dec">&#8722;</button>` +
      `<span class="qty-num">1</span>` +
      `<button class="qty-inc">+</button>` +
      `</div></div>`;
  }

  // ── the basket ────────────────────────────────────────────────────────────────────

  function _updateBasketBar() {
    const count = _basketCount();
    const bar = $("basket-bar");
    if (!bar) return;
    const show = count > 0;
    bar.classList.toggle("visible", show);
    document.body.classList.toggle("basket-bar-visible", show);
    if (!show) return;
    $("basket-bar-count").textContent = count + " " + (
      window.__lang === "ka" ? "პროდუქტი"
        : window.__lang === "ru" ? _ruPlural(count, "товар", "товара", "товаров")
          : count === 1 ? "item" : "items");
    $("basket-bar-total").textContent = _fmtPrice(_basketTotal());
  }

  // Every control for one basket line, wherever it is on the page: the card, the 3D
  // modal, the lightbox. They share a `data-idx`, so they cannot disagree about a
  // quantity - which is the whole reason the platform keyed them that way.
  function _syncQtyCtrl(key) {
    const entry = window._basket.get(key);
    const qty = entry ? entry.qty : 0;
    document.querySelectorAll('.qty-ctrl[data-idx="' + key + '"]').forEach(function (ctrl) {
      const addBtn = ctrl.querySelector(".qty-add-btn");
      const stepper = ctrl.querySelector(".qty-stepper");
      const numEl = ctrl.querySelector(".qty-num");
      if (!addBtn || !stepper) return;
      if (qty > 0) {
        addBtn.style.display = "none";
        stepper.classList.add("visible");
        if (numEl) numEl.textContent = qty;
      } else {
        addBtn.style.display = "";
        stepper.classList.remove("visible");
      }
    });
  }

  function addToBasket(key, item, aIdx, vIdx) {
    if (!item) return;
    const isNew = !window._basket.has(key);
    if (!isNew) window._basket.get(key).qty++;
    else window._basket.set(key, {
      item: item, qty: 1, aIdx: aIdx || [],
      vIdx: typeof vIdx === "number" ? vIdx : null,
    });
    if (isNew) {
      // The number the company is a bet on: did the dish they added come after they
      // looked at it in 3D, or in AR, or neither.
      const bIdx = parseInt(key, 10);
      window.track("basket_add", bIdx, {
        after_ar: window._arViewedItems.has(bIdx),
        after_3d: window._modalViewedItems.has(bIdx),
      });
    }
    _syncQtyCtrl(key);
    _updateBasketBar();
    if (_panelOpen()) _renderBasketPanel();
  }

  function _setQty(key, qty) {
    if (qty <= 0) {
      if (window._basket.has(key)) window.track("basket_remove", parseInt(key, 10));
      window._basket.delete(key);
    } else if (window._basket.has(key)) {
      window._basket.get(key).qty = qty;
    }
    _syncQtyCtrl(key);
    _updateBasketBar();
    if (_panelOpen()) _renderBasketPanel();
  }

  function _panelOpen() {
    const p = $("basket-panel");
    return !!p && p.style.display === "flex";
  }

  function _renderBasketPanel() {
    const u = window.UI[window.__lang] || window.UI.en;
    const box = $("basket-items");
    if (!box) return;
    box.innerHTML = "";
    $("basket-title").textContent = u.basketTitle;
    $("basket-clear").textContent = u.clearBasket;
    $("basket-close").textContent = u.close;
    $("basket-total-label").textContent = u.total;
    $("basket-waiter-label").textContent = u.showWaiter;
    if (window._basket.size === 0) {
      box.innerHTML = `<p class="basket-empty">${esc(u.emptyBasket)}</p>`;
    } else {
      window._basket.forEach(function (entry, key) {
        const item = entry.item, qty = entry.qty, aIdx = entry.aIdx, vIdx = entry.vIdx;
        const line = _lineUnit(entry) * qty;
        const v = vIdx != null && item.variants && item.variants[vIdx];
        const varTxt = v ? _choiceLabel(v, window.__lang) : "";
        const addTxt = (aIdx && aIdx.length)
          ? aIdx.map(function (i) {
            const a = (item.addons || [])[i];
            return a ? _choiceLabel(a, window.__lang) : "";
          }).filter(Boolean).join(", ")
          : "";
        const row = document.createElement("div");
        row.className = "basket-item";
        row.innerHTML =
          `<div class="basket-item-info">` +
          `<span class="basket-item-name">${esc(window.t(item, "name"))}</span>` +
          (varTxt ? `<span class="basket-item-addons">${esc(varTxt)}</span>` : "") +
          (addTxt ? `<span class="basket-item-addons">+ ${esc(addTxt)}</span>` : "") +
          `</div>` +
          `<div class="basket-qty">` +
          `<button class="qty-btn" data-key="${esc(key)}" data-delta="-1">&#8722;</button>` +
          `<span class="qty-count">${qty}</span>` +
          `<button class="qty-btn" data-key="${esc(key)}" data-delta="1">+</button>` +
          `</div>` +
          `<span class="basket-item-price">${_fmtPrice(line)}</span>`;
        box.appendChild(row);
      });
    }
    $("basket-total").textContent = _fmtPrice(_basketTotal());
  }

  function _openBasket() {
    window.track("basket_open");
    _renderBasketPanel();
    const panel = $("basket-panel");
    panel.style.display = "flex";
    requestAnimationFrame(function () { panel.classList.add("active"); });
    document.body.style.overflow = "hidden";
  }
  function _closeBasket() {
    const panel = $("basket-panel");
    panel.classList.remove("active");
    setTimeout(function () { panel.style.display = "none"; }, 230);
    document.body.style.overflow = "";
  }

  function _clearBasket(counted) {
    if (counted && window._basket.size > 0) {
      // The one place a diner tells us the offer was wrong: a full basket, abandoned.
      const snapshot = [];
      let total = 0;
      window._basket.forEach(function (entry) {
        snapshot.push({
          name: entry.item.name, qty: entry.qty, price: _fmtPrice(_lineUnit(entry)),
        });
        total += _lineUnit(entry) * entry.qty;
      });
      window.track("basket_clear", null, {
        item_count: snapshot.length, items: snapshot,
        total_gel: Math.round(total * 10) / 10,
      });
    }
    const keys = Array.from(window._basket.keys());
    window._basket.clear();
    keys.forEach(_syncQtyCtrl);
    _updateBasketBar();
  }

  // ── show to staff ─────────────────────────────────────────────────────────────────
  // The basket is packed into a URL fragment and drawn as a QR. Staff scan it and get the
  // order on their own phone, resolved against the LIVE menu so prices are always current.
  // Everything is client-side and the library loads on the first tap, so a diner who never
  // orders never downloads it.

  let _qrLibPromise = null;
  function _loadQRLib() {
    if (window.qrcode) return Promise.resolve();
    if (_qrLibPromise) return _qrLibPromise;
    _qrLibPromise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "/vendor/qrcode.js";
      s.onload = function () { resolve(); };
      s.onerror = function () { _qrLibPromise = null; reject(new Error("qr lib failed")); };
      document.head.appendChild(s);
    });
    return _qrLibPromise;
  }

  function _packOrder() {
    const it = [];
    window._basket.forEach(function (entry) {
      const item = entry.item;
      // The dish's REAL id, not its position. A position is meaningless to the staff page,
      // which re-resolves every line against the live menu - and meaningless five minutes
      // later if the owner hides a dish.
      if (!item || !item.id) return;
      // [id, qty] · [id, qty, [add-on idx]] · [id, qty, [add-on idx], variantIdx]
      const hasA = entry.aIdx && entry.aIdx.length;
      const hasV = typeof entry.vIdx === "number";
      if (hasV) it.push([item.id, entry.qty, hasA ? entry.aIdx : [], entry.vIdx]);
      else if (hasA) it.push([item.id, entry.qty, entry.aIdx]);
      else it.push([item.id, entry.qty]);
    });
    const payload = {
      v: 1,
      r: document.documentElement.dataset.tenant || "",
      ts: Date.now(),
      it: it,
    };
    // UTF-8-safe base64url. Georgian dish names are multi-byte and plain btoa throws on
    // them; the staff page decodes with the mirror of this.
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { b64: b64, count: it.length };
  }

  async function _showWaiterQR() {
    const overlay = $("waiter-overlay");
    const box = $("waiter-qr");
    const u = window.UI[window.__lang] || window.UI.en;
    const packed = _packOrder();
    if (!packed.count) return;          // empty basket -> nothing to show

    $("waiter-overlay-title").textContent = u.showWaiter;
    $("waiter-overlay-hint").textContent = u.waiterHint;
    box.innerHTML = "";
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";

    try {
      await _loadQRLib();
      const url = location.origin + "/w/" +
        encodeURIComponent(document.documentElement.dataset.tenant || "") +
        "#" + packed.b64;
      // Prefer 'M' (~15% error correction - most reliable scan across a table, in the
      // dark, on a cracked screen). A very large basket exceeds 'M' capacity, so fall
      // back to 'L' (~7%, more data) before giving up.
      let svg = null;
      for (const ecc of ["M", "L"]) {
        try {
          const qr = window.qrcode(0, ecc);   // 0 = auto-size version
          qr.addData(url);
          qr.make();
          svg = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
          break;
        } catch (_capacity) { /* try the next, lower-ECC level */ }
      }
      if (!svg) throw new Error("too large for a single code");
      box.innerHTML = svg;
      window.track("waiter_qr_shown", null, { item_count: packed.count });
    } catch (err) {
      box.innerHTML = '<p style="color:#b00020;font-size:0.85rem;padding:24px 12px;">' +
        "This order is too large for one code - please call the waiter over.</p>";
    }
  }

  function _closeWaiterOverlay() {
    $("waiter-overlay").classList.remove("active");
    document.body.style.overflow = "";
  }

  // ── published, because the ported viewer calls every one of these by name ──────────
  window._parsePrice = _parsePrice;
  window._fmtPrice = _fmtPrice;
  window._lineUnit = _lineUnit;
  window._basketTotal = _basketTotal;
  window._basketCount = _basketCount;
  window._ruPlural = _ruPlural;
  window._basketKey = _basketKey;
  window._variantIndex = _variantIndex;
  window._selectedVariantImage = _selectedVariantImage;
  window._variantsHtml = _variantsHtml;
  window._addonsHtml = _addonsHtml;
  window._qtyCtrlHtml = _qtyCtrlHtml;
  window._syncQtyCtrl = _syncQtyCtrl;
  window._updateBasketBar = _updateBasketBar;
  window._renderBasketPanel = _renderBasketPanel;
  window.addToBasket = addToBasket;
  window._setQty = _setQty;
  window._openBasket = _openBasket;
  window._closeBasket = _closeBasket;
  window._showWaiterQR = _showWaiterQR;

  // ── wiring ────────────────────────────────────────────────────────────────────────
  //
  // Everything below binds to markup that `chrome.html` puts in the page. If any of it is
  // missing the listeners throw, and a throw HERE would take `viewer.js` down with it -
  // which is exactly the failure that shipped. So it is wrapped, and it says which id it
  // could not find rather than dying anonymously on line 18 of something else.

  function wire() {
    const list = $("menu-list");
    if (list) {
      // One listener for every card, instead of nine per card. The cards are in the HTML
      // before this file runs, and the filter hides and shows them rather than rebuilding
      // them, so there is no moment at which a card needs its own listeners attached.
      list.addEventListener("click", onCardClick);
    }

    $("basket-bar").addEventListener("click", _openBasket);
    $("basket-bar-delete").addEventListener("click", function (e) {
      e.stopPropagation();
      _clearBasket(false);
    });
    $("basket-close").addEventListener("click", _closeBasket);
    $("basket-panel").addEventListener("click", function (e) {
      if (e.target === $("basket-panel")) _closeBasket();
    });
    $("basket-clear").addEventListener("click", function () {
      _clearBasket(true);
      _renderBasketPanel();
    });
    $("basket-items").addEventListener("click", function (e) {
      const btn = e.target.closest(".qty-btn");
      if (!btn) return;
      const entry = window._basket.get(btn.dataset.key);
      if (entry) _setQty(btn.dataset.key, entry.qty + parseInt(btn.dataset.delta, 10));
    });

    $("basket-waiter-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      _showWaiterQR();
    });
    $("waiter-overlay-close").addEventListener("click", _closeWaiterOverlay);
    $("waiter-overlay").addEventListener("click", function (e) {
      if (e.target === $("waiter-overlay")) _closeWaiterOverlay();
    });

    // Add to basket from inside AR, while the dish is standing on the diner's table.
    // Tapping it again removes it, but only if AR is what put it there - a dish added
    // from the menu and then seen in AR must not vanish on a stray tap.
    $("xr-add-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      const item = window.XR && window.XR.getCurrentItem && window.XR.getCurrentItem();
      if (!item || !window.menuItems) return;
      const idx = window.menuItems.indexOf(item);
      if (idx < 0) return;
      const key = String(idx);
      if (!window._basket.has(key)) {
        addToBasket(key, item);
        window._xrAddedKeys.add(key);
      } else if (window._xrAddedKeys.has(key)) {
        _setQty(key, 0);
        window._xrAddedKeys.delete(key);
      }
      $("xr-add-btn").classList.toggle("in-basket", window._basket.has(key));
    });
  }

  /** Every tap inside the menu list. The platform's per-card handlers, in one place.
   *
   *  Order matters and is theirs: the quantity controls and the option pills claim the
   *  tap first, because a diner adjusting a size is not asking to open the dish.
   */
  function onCardClick(ev) {
    const card = ev.target.closest(".menu-item[data-idx]");
    if (!card) return;
    const idx = parseInt(card.dataset.idx, 10);
    const item = (window.menuItems || [])[idx];
    if (!item) return;

    const hasV = !!(item.variants && item.variants.length);
    const hasA = !!(item.addons && item.addons.length);

    // ── the quantity control ──
    const add = ev.target.closest(".qty-add-btn");
    if (add) {
      ev.stopPropagation();
      if (hasV || hasA) {
        // A dish with sizes or add-ons always adds through "+", because each combination
        // is its own basket line and the inline stepper cannot express which one.
        const sel = (window.__addonSel[idx] || []).slice().sort((a, b) => a - b);
        const vSel = hasV ? _variantIndex(item, idx) : null;
        addToBasket(_basketKey(idx, vSel, sel), item, sel, vSel);
        add.classList.remove("just-added");
        void add.offsetWidth;                     // restart the animation
        add.classList.add("just-added");
      } else {
        addToBasket(String(idx), item);
      }
      return;
    }
    if (ev.target.closest(".qty-dec")) {
      ev.stopPropagation();
      const entry = window._basket.get(String(idx));
      if (entry) _setQty(String(idx), entry.qty - 1);
      return;
    }
    if (ev.target.closest(".qty-inc")) {
      ev.stopPropagation();
      addToBasket(String(idx), item);
      return;
    }

    // ── size pills ──
    const vBtn = ev.target.closest(".variant");
    if (vBtn) {
      ev.stopPropagation();
      const vi = parseInt(vBtn.dataset.vi, 10);
      window.__variantSel[idx] = vi;
      card.querySelectorAll(".variant").forEach(function (o) {
        const on = o === vBtn;
        o.classList.toggle("selected", on);
        o.setAttribute("aria-checked", on ? "true" : "false");
      });
      // The card price follows the size. A drink whose item price reads "16 / 70" is
      // showing a summary; the real number is the one the diner just chose.
      const pv = item.variants[vi];
      const priceEl = card.querySelector(".price");
      if (priceEl && pv) priceEl.textContent = pv.price || "";
      // A pictureless choice keeps the main photo; a pictured one swaps this card's photo
      // and never creates a second dish.
      const img = _selectedVariantImage(item, idx);
      if (img) {
        const mv = card.querySelector("model-viewer");
        if (mv) mv.remove();
        const wrap = card.querySelector(".thumb-wrap");
        if (wrap) wrap.classList.remove("thumb-model-ready");
        const thumb = card.querySelector(".thumb-img");
        if (thumb) {
          thumb.dataset.model = "";
          delete thumb.dataset.upgraded;
          thumb.src = img;
        }
      }
      return;
    }

    // ── add-on checkboxes ──
    const aBtn = ev.target.closest(".addon");
    if (aBtn) {
      ev.stopPropagation();
      const ai = parseInt(aBtn.dataset.ai, 10);
      const arr = window.__addonSel[idx] || (window.__addonSel[idx] = []);
      const at = arr.indexOf(ai);
      const on = at < 0;
      if (on) arr.push(ai); else arr.splice(at, 1);
      aBtn.classList.toggle("selected", on);
      aBtn.setAttribute("aria-pressed", on ? "true" : "false");
      return;
    }

    // ── the AR button ──
    if (ev.target.closest(".ar-btn")) {
      ev.stopPropagation();
      window.openAR(idx, window.menuItems);
      return;
    }

    // ── everything else opens the dish ──
    //
    // A 3D dish opens the 3D viewer; a photo dish opens the photo. Both are the platform's
    // behaviour, and the thumbnail is deliberately NOT handled here: once a poster
    // upgrades to a live <model-viewer>, `_upgradeThumb` puts its own pointer pair on it
    // so that a DRAG rotates the dish and only a real tap opens the modal. Handling the
    // thumbnail here as well would fight that - every rotation ends in a click that
    // bubbles, and the modal would open when the diner was turning the plate round.
    if (ev.target.closest(".thumb-wrap")) return;

    if (item.is_3d) window.openModal(idx, window.menuItems);
    else if (item.thumbnail_url) window.openLightbox(item.thumbnail_url,
      window.t(item, "name"), item, idx);
  }

  // Bound after the DOM exists but before `__bootViewer` runs, so a diner who taps a card
  // in the first second gets the same behaviour as one who waits.
  function start() {
    try {
      wire();
      _updateBasketBar();
    } catch (err) {
      // Named loudly on purpose. The whole reason this file exists is that a missing
      // element once produced a TypeError with no name on it, and the visible symptom was
      // "the menu is fine but nothing works" for two weeks.
      window.__platformError = err;
      console.error("[betareal] platform layer failed to wire - is chrome.html in the " +
        "page? Every basket, lightbox and AR control needs its markup present.", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

/* ---- viewer.js ---- */
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
/* ---- hero.js ---- */
        /* ── Monday Greens hero gallery ──────────────────────────────────────────
           theme_config.hero_images holds a JSON array (or comma/newline list) of photo
           URLs. With two or more photos the hero crossfades through them; with one or
           none it behaves exactly as before and falls back to hero_image_url. */
        function _parseHeroImages(raw) {
            if (!raw) return [];
            const s = String(raw).trim();
            let list = [];
            if (s[0] === '[') { try { list = JSON.parse(s); } catch (e) { list = []; } }
            if (!list.length) list = s.replace(/^\[|\]$/g, '').split(/[,;\n]/);
            const out = [];
            list.forEach(v => {
                const url = _safeAssetUrl(String(v).replace(/^["'\s]+|["'\s]+$/g, ''));
                if (url && out.indexOf(url) === -1) out.push(url);
            });
            return out;
        }

        // Templates whose hero has the crossfade layer (.mg-hero-next) in their CSS.
        // A template not listed here still shows hero_images[0] as a still photo.
        const HERO_GALLERY_TEMPLATES = new Set(['monday_greens', 'burger_lions', 'respublika_grill', 'iakobis_garden',
            'luxury_dining', 'social_dining', 'modern_cafe', 'elegant_black']);

        // Templates whose hero starts aria-hidden in the markup and is only
        // revealed once its photo is known.
        const HERO_REVEAL_TEMPLATES = new Set(['luxury_dining', 'social_dining']);

        // Templates with their own dedicated hero shell still receive the same uploaded
        // image, but do not also render the shared hero above it.
        const HERO_NATIVE_SHELL_TEMPLATES = new Set(['baoma', 'mugsy_street_diner', 'pipes_fabrika']);

        // FOOD | DRINKS split. A tenant opts in by listing its drink category
        // names in theme_config.drink_categories; an empty list means no switch.
        //
        // Held off between 2026-08-04 and 2026-08-06 while the restaurants were
        // asked. It had been silently dead since 2026-07-27 — killed by the
        // ReferenceError repaired in applyRemoteTheme() — so repairing that would
        // have restructured a live café menu as a side effect of a hero fix.
        // Restored deliberately, on request: this is the arrangement Monday Greens
        // had before the break, not a new one.
        const DRINK_SPLIT_ENABLED = true;

        // Templates that render the generic visit/contact block. Mirrors
        // CONTENT_TEMPLATES in the admin app, which decides where the matching
        // editor fields appear.
        const VENUE_INFO_TEMPLATES = new Set(['burger_bar', 'gochit_monster', 'luxury_dining', 'social_dining']);

        // Paint the visit/contact block from theme_config. Every field is
        // optional: an empty value hides its element, and if nothing at all is
        // set the whole section stays hidden. Georgian reads the `_ka` variant.
        function _applyVenueInfo(cfg) {
            const sec = document.getElementById('venue-info');
            if (!sec) return;
            const txt = key => {
                const ka = window.__lang === 'ka' ? _cleanText(cfg[key + '_ka']) : '';
                return ka || _cleanText(cfg[key]);
            };
            const put = (id, text) => {
                const el = document.getElementById(id);
                if (!el) return '';
                el.textContent = text;
                el.hidden = !text;
                return text;
            };
            const link = (id, label, url) => {
                const el = document.getElementById(id);
                if (!el) return '';
                const safe = _safeAssetUrl(url);
                el.textContent = label;
                if (safe) el.href = safe;
                el.hidden = !(label && safe);
                return el.hidden ? '' : label;
            };
            const filled = [
                put('venue-kicker', txt('info_kicker')),
                put('venue-title', txt('info_title')),
                put('venue-text', txt('info_text')),
                link('venue-directions', txt('info_directions_label'), cfg.info_directions_url),
                link('venue-instagram', txt('info_instagram_label'), cfg.info_instagram_url),
            ].filter(Boolean);
            sec.hidden = filled.length === 0;
            _applyVenueLinks(cfg);
            _applyVenueMap(cfg);
        }

        // Platform marks live in img/brands/ and are shared by every tenant —
        // any restaurant can be on Wolt. Keyed by a slug derived from the link
        // label, so a tenant just writes {"label":"Wolt","url":"…"} and gets the
        // icon; an unrecognised label still renders, just without a mark.
        const VENUE_LINK_ICONS = {
            facebook: 'facebook', fb: 'facebook',
            instagram: 'instagram', ig: 'instagram',
            tiktok: 'tiktok',
            wolt: 'wolt',
            glovo: 'glovo',
            bolt: 'bolt-food', boltfood: 'bolt-food'
        };

        function _applyVenueLinks(cfg) {
            const wrap = document.getElementById('venue-links');
            if (!wrap) return;
            wrap.textContent = '';
            const list = _parseConfigList(cfg.venue_links);
            let shown = 0;
            list.forEach(entry => {
                const url = _safeAssetUrl(entry && entry.url);
                const label = _cleanText(entry && (window.__lang === 'ka' && entry.label_ka ? entry.label_ka : entry.label));
                if (!url || !label) return;
                const a = document.createElement('a');
                a.className = 'venue-chip';
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener';
                const key = label.toLowerCase().replace(/[^a-z]/g, '');
                const icon = VENUE_LINK_ICONS[key];
                if (icon) {
                    const img = document.createElement('img');
                    img.src = './img/brands/' + icon + '.webp';
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.width = 24;
                    img.height = 24;
                    // a missing mark must not leave a broken-image box
                    img.addEventListener('error', () => img.remove(), { once: true });
                    a.appendChild(img);
                }
                a.appendChild(document.createTextNode(label));
                wrap.appendChild(a);
                shown++;
            });
            wrap.hidden = shown === 0;
        }

        // Build the map embed. `info_map_query` is a plain place/address string
        // ("Burger Bar, Tbilisi") which is turned into Google's keyless embed
        // URL; `info_map_embed_url` overrides it when a tenant has a specific
        // embed to pin. Nothing is inserted unless one of them is set, so the
        // third-party frame is opt-in per tenant rather than a cost everyone
        // pays. loading=lazy keeps it off the first paint either way.
        function _applyVenueMap(cfg) {
            const box = document.getElementById('venue-map');
            if (!box) return;
            box.textContent = '';
            const explicit = _safeAssetUrl(cfg.info_map_embed_url);
            const query = _cleanText(cfg.info_map_query);
            let src = '';
            if (explicit && /(^https:\/\/(www\.)?google\.[a-z.]+\/maps)|(^https:\/\/maps\.google\.)/i.test(explicit)) {
                src = explicit;
            } else if (query) {
                src = 'https://www.google.com/maps?q=' + encodeURIComponent(query) + '&output=embed';
            }
            box.hidden = !src;
            box.classList.remove('is-link');
            if (!src) return;
            const f = document.createElement('iframe');
            f.src = src;
            f.loading = 'lazy';
            f.referrerPolicy = 'no-referrer-when-downgrade';
            f.setAttribute('allowfullscreen', '');
            f.title = _cleanText(cfg.site_name) || 'Map';
            box.appendChild(f);
            // Tapping the map opens the venue in Google Maps. info_map_link is
            // the tenant's own share link when it has one (a maps.app.goo.gl
            // short URL keeps the exact pin and place card); otherwise the
            // directions URL already configured for the contact block.
            const hit = _safeAssetUrl(cfg.info_map_link) || _safeAssetUrl(cfg.info_directions_url);
            if (!hit) return;
            const a = document.createElement('a');
            a.className = 'venue-map-hit';
            a.href = hit;
            a.target = '_blank';
            a.rel = 'noopener';
            a.setAttribute('aria-label',
                _cleanText(cfg.info_directions_label) || 'Open in Google Maps');
            box.appendChild(a);
            box.classList.add('is-link');
        }

        // Signature strip: up to three promoted dishes as large photo-led cards
        // above the list. Only templates that style .bb-featured show it, and
        // only items explicitly flagged `featured` in the admin panel appear —
        // so a tenant that promotes nothing simply has no strip.
        const FEATURED_LIMIT = 3;

        function _renderFeatured(items, activeFilter) {
            const wrap = document.getElementById('bb-featured');
            const head = document.getElementById('bb-feat-head');
            if (!wrap || !head) return;
            wrap.textContent = '';
            // Hidden while a category filter is active: promoting a burger at
            // the top of the Drinks list reads as a bug, not a highlight.
            const on = VENUE_INFO_TEMPLATES.has(document.documentElement.dataset.template)
                && !activeFilter;
            let picks = on
                ? (items || []).filter(i => i.featured && i.visible !== false).slice(0, FEATURED_LIMIT)
                : [];
            // The exact MINGLEYARD showcase always has one dynamic editorial lead.
            // Prefer an admin-featured dish; otherwise choose the first real 3D
            // record with a poster. No name, price, or asset is hardcoded here.
            const isMingleyard = document.documentElement.dataset.tenant === 'social-dining'
                && document.documentElement.dataset.template === 'social_dining';
            if (on && isMingleyard && !picks.length) {
                const lead = (items || []).find(i => i.visible !== false
                    && _isAREnabledMenuItem(i) && _safeAssetUrl(i.thumbnail_url));
                if (lead) picks = [lead];
            }
            head.hidden = !picks.length;
            if (!picks.length) return;
            head.textContent = isMingleyard
                ? (window.__lang === 'ka' ? 'ეზოს არჩევანი' : 'House drop')
                : (window.__lang === 'ka' ? 'ფირმის კერძები' : "Chef's picks");

            picks.forEach(item => {
                const idx = items.indexOf(item);
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'bb-card';
                const name = t(item, 'name');
                card.setAttribute('aria-label', name);

                const img = document.createElement('img');
                img.className = 'bb-card-img';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.alt = '';
                const src = _safeAssetUrl(item.thumbnail_url);
                if (src) img.src = src;
                else img.dataset.empty = '1';
                img.addEventListener('error', () => { img.removeAttribute('src'); img.dataset.empty = '1'; }, { once: true });

                const body = document.createElement('div');
                body.className = 'bb-card-body';
                const left = document.createElement('div');
                const h = document.createElement('p');
                h.className = 'bb-card-name';
                h.textContent = name;
                left.appendChild(h);
                const desc = _cleanText(t(item, 'description'));
                if (desc) {
                    const d = document.createElement('p');
                    d.className = 'bb-card-desc';
                    d.textContent = desc;
                    left.appendChild(d);
                }
                const price = document.createElement('div');
                price.className = 'bb-card-price';
                _setPriceWithOld(price, item.price, item.price_old);
                body.append(left, price);
                card.append(img, body);

                card.addEventListener('click', () => {
                    if (isMingleyard && _isAREnabledMenuItem(item)) openModal(idx, items);
                    else if (src) openLightbox(src, name, item, idx);
                });
                wrap.appendChild(card);
            });
        }

        function _startHeroGallery(urls) {
            const base = document.querySelector('.mg-hero-photo');
            const next = document.querySelector('.mg-hero-next');
            if (!base || !next || urls.length < 2) return;
            // The gallery runs for everyone, including guests with "reduce motion" on:
            // the rotating hero is the restaurant's headline content, not decoration, and
            // a slow opacity crossfade involves no movement through space. Reported from a
            // real phone where the hero sat frozen on the first photo.
            urls.forEach(u => { const img = new Image(); img.decoding = 'async'; img.src = u; });

            const FADE = 1200, HOLD = 5000;
            let idx = 0, timer = null;

            function step() {
                idx = (idx + 1) % urls.length;
                const url = urls[idx];
                next.style.backgroundImage = `url("${url}")`;
                requestAnimationFrame(() => { next.style.opacity = '1'; });
                setTimeout(() => {
                    // Hand the photo down to the base layer, then reset the fader
                    // invisibly (transition off + forced reflow = no flash).
                    base.style.backgroundImage = `url("${url}")`;
                    next.style.transition = 'none';
                    next.style.opacity = '0';
                    void next.offsetWidth;
                    next.style.transition = '';
                }, FADE);
            }

            function play() { if (!timer) timer = setInterval(step, HOLD + FADE); }
            function pause() { clearInterval(timer); timer = null; }
            // Don't burn the guest's battery while the tab sits in the background.
            document.addEventListener('visibilitychange', () => { document.hidden ? pause() : play(); });
            play();
        }

        /* ── Hero video ─────────────────────────────────────────────────────────
           theme_config.hero_video_url turns the shared hero band into a muted,
           looping clip. It is layered over the hero poster rather than replacing
           it, which is what keeps this cheap: the band paints from the still on
           the very first frame, exactly as it did before, and the video is only
           attached on idle afterwards. Nothing about the first screenful changes
           if the clip is slow, blocked, or never arrives.

           A tenant may also set hero_video_mobile_url — a squarer cut for phones,
           where a 16:9 clip loses most of its width to `cover`. Chose the source
           in JS rather than <source media>, which browsers only evaluate at first
           load and Chrome has dropped and re-added more than once. */
        const HERO_VIDEO_MOBILE_MQ = '(max-width: 639px)';

        function _heroVideoSrc(cfg) {
            const wide   = _safeAssetUrl(cfg.hero_video_url);
            const mobile = _safeAssetUrl(cfg.hero_video_mobile_url);
            if (!wide && !mobile) return '';
            const phone = window.matchMedia(HERO_VIDEO_MOBILE_MQ).matches;
            return (phone && mobile) || wide || mobile;
        }

        // The clip is a megabyte the guest did not ask for, sitting on top of a
        // poster that already carries the hero on its own. Anything suggesting
        // they are paying for bytes or want less movement keeps the still photo,
        // and they lose nothing by it.
        function _heroVideoWanted() {
            try {
                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
                const c = navigator.connection;
                if (c && c.saveData) return false;
                if (c && /2g/i.test(String(c.effectiveType || ''))) return false;
            } catch (_) {}
            return true;
        }

        // Returns true when a clip is configured — including when it is
        // deliberately not being played — so the caller knows the band belongs to
        // the video and leaves the photo rotation alone.
        function _startHeroVideo(cfg) {
            const src = _heroVideoSrc(cfg);
            if (!src) return false;
            const vid = document.getElementById('mg-hero-video');
            if (!vid || !vid.canPlayType || !vid.canPlayType('video/mp4')) return false;
            if (!_heroVideoWanted()) return true;

            const kick = () => { const p = vid.play(); if (p && p.catch) p.catch(() => {}); };

            const mount = () => {
                if (vid.dataset.mounted) return;
                vid.dataset.mounted = '1';
                // Set as a property too: some Safari builds ignore autoplay unless
                // muted is true on the element, not merely present in the markup.
                vid.muted = true;
                document.documentElement.dataset.heroVideo = 'loading';
                // Reveal only once there are decoded frames, so the fade never
                // crosses a black or half-painted first frame.
                vid.addEventListener('loadeddata', () => {
                    document.documentElement.dataset.heroVideo = 'true';
                }, { once: true });
                // A clip that will not decode leaves the poster exactly as it was.
                vid.addEventListener('error', () => {
                    document.documentElement.dataset.heroVideo = 'failed';
                }, { once: true });
                vid.preload = 'auto';
                vid.src = src;
                vid.load();
                kick();

                // Decoding a looping video the guest cannot see is pure battery.
                if ('IntersectionObserver' in window) {
                    new IntersectionObserver(entries => {
                        entries.forEach(e => {
                            vid.dataset.onscreen = e.isIntersecting ? '1' : '0';
                            if (e.isIntersecting && !document.hidden) kick(); else vid.pause();
                        });
                    }, { threshold: 0.01 }).observe(vid);
                }
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) vid.pause(); else if (vid.dataset.onscreen !== '0') kick();
                });
            };

            // Same idiom the 3D thumbnail upgrades use: hand the clip to an idle
            // slot so it queues behind the menu's own first paint.
            const idle = window.requestIdleCallback || (cb => setTimeout(cb, 1));
            idle(mount, { timeout: 2500 });
            return true;
        }

/* ---- page.js ---- */
// page.js — the platform features that are about the LIST rather than about a dish.
//
// Category filtering, the 3D-first ordering, the day/night switch and the language switch.
// Like `platform.js`, every one of these is a feature every menu has: a template changes
// how they LOOK, never whether they exist. Nothing here reads `data-template`.
//
// ── why this is adapted rather than copied, and where the line is ────────────────────
//
// The platform filters by re-rendering: `applyFilter` calls `renderMenuList(cat)`, which
// empties `#menu-list` and rebuilds every card from the array it fetched. It has to -
// there is nothing in its HTML until JavaScript puts it there.
//
// Our page arrives with all 170 cards already in it, grouped into `.cat-section`s, because
// that is the whole point of rendering on the server. So the same behaviour is reached by
// showing and hiding what is already there. The RULES are theirs, exactly:
//
//   `__ar3d` is a sentinel, not a category name, so a restaurant with a real category
//   called "3D" cannot collide with it.
//
//   A 3D dish appears in BOTH the 3D pill and its own category. Temo chose full
//   duplication after the platform's first version moved 3D items out of their categories
//   and diners stopped finding them.
//
//   In the "All" view the 3D block leads and then every category follows in menu order.
//   Inside a single selected category, 3D dishes come first. Both are `appendPrioritizedItems`
//   and `renderMenuList` in index.html, and both are why Temo's "3d does not appear on
//   top" was a real report and not a preference.
//
// One thing is NOT a copy and is marked where it happens: the sections use
// `display: contents`, so the `hidden` attribute cannot hide them - the author rule wins
// over the UA one. The cards and the header are hidden individually instead.

(function () {
  "use strict";

  const $$ = (s, root) => [].slice.call((root || document).querySelectorAll(s));
  const $ = (id) => document.getElementById(id);

  // The virtual category. Display-only: its cards carry the same `data-idx` as the ones in
  // the real category, so the basket, AR and analytics treat them as one dish.
  const AR_CAT = "__ar3d";

  // ── categories ────────────────────────────────────────────────────────────────────

  let _activeFilter = "";

  /** Whether the filter's `hidden` will actually hide anything.
   *
   *  **This is the bug that survived one fix and shipped twice.** `[hidden] {display:none}`
   *  is a USER-AGENT rule; the template sheet says `.menu-item { display: grid }`, which is
   *  an AUTHOR rule, and author beats user-agent at any specificity. So setting `hidden`
   *  on a card did nothing at all. `.category-header` has no `display` of its own, so the
   *  headings DID hide - tapping a category removed the structure and left all 175 dishes
   *  where they were, which reads as "categories don't work" because it is.
   *
   *  `platform.css` restores it with `!important` on the hidden state. It is loaded after
   *  the template sheet, so no template can take it away - and this function checks at boot
   *  that it actually arrived, because a silently-missing stylesheet reproduces the
   *  original bug exactly and there would again be nothing in the console to find.
   */
  function hidingWorks() {
    const probe = document.createElement("div");
    probe.className = "cat-section";
    probe.hidden = true;
    document.body.appendChild(probe);
    const ok = getComputedStyle(probe).display === "none";
    probe.remove();
    if (!ok) {
      console.error("[betareal] platform.css did not load: `hidden` does not hide, so " +
        "the category filter cannot work. The template sheet's `display` is winning.");
    }
    return ok;
  }

  /** 3D dishes first, in a single selected category. The platform's `appendPrioritizedItems`.
   *
   *  The original order is captured once, so switching back to "All" restores the
   *  restaurant's own sequence rather than leaving a category permanently re-sorted.
   */
  function orderSection(section, arFirst) {
    const cards = $$(".menu-item", section);
    if (!cards.length) return;
    if (!section.__order) section.__order = cards.slice();
    const want = arFirst
      ? section.__order.filter((c) => c.dataset.glb)
        .concat(section.__order.filter((c) => !c.dataset.glb))
      : section.__order;
    // Only touch the DOM when the order actually differs. Re-appending 20 cards on every
    // pill tap is 20 layout invalidations for nothing.
    const now = $$(".menu-item", section);
    if (want.length === now.length && want.every((c, i) => c === now[i])) return;
    for (const card of want) section.appendChild(card);
  }

  function applyFilter(cat) {
    const sections = $$(".cat-section");
    // A pill for a category that no longer has anything in it falls back to All, rather
    // than showing a diner an empty menu.
    if (cat && cat !== AR_CAT && !sections.some((s) => s.dataset.cat === cat)) cat = "";
    _activeFilter = cat;

    for (const section of sections) {
      const mine = section.dataset.cat || "";
      const on = cat === "" || mine === cat;
      // The SECTION, not its 175 children. `display: contents` means it has no box of its
      // own, so hiding it removes the heading and every card under it in one attribute
      // write - and `platform.css` is what makes that attribute mean something.
      section.hidden = !on;
      // 3D first only inside a single selected category. In the All view the 3D block
      // above already leads, and the categories below keep the owner's own order.
      orderSection(section, on && cat !== "" && cat !== AR_CAT);
    }

    const bar = $("cat-filter");
    if (bar) {
      for (const p of $$(".cat-pill", bar)) {
        p.classList.toggle("active", (p.dataset.cat || "") === cat);
      }
    }
    // The AR buttons reset to their idle label: a filter change can hide the dish whose
    // model was mid-load, and a button left saying "Loading..." never stops.
    if (typeof setARButtonsState === "function") setARButtonsState(false);
  }

  function wireCategories() {
    const bar = $("cat-filter");
    if (!bar) return;
    bar.addEventListener("click", (ev) => {
      const pill = ev.target.closest(".cat-pill");
      if (!pill) return;
      const cat = pill.dataset.cat || "";
      window.track("category_filter", null, {
        category: cat === AR_CAT ? "3D" : (pill.textContent || "All"),
      });
      applyFilter(cat);
      // Back to the top of the list. Tapping "Desserts" after scrolling through Breakfast
      // otherwise lands the diner halfway down a category they just chose.
      const list = $("menu-list");
      if (list && _activeFilter) {
        const top = list.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
    });

    // The scroll arrows only mean anything when the pills actually overflow, which depends
    // on the phone, the language and how many categories a restaurant has - so it is
    // measured rather than assumed. Monday Greens has 26.
    const left = document.querySelector(".cat-nav-l");
    const right = document.querySelector(".cat-nav-r");
    const sync = () => {
      const over = bar.scrollWidth > bar.clientWidth + 4;
      if (left) left.hidden = !over || bar.scrollLeft <= 2;
      if (right) {
        right.hidden = !over ||
          bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
      }
    };
    const nudge = (dir) =>
      bar.scrollBy({ left: dir * bar.clientWidth * 0.7, behavior: "smooth" });
    if (left) left.addEventListener("click", () => nudge(-1));
    if (right) right.addEventListener("click", () => nudge(1));
    bar.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync);
    sync();
  }

  // ── language ──────────────────────────────────────────────────────────────────────
  //
  // Every translation is already in the page - the card carries `data-name-ka` and
  // `data-desc-ka`, the pill carries `data-cat-ka`. Switching is a swap, not a re-fetch
  // and not a re-render: a diner changing language must not watch the menu reload, which
  // is the same principle as the whole no-flash design.

  const LABEL = { en: "EN", ka: "ქარ", ru: "RU" };
  const CASED = { en: "En", ka: "Ka", ru: "Ru" };   // dataset keys: data-name-ka -> nameKa

  function applyLang(lang, langs) {
    document.documentElement.lang = lang;
    window.__lang = lang;
    try { localStorage.setItem("br-lang", lang); } catch (_) { /* private mode */ }

    const suffix = CASED[lang] || "";
    for (const card of $$(".menu-item")) {
      const d = card.dataset;
      const nameEl = card.querySelector(".item-name");
      if (nameEl) {
        const alt = lang === "en" ? d.name : (d["name" + suffix] || d.name);
        if (alt && nameEl.textContent !== alt) nameEl.textContent = alt;
      }
      const descEl = card.querySelector(".ingredients");
      if (descEl) {
        const alt = lang === "en" ? d.desc : (d["desc" + suffix] || d.desc);
        if (alt != null && descEl.textContent !== alt) descEl.textContent = alt;
      }
    }
    for (const el of $$(".cat-pill, .category-header")) {
      const d = el.dataset;
      const alt = lang === "en" ? d.catEn : (d["cat" + suffix] || d.catEn);
      if (alt && el.textContent !== alt) el.textContent = alt;
    }
    // The size and add-on pills carry their own translations, and the basket panel is
    // built from `UI[lang]` the next time it opens.
    for (const card of $$(".menu-item")) {
      const idx = parseInt(card.dataset.idx, 10);
      const item = (window.menuItems || [])[idx];
      if (!item || !(item.variants || []).length && !(item.addons || []).length) continue;
      const vBox = card.querySelector(".variants");
      if (vBox && typeof window._variantsHtml === "function") {
        vBox.outerHTML = window._variantsHtml(item, idx);
      }
      const aBox = card.querySelector(".addons");
      if (aBox && typeof window._addonsHtml === "function") {
        aBox.outerHTML = window._addonsHtml(item, idx);
      }
    }
    if (typeof window._updateBasketBar === "function") window._updateBasketBar();

    const btn = $("lang-toggle");
    if (btn && langs.length > 1) {
      // The button always offers the OTHER language, so its label is never the one you are
      // already reading.
      const next = langs[(langs.indexOf(lang) + 1) % langs.length];
      btn.textContent = LABEL[next] || next.toUpperCase();
      btn.dataset.next = next;
    }
  }

  function wireLanguage() {
    const btn = $("lang-toggle");
    if (!btn) return;
    const langs = (btn.dataset.langs || "en").split(",");
    let start = langs[0];
    try {
      const saved = localStorage.getItem("br-lang");
      if (saved && langs.indexOf(saved) >= 0) start = saved;
    } catch (_) { /* private mode */ }
    applyLang(start, langs);
    btn.addEventListener("click", () => {
      const to = btn.dataset.next || langs[0];
      window.track("lang", null, { to });
      applyLang(to, langs);
    });
  }

  // ── day / night ───────────────────────────────────────────────────────────────────
  //
  // The button is an icon, not a word: `#theme-toggle` is a 34px fixed circle in the
  // platform's stylesheet and a word does not fit in it. It shipped with the text "Night"
  // in it, which is why Temo saw "a small button that does nothing" - it was doing
  // something, into a box too small to show it.
  //
  // The icon shows what you will GET, not where you are: a sun while it is night.

  const SVG_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41' +
    'M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const SVG_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  // Scoped per restaurant. One phone can carry the menus of several restaurants on the
  // same origin, and a diner who wants Corner in daylight has not asked for that at
  // Monday Greens.
  function themeKey() {
    return "br-theme:" + (document.documentElement.dataset.tenant || "-");
  }

  function applyTheme(theme, persist) {
    const root = document.documentElement;
    const btn = $("theme-toggle");
    root.setAttribute("data-theme", theme);
    if (btn) {
      btn.innerHTML = theme === "night" ? SVG_SUN : SVG_MOON;
      const u = (window.UI && window.UI[window.__lang]) || (window.UI && window.UI.en) || {};
      btn.setAttribute("aria-label",
        theme === "night" ? (u.themeDay || "Day") : (u.themeNight || "Night"));
    }
    if (persist) {
      try { localStorage.setItem(themeKey(), theme); } catch (_) { /* private mode */ }
    }
  }

  function wireTheme() {
    const btn = $("theme-toggle");
    if (!btn) return;
    let stored = null;
    try {
      const v = localStorage.getItem(themeKey());
      if (v === "day" || v === "night") stored = v;
    } catch (_) { /* private mode */ }
    // The server already rendered the restaurant's own default into `data-theme`, so with
    // no stored choice this changes nothing and there is no flash.
    applyTheme(stored || document.documentElement.getAttribute("data-theme") || "night",
      false);
    btn.addEventListener("click", () => {
      const from = document.documentElement.getAttribute("data-theme");
      const to = from === "night" ? "day" : "night";
      window.track("theme_change", null, { from, to });
      applyTheme(to, true);
    });
  }

  window.applyFilter = applyFilter;
  window.applyLang = applyLang;
  window.applyTheme = applyTheme;

  function start() {
    // Asked once, out loud. A missing `platform.css` reproduces the original bug exactly -
    // pills highlight, nothing else moves - and without this there is nothing in the
    // console to find, which is how it went out twice.
    window.__hidingWorks = hidingWorks();
    wireCategories();
    wireLanguage();
    wireTheme();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

/* ---- init.js ---- */
// init.js — start the hero and venue features the way the platform starts them.
//
// `hero.js` is the platform's code, verbatim: the hero video, the hero-photo crossfade,
// the venue block (address, hours, map), the delivery and social links, and the featured
// strip. In their app all of it is kicked off from inside `applyRemoteTheme`, once
// theme_config has come back from Supabase.
//
// Our page has no theme_config to fetch - the server already resolved it - so this does
// the same kicking off from `window.__CFG`, which the page inlines. That object is the
// SETTINGS only: hero art, hours, links, fonts. A few hundred bytes, not the menu.
//
// The order is theirs and it matters: a configured video takes the band over and the
// photos become its poster, because two crossfades on one element is a flicker, not a
// feature.

(function () {
  "use strict";

  // Their sets, for the two templates that matter. Monday Greens takes the photo
  // gallery; elegant_black (Corner at Tabidze) does not, but does take the video.
  const HERO_GALLERY = new Set(["monday_greens", "burger_lions", "elegant_black"]);

  function start() {
    const cfg = window.__CFG || {};

    // **A diner opened the menu.** The first row of the funnel and the denominator of
    // every percentage under it.
    //
    // The platform fires this from inside `buildMenu`, which is the function that fetches
    // the dishes - and we deleted that function, because our dishes arrive in the HTML.
    // The event went with it and nobody noticed, so the analytics screen showed "Opened
    // the menu: 0" above "Got past the hero: 4" and "Placed it on a table: 1". A funnel
    // that widens as it goes is not a small reporting bug; it is the one screen a paying
    // restaurant looks at to decide whether any of this works, saying something obviously
    // untrue.
    //
    // First, before the hero and before the viewer, because it must survive a diner who
    // closes the tab immediately - which is itself a number worth having.
    try { window.track("view"); } catch (e) { /* never let a count break a menu */ }
    // hero.js and viewer.js both read the global config the platform sets.
    window._themeConfig = Object.assign(window._themeConfig || {}, cfg);

    try {
      if (typeof _applyVenueInfo === "function") _applyVenueInfo(cfg);
      if (typeof _applyVenueLinks === "function") _applyVenueLinks(cfg);
      if (typeof _applyVenueMap === "function") _applyVenueMap(cfg);
    } catch (e) { console.warn("venue block:", e); }

    const template = document.documentElement.dataset.template || "";
    let shots = [];
    try {
      shots = typeof _parseHeroImages === "function"
        ? _parseHeroImages(cfg.hero_images) : [];
    } catch (e) { shots = []; }
    if (!shots.length && cfg.hero_image_url) shots = [cfg.hero_image_url];

    let videoOn = false;
    try {
      // Deliberately never on the critical path: the band paints from the poster on the
      // first frame and the clip is attached on idle. Skipped entirely on Data Saver, on
      // 2G and under prefers-reduced-motion - their rules, kept.
      if (typeof _startHeroVideo === "function") videoOn = !!_startHeroVideo(cfg);
    } catch (e) { console.warn("hero video:", e); }

    try {
      if (!videoOn && HERO_GALLERY.has(template) && shots.length > 1
          && typeof _startHeroGallery === "function") {
        _startHeroGallery(shots);
      }
    } catch (e) { console.warn("hero gallery:", e); }

    // Per-tenant hero height, e.g. "56.25vw" for a full 16:9 band.
    if (cfg.hero_min_h) {
      document.documentElement.style.setProperty("--mg-hero-h", cfg.hero_min_h);
    }

    // 360-degree auto-spin in the 3D viewer. Off unless the owner turned it on.
    window.__spinEnabled = /^(1|true|on|yes)$/i.test(String(cfg.spin_enabled || "").trim());
    const spin = document.getElementById("modal-spin");
    if (spin && !window.__spinEnabled) spin.style.display = "none";

    // ── the 3D, last, and NOT optional ────────────────────────────────────────────
    //
    // `__bootViewer` reads the cards back into the item list the viewer works on, binds
    // the thumbnails, starts the poster-to-live-3D upgrades and warms the AR carousel.
    //
    // **Nothing called it.** It was defined in `shim.js` and invoked from nowhere, so on
    // every deployed page `menuItems` stayed `[]`: no thumbnail ever became a live model,
    // no AR model was ever preloaded, and every 3D and AR event was filed against item
    // index -1. The page looked complete, so it took a person on a phone to notice - the
    // same shape of failure as the stubs, and the reason `check_render.py` now asserts
    // that this call exists rather than only that the file does.
    //
    // Deferred to idle: it touches 175 cards and can wait until after the first paint,
    // which is the whole reason the menu is in the HTML.
    try {
      window.idle(function () { window.__bootViewer(); });
    } catch (e) {
      console.error("[betareal] the 3D viewer failed to boot", e);
    }
  }

  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
