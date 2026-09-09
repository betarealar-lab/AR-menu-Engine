// What a diner sees when there is no menu to show them.
//
// This is a phone held over a QR code on a table, in a restaurant, usually with somebody
// waiting. It was two bare strings:
//
//     No menu for "cornerr"                    404, text/plain, English
//     Menu unavailable: <postgres error>       503, text/plain, English
//
// Three things wrong with that, in the order they matter.
//
// **It reflects on the restaurant, not on us.** The diner has no idea BetaReal exists.
// They scanned the code on their own table and got raw black text on white, which reads
// as "this restaurant's thing is broken" - and the one useful instruction, ask a member
// of staff, was not there.
//
// **It was English only**, in Tbilisi, on the surface with the widest audience in the
// whole product. Every other diner-facing string ships in both languages.
//
// **The 503 printed the exception.** `loadMenu` throws whatever the database said, so a
// permissions or connection failure would have shown an anonymous visitor a PostgREST
// error naming our tables. The detail belongs in the Worker's log, where we can read it,
// and nowhere near the page.
//
// Deliberately no branding, no logo, no link to us. A diner who cannot see a menu is not
// a sales opportunity, and putting our name on a restaurant's failure would be the one
// thing worse than the plain text.
//
// Inline styles, no stylesheet, no script: this page has to render when the thing that
// serves stylesheets may be the thing that is broken.

const SHELL = (title, lines) => `<!doctype html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         color: #2b2b2b; background: #fafafa; }
  main { padding: 32px 24px; text-align: center; max-width: 34ch }
  p { margin: 0 0 14px }
  p:last-child { margin: 0 }
  .en { color: #6b6b6b; font-size: 15px }
  @media (prefers-color-scheme: dark) {
    body { color: #ededed; background: #151515 }
    .en { color: #9a9a9a }
  }
</style>
</head>
<body><main>${lines}</main></body>
</html>`;

/** No restaurant answers to this address. Almost always a mistyped URL: the slug is set
 *  once when a restaurant is created and is never editable afterwards, so a printed QR
 *  cannot be orphaned by somebody renaming things. */
export function noMenu() {
  return new Response(
    SHELL("მენიუ ვერ მოიძებნა", `
    <p>ამ მისამართზე მენიუ ვერ მოიძებნა.</p>
    <p>გთხოვთ, კიდევ ერთხელ დაასკანიროთ მაგიდაზე არსებული კოდი.</p>
    <p class="en">There is no menu at this address. Please scan the code on your table again.</p>`),
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** The restaurant exists and we could not load it. Their problem to wait out, ours to
 *  fix - so the diner is pointed at a person, and the reason goes to the log. */
export function menuUnavailable(slug, err) {
  console.error(`menu ${slug} failed to load:`, err);
  return new Response(
    SHELL("მენიუ დროებით მიუწვდომელია", `
    <p>მენიუ დროებით მიუწვდომელია.</p>
    <p>გთხოვთ, სცადოთ ერთი წუთის შემდეგ ან მიმართოთ ოფიციანტს.</p>
    <p class="en">The menu is temporarily unavailable. Please try again in a moment, or ask a member of staff.</p>`),
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // A minute, so a phone that retries does not hammer a database that is already
        // struggling, and so a CDN never caches this in place of a working menu.
        "retry-after": "60",
        "cache-control": "no-store",
      },
    });
}
