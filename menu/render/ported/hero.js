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
