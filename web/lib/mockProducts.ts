import type { Product } from "./types";

const titles = [
  "秘めた想いのその先で",
  "夜に溶けるキミの声",
  "雨上がりの約束",
  "ふたりの距離感",
  "優しい嘘のつき方",
  "その瞳に恋をして",
  "君と過ごす休日の午後",
  "秘密ごとアパートメント",
  "春風にのせて、君へ",
  "先輩、もう少しだけ甘えていいですか",
  "おやすみのキスを",
  "月明かりのメロディ",
];

const sellers = ["Luna Note", "TearDrop", "petit étoile", "Scent Note", "melty.", "moonlit", "はちみつカフェ", "夜明けラボ"];
const genres = [["DLsite", "ボーイズラブ"], ["DLsite", "音声作品"], ["DLsite", "シチュエーション"], ["DLsite", "漫画"], ["DLsite", "ノベル"], ["DLsite", "恋愛"]];
const images = ["/ui/product-01.svg", "/ui/product-02.svg", "/ui/product-03.svg", "/ui/product-04.svg", "/ui/product-05.svg", "/ui/product-06.svg"];

export const mockProducts: Product[] = Array.from({ length: 12 }).map((_, index) => {
  const priceOriginal = [1320, 990, 1540, 1100, 1430, 1980][index % 6];
  const discount = index % 3 === 2 ? 30 : index % 5 === 0 ? 20 : undefined;
  const priceCurrent = discount ? Math.round(priceOriginal * (100 - discount) / 100) : priceOriginal;
  const tags = genres[index % genres.length];
  return {
    productId: `mock_product_${index + 1}`,
    sourceProductId: `RJ_MOCK_${index + 1}`,
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    affiliateProvider: "dlsite",
    title: titles[index % titles.length],
    seller: { sellerName: sellers[index % sellers.length], sellerType: "circle" },
    priceCurrent,
    priceOriginal,
    discountRate: discount,
    isDiscounted: Boolean(discount),
    currency: "JPY",
    salesCount: 1320 + index * 913,
    rating: 4.1 + (index % 6) * 0.1,
    reviewCount: 12 + index * 5,
    isAdult: false,
    thumbnailUrl: images[index % images.length],
    mainImageUrl: images[index % images.length],
    images: [{ url: images[index % images.length], type: "main", displayOrder: 1 }],
    sourceUrl: "#",
    affiliateUrl: "#",
    genres: tags.slice(1),
    tags,
    genreIds: tags.map((tag) => `dlsite:${tag.toLowerCase()}`),
    tagIds: tags.map((tag) => `tag:${tag.toLowerCase()}`),
    isActive: true,
    fetchStatus: "success",
  } satisfies Product;
});

export function fillProducts(products: Product[], count = 8): Product[] {
  if (products.length >= count) return products.slice(0, count);
  const usedIds = new Set(products.map((product) => product.productId));
  const fallback = mockProducts.filter((product) => !usedIds.has(product.productId));
  return [...products, ...fallback].slice(0, count);
}
