type BrandMatch = { id?: string; loaderData?: unknown } | undefined;

/** Shared by route metadata, on both SSR loads and client navigation. */
export function storefrontTitle(title: string, matches: readonly BrandMatch[]) {
  const shell = matches.find((match) => match?.id?.startsWith("routes/storefront/layout"));
  const data = shell?.loaderData as { brand?: { full: string } } | undefined;
  const brand = data?.brand?.full ?? "Covers by Mobile Zam Zam";
  return `${title} | ${brand}`;
}
