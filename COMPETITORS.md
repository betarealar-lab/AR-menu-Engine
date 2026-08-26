# Competitor dossier — 3D / AR restaurant menus

Researched 2026-08-26. Every player found, one by one, with process, technology, pricing,
client counts, and **measured** technical data. Companion to [DECISIONS.md](DECISIONS.md).

---

## 1. The technical answer — measured live, not guessed

**Question: how do they show 25 3D models on one page?**

**They don't. They show zero.** Measured in a real browser on a live Menu AR client
(Pisco Express, a Peruvian-Chinese restaurant):

| Page | Dishes listed | `<model-viewer>` elements | Models loaded | Page weight |
|---|---|---|---|---|
| Restaurant landing | — | **0** | 0 | **327 KB** (10 images) |
| Menu list | **12** | **1** | **0** | **420 KB** |

**One model-viewer element for twelve dishes.** All twelve GLB URLs sit in the DOM as lazy
references. Nothing 3D downloads until a diner taps a dish, and then the single viewer's
`src` is swapped. The list itself is photographs.

### And their models are far bigger than ours

Five Menu AR models, fetched and measured:

```
6.12 MB   8.22 MB   8.23 MB   8.77 MB   9.56 MB      average ~8.2 MB
```

Against Monday Greens, Draco-compressed:

```
1.02 MB   1.16 MB   1.51 MB   1.97 MB   2.22 MB      average ~1.6 MB
```

> **Our models are 4–8× smaller than a competitor running unlimited dishes per venue.**

So the 5-item ceiling is not model weight and not production. It is **one architectural
choice**: live 3D thumbnails in the list. `_upgradeThumb()` instantiates a `model-viewer`
per card (staggered 150 ms through an IntersectionObserver). N dishes = N WebGL contexts,
and browsers hard-cap those around 8–16 while each one costs memory and main-thread time.
Everyone else renders photographs in the list and keeps exactly one viewer in reserve.

### We already own the fix

Two switches already exist in the codebase and are already in the database:

| Switch | Where | What it does |
|---|---|---|
| `thumb_3d` | `menu_items` column, defaults to **false** | `index.html` gates the live-3D upgrade on `item.thumb_3d \|\| !thumbnail_url`. Off = photo in the list, 3D badge and AR untouched |
| `featured_items` | `theme_config` JSON array | Pins a chosen set to the top — the existing "AR / 3D კერძები" block |

So the whole menu can be listed with photos while **five chosen dishes stay promoted in 3D**.
The scarcity play survives intact; the ceiling disappears. This is a data change, not a
rewrite.

*(Other demos measured: Triveo's demo menu renders 21 cards with 0 model-viewers and 0 models
— an empty shell, ~310 KB. MiARMenu's demo is dead, `ERR_CONNECTION_RESET`.)*

---

## 2. Master matrix

| # | Company | Country | Category | Method | Throughput | Pricing | **Named clients** | Model size | AR | Analytics |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **3DMenu.tech** | 🇮🇳 India | Manual | On-site shoot | **25/day · 75 in 3d · live in 21d** | not published | **10** | — | ❌ | ❌ |
| 2 | **JARIT** | 🇦🇲 Armenia | Manual | Photogrammetry on-site | — | $19 / $99 / $299 | 0 | — | ✅ | ✅ (Adv+) |
| 3 | **Menu AR** | 🇷🇺 Russia | Manual | In-house scanning | — | via regional partner | 1 verified (+16 reps) | **~8.2 MB** | ✅ | — |
| 4 | **3Dish** | 🇵🇹 Portugal | Manual | **Hardware in kitchen** | **35 sec/dish** | not published | 0 | — | — | — |
| 5 | **Reliefs** | 🇫🇷 France | Both | Self-scan + turnkey | 2–3 days/dish | €29 / €49 / €89 | 0 | — | ✅ | ✅ |
| 6 | **AR Dining** | 🇬🇧 UK | Manual | Scanning + NFC | — | not published | 0 | — | ✅ | — |
| 7 | **MiARMenu** | — | Manual | Menu + optional AR | — | on request | 0 (demo dead) | — | ✅ | ✅ |
| 8 | **QReal / KabaQ** | 🇺🇸 USA | Manual | Photo → cloud | — | — | **3** (~15 total) | — | ✅ | — |
| 9 | **ARmenu** | 🇬🇧 UK | **AI** | **Object Capture, remote** | **48 h** | £49 / £99 / £199 | 6 (⚠️ likely fake) | — | ✅ | ✅ |
| 10 | **Triveo** | — | **AI** | AI from uploaded photos | — | not published | 0 | — | ✅ | ✅ |
| 11 | **AR Code** | 🇫🇷 France | **AI** | Object Capture, iOS only | — | — | 0 | — | ✅ | — |
| 12 | **Diner** | 🇹🇷 Turkey | **AI** | Self-serve 3D | — | — | 0 | — | ✅ | — |
| 13 | **Foodo** | 🇬🇧🇦🇪 UK+UAE | Other | Bundled in a restaurant OS | — | not published | **15** | — | ✅ | ✅ |
| 14 | AI photo tools | 🌍 | Other | AI photo enhancement | instant | **$9–62/mo** | — | n/a | ❌ | ❌ |
| — | **BetaReal** | 🇬🇪 Georgia | Manual | Pro camera → KIRI → Blender | ~5/client | **₾300 / 5** | **1** | **~1.6 MB** | ✅ | ✅ |

**Georgia: no domestic 3D/AR menu competitor found**, in Georgian or English search.
"First in Georgia" holds literally — but see JARIT (Armenia) and Menu AR's unclaimed
Georgia franchise slot.

---

## 3. Category 1 — Manual scanning / photogrammetry

### 3DMenu.tech — Sutherland Technologies Pvt. Ltd., Pune, India

The most operationally credible player in the sweep.

- **Process:** on-site professional 3D photoshoot. Venue must supply shooting space and a
  shortlist of items.
- **Throughput:** *"aim to complete 25 items in a day"*; ~75 models in 3 days; shoot runs 1–3 days.
- **Turnaround:** *"deliver the live app before a maximum of 21 days after the 3D shoot."*
- **Tech:** undisclosed. Web app, QR at the table, no download.
- **Features:** 3D viewing only — **no AR anywhere on the site.** Ordering + admin tracking
  panel "coming soon". No languages, no analytics.
- **Pricing:** not published.
- **Contact:** akshay@3dmenu.tech · +91-9370267019 · 1486 Kasba Peth, Pune 411011.

**Clients — 10 named:** Asia Kitchen · Beirut Sea · Broadwalk by Flamboyant · Epitome ·
Firuzeh · Helen's Bakery · Just Kerala · Sante Spa · Veggie Delight · **Mainland China**
(major Indian chain).

**Read:** throughput comes from batching and cheap labour, not technology. They have no AR,
which is the one thing we do that they can't.

### JARIT — ARLOOPA Inc., Armenia ⚠️ neighbour

- **Process:** photogrammetry. *"We visit your location, capture your dishes and turn them
  into 3D models."*
- **Team, branded as kitchen roles:** Arman Atoyan (Head Cook), Lucine Yeghunyan (Design
  Cook), Artyom Arshakyan (AR Cook), David Najaryan (Web Cook).
- **Delivery:** native mobile app + AR.

| Plan | Price | Items | Includes |
|---|---|---|---|
| Basic | $19/mo | 1 | — |
| Advanced | $99/mo | 10 | Analytics |
| Pro | $299/mo | 50 | Custom marker, analytics, dedicated support |
| Enterprise | custom | 10 | White-label app |

All minimum 3 months. **Clients: none named** — every counter on the site reads "100", which
is an animation placeholder, not data.

**Read:** the closest competitor geographically and the one a Georgian prospect could
plausibly find. $99 for 10 items undercuts us at nearly half the price for double the dishes.

### Menu AR — menuar.world, Russia, operating since 2017 ⚠️ different GTM entirely

Not SaaS. A **franchise network of exclusive regional representatives.**

> *"You get the opportunity to become the exclusive representative of the application in your region."*

**Named reps in 16+ territories:** Moscow (Anton Nenahov) · Belarus (Baranov Kirill) · Greece
(Loukas Voskakis) · Dominican Republic (María Paredes) · Mexico (Alvaro Peon) · Austria
(Reinhard Francan) · Nigeria (Samuel Egomhan) · Croatia (Milan Gostimir) · Denmark + Sweden
(Thomas Christensen) · Brazil (Paulo Hartmann) · France (Stéphane Cléret) · Aruba / Curaçao /
Bonaire (Hector Marcelo Mercado) · Sicily (Fabio Pizzurro).

- Free native app (iOS + Android) **plus** WebAR by QR/link
- **22 languages**, auto-detected from the device
- Restaurant catalogue with map, filterable by city and country
- Personal account, remote updates, POS integration
- Also sells into shoes, museum exhibits, "any sphere"
- **Verified live client:** Pisco Express (Peruvian-Chinese). No count published.
- **Measured:** ~8.2 MB models, one lazy viewer, 420 KB menu page

**Read:** the only player with genuine international reach, and it came from a partner
network rather than a sales team. **Georgia is unclaimed on their map** — a threat, and a
template for a team with no capital.

### 3Dish — Portugal (Arrifana)

> *"Our scanner is delivered right to your kitchen."* Place the dish, **press the button,
> ~35 seconds.** *"Anyone on your team can do it."*

- Outputs 3D models **and** professional photographs
- No training or photography skill required
- No pricing, no clients, no case studies. PT/EN.

**Read:** solves capture consistency with physics instead of user skill — fixed lighting,
angles and distance. The industry's hard cases (reflective sauces, melted cheese, white
plates) are handled by the rig, not the operator. Worth considering for the human-serve tier.

### Reliefs — France

| Plan | Price | Active dishes | 3D views | Overage |
|---|---|---|---|---|
| Starter | €29/mo | 15 | 1,500 | €5 / 1,000 |
| Pro | €49/mo | 50 | 5,000 | €3 / 1,000 |
| Business | €89/mo | 100 | 15,000 | €1.50 / 1,000 |

- **Meters 3D VIEWS, not dishes.** Scanning unlimited and free; consumption billed
- Self-scan from mobile; scan / archive / reactivate with no extra fee
- Turnkey on-site scanning with pro equipment = separate custom quote
- Their own site says **2–3 days per dish** for a high-quality model
- Annual = 3 months free. **Clients: none named**
- **Site has 403'd every path since ~March 2026**, including their customer menu host. Dormant

**Read:** the smartest pricing model in the category. Steal the metered-views idea.

### AR Dining — UK (Hassan Shahzad)

3D scanning, curated menus, **personalised NFC beacons**, AR menu, real-time database for
items/prices/3D. contact@ar-dining.co.uk · UK +44 791 800 632 · US +1 317 556 4574.
No pricing, **no clients**, footer © 2025. Small operation.

### MiARMenu

Digital menu with optional AR, video + 3D. Multi-language, allergy filters, multi-location,
POS + payment integration, consented lead capture, live reports (scan counts, location data,
popular items). **"Restaurants We Work With" section is empty. Demo subdomain is dead.**
Pricing on request. WordPress site.

### QReal / KabaQ — USA, Turkish founders, since 2016

- Photo-based capture "within minutes", processed on their cloud into AR-optimised 3D
- **Clients: Denny's, Bareburger, Magnolia Bakery** — ~15 restaurants total by 2019
- **Exited food entirely** → fashion, luxury, automotive, Vision Pro retail
- ⚠️ An SEO blog claims "800+ restaurants" and "20–26% AOV uplift." Contradicts every primary
  source and their own pivot. **Fabricated.**

---

## 4. Category 2 — AI image-to-3D

### ARmenu — UK ⭐ the model worth copying

**The intake process, step by step** (this is the part that matters):

1. **The restaurant photographs its own dishes.** 20–30 photos per dish, walking around it.
   No app, no portal, no training, no appointment.
2. **They send them by email or WhatsApp.** That is the entire interface.
3. **ARmenu runs Apple Object Capture** — photogrammetry — over the batch.
4. **Outputs USDZ (iOS Quick Look) + GLB (Android/web).**
5. **Hosted on a global CDN**, print-ready QR code delivered back.
6. **48-hour turnaround.** First dish free.

| Plan | Price | Dishes | Locations |
|---|---|---|---|
| Starter | £49/mo | 5 | 1 |
| Growth | £99/mo | 20 | 3 |
| Pro | **£199/mo** | **Unlimited** | Unlimited |

No setup fee, no contract. iOS 12+ / Android 8+, 99.9% uptime.

**Why it scales:** no travel, no scheduling, no photographer, no per-venue hardware. Marginal
cost per dish is compute plus a few minutes of QA. That is what makes "unlimited at £199"
possible — and it is why they can serve a restaurant in another country as easily as one down
the road.

**What it costs them:** output quality is bounded by whatever an untrained person shoots, with
no feedback loop. That gap is precisely what our capture protocol and fault tags exist to close.

⚠️ Claims "200+ restaurants", "2.4× average order uplift", "2,847 scans in a week". The client
list reads as synthetic — one venue per major city with generic owner names (The Ember Room NY
/ Botanica Bistro London / Soleil Brasserie LA / Craft & Culture SF / The Stone Kitchen Chicago
/ Riverside Group). **Treat the numbers as unverified; the process and pricing are real.**

### Triveo ⭐ building exactly what we are

- **Restaurant uploads its own photos** from multiple angles through a dashboard
- *"Our team uses AI-powered software to turn your photos into 3D models"* — human-in-the-loop
- QR digital menu, **AR dining**, website embed, **analytics dashboard**
- **AI food recommendation chatbot** — guest chats to find a dish by budget, taste, health needs
- 30-day free trial, no credit card
- **Pricing section is empty in source. No clients, no uplift data, no case studies.** © 2026
- **Measured:** demo menu renders 21 cards with **0 model-viewers and 0 models** — a shell

**Read:** brand new, no traction, and the same product thesis as ours. Confirms the idea is
not defensible; only execution and distribution are.

### AR Code — France

Apple Object Capture; LiDAR when present, else cloud photogrammetry.
**iPhone / iPad / Mac M-series only.** Self-scan app + AR QR generation. No clients published.

### Diner — Turkey, 2019

TÜBİTAK 1512 BiGG deep-tech grant. Goal: restaurants create their own 3D content with no
professional help. **Raised ~$810K total at a $750K valuation** (2020). Silent since.

---

## 5. Category 3 — Others

### 5a. AI food photography ⚠️ the budget substitute

| Tool | Price |
|---|---|
| **FoodShot AI** | ~$9/mo (25 img) · $45/mo (100) · $59/mo annual (250) → **$0.36–0.60/image** |
| **MenuPhotoAI** | **$27–62/month**, credits never expire |
| FoodPhoto.ai · FoodyFocus · Photoroom · MenuCapture | comparable |
| **DoorDash** | **Native, free** — AI enhances lighting, resolution, framing, plating |
| **Uber Eats** | **Native, free** — AI photo enhancement, 2025 Merchant Impact Report |

Sold on **"professional photos → 24–35% more orders."** Not 3D, same budget, same job.

### 5b. Restaurant OS with AR bundled

**Foodo** — London (85 Great Portland St) + Dubai (Sultan Business Center, Oud Metha).
POS + handheld ordering, AR menus, custom websites, AI social media, table booking, digital
gift cards, AI SEO, commission-free delivery app (Motus).

**15 named partners:** ASMA · Café Begum · Ora Lounge · La Turka · VU Lounge · Bangkok 7 Thai
· Bavette Steak House · Nur Cafe · Madd · The Tiffin Box · Antonietta · Yalla Beirut · Bruncho
· Istanbul Restaurant · Hey Farina. All metrics masked ("0+", "$0 GMV", "0% revenue lift").

**Read: structurally the most dangerous model here.** AR is a bundled feature, so it never has
to justify its own price — and the venue is locked in through POS and ordering.

### 5c. No-code AR platforms and agencies

Kivicube (browser AR menu builder) · Onirix (WebAR, restaurant template) · echo3D (3D asset
CMS) · Quytech (dev agency) · Visuosofts (UK agency) · ConvertInAR · menuar.in / mymenuar.com
(India, JS-only site) · HoloMenu, Dine AR (SEO listicle only — **no primary source, unverified**)

### 5d. Engines (tools, not competitors)

Meshy · Tripo · Hunyuan3D · TRELLIS · Rodin · Hitem3D.
**Nobody in categories 1–2 discloses their engine** except ARmenu and AR Code, both Apple
Object Capture.

### 5e. Scanning hardware

botspot (industrial rigs, publishes food-for-virtual-menu guidance) · Revopoint · Pix-Pro.
Known hard cases: reflective sauces, melted cheese, white plates.

---

## 6. Client counts, ranked

| Company | Named | Claimed | Verified |
|---|---|---|---|
| **Foodo** | **15** | masked | 15 logos on site |
| **3DMenu.tech** | **10** | — | 10 named |
| ARmenu | 6 | "200+" | ⚠️ names look synthetic |
| QReal / KabaQ | 3 | ~15 (2019) | Denny's, Bareburger, Magnolia Bakery — **exited** |
| Menu AR | 0 | — | 1 found live (Pisco Express) + 16 territory reps |
| **BetaReal** | **1** | — | Monday Greens |
| JARIT · Reliefs · 3Dish · Triveo · AR Code · AR Dining · MiARMenu · Diner | **0** | — | none |

**Ten of fourteen publish nothing.** In a nine-year-old category, that silence is the loudest
signal available.

---

## 7. What this changes

1. **Lift the 5-item ceiling this week.** Set `thumb_3d = false` on non-featured items and keep
   `featured_items` for the 3D block. Whole menu listed with photos, five dishes promoted in 3D.
   The scarcity play survives; the ceiling goes. **Database change, no new code.**
2. **Then rebuild the pricing ladder.** 5 / 20 / unlimited, like everyone else. At ₾300 for
   5 dishes we are the most expensive product per dish in the category by 2–20×, and that only
   held while the ceiling was real.
3. **Copy ARmenu's intake.** Venue WhatsApps photos, we process, 48 hours back. No travel.
   The Scan Studio already does steps 3–5; what's missing is a venue-facing capture sheet and
   the habit.
4. **Our model sizes are a genuine, measurable advantage.** 1.6 MB average against 8.2 MB.
   Faster loads on Georgian mobile, and it is a fact we can demonstrate rather than assert.
5. **Have the answer ready for "can you do our whole menu?"** — it is coming in the next three
   meetings.
6. **Drop "first in Georgia."** True domestically, but JARIT is one country over and Menu AR
   franchises territories. Use "the team behind Monday Greens" instead.
7. **Look hard at the Menu AR franchise model.** A regional-rep network is a real GTM for a
   small team with no capital, and it is the only approach in this category that produced
   genuine international reach.
