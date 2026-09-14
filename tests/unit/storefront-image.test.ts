import { describe, expect, it } from "vitest";
import { saleableImageKey, editorialHeroKey, storePhotoKey } from "~/domain/media/storefront-image";
import { storefrontTitle } from "~/lib/storefront-meta";

describe("storefront media corrections", () => {
  it("rejects the three reported wrong photographs and legacy demo illustrations", () => {
    for (const key of [
      "products/mR3UqBUU9Ts-ed22cf12a1.webp",
      "products/UmlxLLbm9a4-ddf0380535.webp",
      "products/tYK_iGMdgwY-606231802e.webp",
      "demo/cover.png",
    ]) {
      expect(saleableImageKey(key)).toBeNull();
    }
  });
  it("accepts a replacement uploaded through the merchant media editor without a deploy", () => {
    expect(saleableImageKey("products/merchant-upload-new-hash.webp")).toBe(
      "products/merchant-upload-new-hash.webp",
    );
    expect(saleableImageKey(null)).toBeNull();
  });
  it("distinguishes the known city image from a replacement store image", () => {
    expect(storePhotoKey("lifestyle/WEer-k_jhE4-1b79f37377.webp")).toBeNull();
    expect(storePhotoKey("store/merchant-interior.webp")).toBe("store/merchant-interior.webp");
    expect(editorialHeroKey("lifestyle/4lrS2PuN_2g-91057cb6bb.webp")).toBeNull();
  });
});

describe("route title branding", () => {
  it("uses the current CMS identity and a meaningful page title", () => {
    expect(
      storefrontTitle("Carrello", [
        {
          id: "routes/storefront/layout",
          loaderData: { brand: { full: "Covers by Mobile Zam Zam" } },
        },
      ]),
    ).toBe("Carrello | Covers by Mobile Zam Zam");
  });
});
