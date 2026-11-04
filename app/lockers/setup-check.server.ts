// Whether the cart picker theme embed is switched on, read from the live
// storefront: the embed adds plp-cart.js to every page. Needs no theme scope.
// null when the storefront can't be read (password page, bot check, timeout).
export async function cartEmbedActive(shop: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://${shop}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Pastomatai setup check)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok || new URL(res.url).pathname.startsWith("/password")) return null;
    const html = await res.text();
    return html.includes("plp-cart.js");
  } catch {
    return null;
  }
}
