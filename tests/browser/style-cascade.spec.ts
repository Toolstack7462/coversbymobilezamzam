import { test, expect } from "@playwright/test";

/**
 * The page gradient survives the cascade, in a real browser.
 *
 * `tests/unit/css-shorthand-resets.test.ts` proves no shorthand sits below one
 * of its own longhands in the source. This proves the consequence: that the
 * browser actually paints the gradient `app.css` describes.
 *
 * Both are needed, and they fail for different reasons. The unit guard catches
 * the mistake as it is written, in any stylesheet, before anyone opens a page.
 * This one catches the same effect going missing for a reason the source scan
 * cannot see — a later rule overriding `body`, a token resolving to nothing, a
 * build that drops the declaration.
 *
 * It asserts the CATEGORY of value, never a colour. Which colours the gradient
 * runs between is a storefront theme decision and will change; that it is a
 * gradient at all is a cascade fact.
 */
test.describe("the page background", () => {
  test("paints the gradient rather than a flat fill", async ({ page }) => {
    await page.goto("/");

    const background = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        image: style.backgroundImage,
        color: style.backgroundColor,
        repeat: style.backgroundRepeat,
      };
    });

    // `none` is exactly what the shorthand reset produced, and it is what a
    // reader of the stylesheet would never expect to see.
    expect(background.image).not.toBe("none");
    expect(background.image).toContain("gradient");

    // The colour underneath it still has to be set: it is the base the gradient
    // sits on and the fallback anywhere the gradient cannot paint.
    expect(background.color).not.toBe("rgba(0, 0, 0, 0)");

    // Set beside the image and therefore just as easy to lose to a shorthand.
    expect(background.repeat).toBe("no-repeat");
  });
});
