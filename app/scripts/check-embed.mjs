// node --test scripts/check-embed.mjs
//
// The part of the embed that decides whether a paying restaurant's dish shows up - and the
// part nobody would notice breaking until a client did. No browser, no database: the
// decision is pure (lib/embed.js), so it is tested as one.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSite, hostAllowed, decide, frameAncestors, cameraOrbit, shapeDish, ownOrigins, DISH_ID,
} from "../src/lib/embed.js";

// public_dish()'s real answer for a demo-kitchen dish, captured from the database.
const DOC = {
  item: { id: "f9d6ba45-6fd9-4c04-9495-3139bb130369", i18n: { ka: { name: "სუში" } },
          name: "Sushi With Stone Plate", is_3d: true, currency: "GEL", photo_key: null,
          text_only: false, price_text: null, description: "lean capture", price_minor: 2150 },
  embed: { active: true, allowed_sites: [] },
  model: { ar_scale: 1.0, usdz_key: "catalog/x/lean/model.usdz",
           draco_key: "catalog/x/lean/model_draco.glb", poster_key: "models/x/model.png",
           view_orbit: null, external_glb: null, external_usdz: null },
  tenant: { id: "9f5465ff-5731-4b8d-9d85-fc0993869e6e", name: "Monday Greens",
            slug: "demo-kitchen", currency: "GEL", languages: ["en"] },
};
const dish = (over = {}) => {
  const d = shapeDish(DOC, "en");
  return { ...d, ...over, embed: { ...d.embed, ...(over.embed || {}) } };
};

test("sites normalise to bare hostnames", () => {
  assert.equal(normalizeSite("https://www.Restaurant-X.ge/menu?a=1"), "restaurant-x.ge");
  assert.equal(normalizeSite("restaurant-x.ge"), "restaurant-x.ge");
  assert.equal(normalizeSite("  shop.restaurant-x.ge:8443 "), "shop.restaurant-x.ge");
  assert.equal(normalizeSite("localhost"), "localhost");
  assert.equal(normalizeSite("*.evil.com"), "");
  assert.equal(normalizeSite("not a site"), "");
  assert.equal(normalizeSite(""), "");
});

test("an entry covers itself and its subdomains, nothing else", () => {
  const sites = ["restaurant-x.ge"];
  assert.ok(hostAllowed("restaurant-x.ge", sites));
  assert.ok(hostAllowed("www.restaurant-x.ge", sites));
  assert.ok(hostAllowed("order.restaurant-x.ge", sites));
  assert.ok(!hostAllowed("restaurant-x.ge.evil.com", sites));
  assert.ok(!hostAllowed("evilrestaurant-x.ge", sites));
  assert.ok(!hostAllowed("", sites));
});

test("public_dish becomes the page's shape", () => {
  const d = shapeDish(DOC, "en");
  assert.equal(d.glb, "/a/catalog/x/lean/model_draco.glb");
  assert.equal(d.usdz, "/a/catalog/x/lean/model.usdz");
  assert.equal(d.price, "21.50 ₾");
  assert.equal(d.has3d, true);
  assert.equal(shapeDish(DOC, "ka").name, "სუში");
  assert.equal(shapeDish({ ...DOC, model: null }, "en").has3d, false, "no approved model, no 3D");
  assert.equal(shapeDish({ ...DOC, item: { ...DOC.item, is_3d: false } }, "en").has3d, false);
  assert.equal(shapeDish({ ...DOC, item: { ...DOC.item, text_only: true } }, "en").has3d, false);
  assert.equal(shapeDish(null, "en"), null);
});

test("no list: the dish shows anywhere, framed or not", () => {
  assert.deepEqual(decide({ dish: dish(), dest: "iframe", refererHost: "anyone.com" }),
                   { mode: "full", restrict: null });
});

test("switched off: photo everywhere, including the link", () => {
  for (const dest of ["iframe", "document", ""]) {
    assert.equal(decide({ dish: dish({ embed: { active: false } }), dest }).mode, "photo");
  }
});

test("a dish with no 3D is a photo, whatever the settings", () => {
  assert.equal(decide({ dish: dish({ has3d: false }), dest: "iframe" }).mode, "photo");
});

test("with a list: allowed site gets 3D, restricted by frame-ancestors", () => {
  const d = dish({ embed: { sites: ["restaurant-x.ge"] } });
  assert.deepEqual(decide({ dish: d, dest: "iframe", refererHost: "www.restaurant-x.ge" }),
                   { mode: "full", restrict: ["restaurant-x.ge"] });
});

test("with a list: another site gets the photo, quietly - not a blank box", () => {
  const d = dish({ embed: { sites: ["restaurant-x.ge"] } });
  assert.deepEqual(decide({ dish: d, dest: "iframe", refererHost: "copycat.com" }),
                   { mode: "photo", restrict: null });
});

test("with a list: the LINK still works - it is our page, not an embed", () => {
  const d = dish({ embed: { sites: ["restaurant-x.ge"] } });
  // Opened from Instagram: Referer is instagram, but it is a top-level document.
  assert.equal(decide({ dish: d, dest: "document", refererHost: "l.instagram.com" }).mode, "full");
});

test("with a list: a stripped Referer falls back to the browser's frame-ancestors", () => {
  const d = dish({ embed: { sites: ["restaurant-x.ge"] } });
  assert.deepEqual(decide({ dish: d, dest: "iframe", refererHost: "" }),
                   { mode: "full", restrict: ["restaurant-x.ge"] });
});

test("with a list: our own admin preview may always frame it", () => {
  const d = dish({ embed: { sites: ["restaurant-x.ge"] } });
  const own = ownOrigins("https://admin.betareal.app, not a url ,http://localhost:3001");
  assert.deepEqual(own, ["https://admin.betareal.app", "http://localhost:3001"]);
  assert.equal(decide({ dish: d, dest: "iframe", refererHost: "admin.betareal.app", own }).mode, "full");
});

test("frame-ancestors names each site, its subdomains, both schemes, and us", () => {
  const v = frameAncestors(["restaurant-x.ge"], ["https://admin.betareal.app"]);
  assert.equal(v, "frame-ancestors 'self' https://restaurant-x.ge https://*.restaurant-x.ge " +
                  "http://restaurant-x.ge http://*.restaurant-x.ge https://admin.betareal.app");
});

test("camera orbit: three numbers, clamped like the menu", () => {
  assert.equal(cameraOrbit("0 30 105"), "0deg 30deg 105%");
  assert.equal(cameraOrbit("500 99 1000"), "360deg 85deg 300%");
  assert.equal(cameraOrbit("0 30"), "");
  assert.equal(cameraOrbit(null), "");
});

test("only uuids reach the database", () => {
  assert.ok(DISH_ID.test("f9d6ba45-6fd9-4c04-9495-3139bb130369"));
  assert.ok(!DISH_ID.test("1"));
  assert.ok(!DISH_ID.test("f9d6ba45-6fd9-4c04-9495-3139bb130369' or 1=1"));
});
