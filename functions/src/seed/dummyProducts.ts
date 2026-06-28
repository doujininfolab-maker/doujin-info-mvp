import { Timestamp } from "firebase-admin/firestore";
import type { Product, SellerDocument, Taxonomy } from "../types";
import { buildProductId, buildSearchTokens } from "../util";

const now = (): Timestamp => Timestamp.now();

const baseTitles = [
  "雨の日に聴く年上彼氏の甘やかしボイス",
  "悪役令嬢と契約騎士の秘密の夜",
  "カフェ店員は閉店後だけ優しい",
  "幼なじみ御曹司の溺愛同居生活",
  "眠れない夜の耳元カウンセリング",
  "狐の嫁入りと月夜の約束",
  "推し声優と同じ声の先輩に迫られる話",
  "冷徹上司の不器用な独占欲",
  "異世界薬師と癒やしの宿屋",
  "同棲彼氏の休日ごほうびプラン",
  "王子様は庶民派ヒロインに弱い",
  "雨宿りから始まる恋愛レッスン",
  "吸血鬼伯爵の甘い契約",
  "ASMR 添い寝図書館へようこそ",
  "年下ワンコ彼氏の全力看病",
];

const sellerNames = [
  "夜明けシロップ",
  "Melty Voice Works",
  "月灯り文庫",
  "シュガーリング",
  "耳元ラボ",
];

const genrePools = [
  { name: "TL", id: "dlsite:tl" },
  { name: "ASMR", id: "dlsite:asmr" },
  { name: "乙女向け", id: "dlsite:otome" },
  { name: "ボイス", id: "dlsite:voice" },
  { name: "恋愛", id: "common:romance" },
  { name: "ファンタジー", id: "common:fantasy" },
];

const tagPools = [
  { name: "甘々", id: "common:sweet" },
  { name: "溺愛", id: "common:dote" },
  { name: "年上", id: "common:older" },
  { name: "年下", id: "common:younger" },
  { name: "低音", id: "common:deep-voice" },
  { name: "添い寝", id: "common:sleeping-together" },
  { name: "異世界", id: "common:isekai" },
];

function pick<T>(values: T[], index: number, count: number): T[] {
  const result: T[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(values[(index + i) % values.length]);
  }
  return result;
}

export function buildDummyProducts(): Product[] {
  const timestamp = now();

  return baseTitles.map((title, index) => {
    const sourceProductId = `RJ0110${String(index + 1).padStart(4, "0")}`;
    const productId = buildProductId("dlsite", "doujin", sourceProductId);
    const selectedGenres = pick(genrePools, index, index % 3 === 0 ? 3 : 2);
    const selectedTags = pick(tagPools, index, 3);
    const sellerName = sellerNames[index % sellerNames.length];
    const sellerId = `dlsite_circle_${String((index % sellerNames.length) + 1).padStart(3, "0")}`;
    const originalPrice = 1320 + (index % 4) * 220;
    const discountRate = index % 3 === 0 ? 30 : index % 4 === 0 ? 20 : 0;
    const isDiscounted = discountRate > 0;
    const priceCurrent = isDiscounted ? Math.floor(originalPrice * (100 - discountRate) / 100) : originalPrice;
    const releaseDay = String(1 + (index % 27)).padStart(2, "0");
    const imageSeed = encodeURIComponent(sourceProductId);

    return {
      productId,
      sourceProductId,
      platform: "dlsite",
      audience: "female",
      category: "doujin",
      categories: ["doujin", "voice"],
      affiliateProvider: "dlsite",
      title,
      seller: {
        sellerId,
        sellerName,
        sellerType: "circle",
      },
      priceCurrent,
      priceOriginal: originalPrice,
      discountRate,
      isDiscounted,
      currency: "JPY",
      salesCount: 2000 + index * 487,
      wishlistCount: 120 + index * 31,
      rating: Math.round((4.1 + (index % 8) * 0.1) * 100) / 100,
      ratingAverage: Math.round((4.1 + (index % 8) * 0.1) * 100) / 100,
      reviewCount: 8 + index * 3,
      releaseDate: `2026-06-${releaseDay}`,
      ageRating: index % 5 === 0 ? "r18" : "all",
      isAdult: index % 5 === 0,
      workType: index % 2 === 0 ? "音声" : "同人誌",
      thumbnailUrl: `https://picsum.photos/seed/${imageSeed}-thumb/420/560`,
      mainImageUrl: `https://picsum.photos/seed/${imageSeed}-main/700/930`,
      images: [
        {
          url: `https://picsum.photos/seed/${imageSeed}-main/900/1200`,
          thumbnailUrl: `https://picsum.photos/seed/${imageSeed}-thumb/300/400`,
          type: "main",
          displayOrder: 0,
        },
        {
          url: `https://picsum.photos/seed/${imageSeed}-sample1/900/1200`,
          thumbnailUrl: `https://picsum.photos/seed/${imageSeed}-sample1-thumb/300/400`,
          type: "sample",
          displayOrder: 1,
        },
        {
          url: `https://picsum.photos/seed/${imageSeed}-sample2/900/1200`,
          thumbnailUrl: `https://picsum.photos/seed/${imageSeed}-sample2-thumb/300/400`,
          type: "sample",
          displayOrder: 2,
        },
      ],
      sourceUrl: `https://www.dlsite.com/girls/work/=/product_id/${sourceProductId}.html`,
      affiliateUrl: `https://www.dlsite.com/girls/work/=/product_id/${sourceProductId}.html?utm_source=mvp_affiliate_placeholder`,
      description: `${title}。MVP用の短い説明文です。実運用では公開ページから必要最低限の説明だけを保存します。`,
      genres: selectedGenres.map((genre) => genre.name),
      tags: selectedTags.map((tag) => tag.name),
      genreIds: selectedGenres.map((genre) => genre.id),
      tagIds: selectedTags.map((tag) => tag.id),
      searchTokens: buildSearchTokens([title, sellerName, ...selectedGenres.map((genre) => genre.name), ...selectedTags.map((tag) => tag.name)]),
      latestRankings: [
        {
          rankingKey: "dlsite_female_doujin_daily",
          type: "daily",
          rank: index + 1,
          capturedAt: timestamp,
        },
      ],
      isActive: true,
      fetchStatus: "success",
      lastFetchedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

export function buildDummyTaxonomies(products: Product[]): Taxonomy[] {
  const timestamp = now();
  const map = new Map<string, Taxonomy>();

  for (const product of products) {
    product.genreIds.forEach((genreId, index) => {
      const current = map.get(genreId);
      map.set(genreId, {
        taxonomyId: genreId,
        type: "genre",
        platform: product.platform,
        audience: product.audience,
        category: product.category,
        name: product.genres[index] ?? genreId,
        normalizedId: genreId,
        sourceId: genreId,
        sourceName: product.genres[index] ?? genreId,
        productCount: (current?.productCount ?? 0) + 1,
        isActive: true,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    });

    product.tagIds.forEach((tagId, index) => {
      const current = map.get(tagId);
      map.set(tagId, {
        taxonomyId: tagId,
        type: "tag",
        platform: product.platform,
        audience: product.audience,
        category: product.category,
        name: product.tags[index] ?? tagId,
        normalizedId: tagId,
        sourceId: tagId,
        sourceName: product.tags[index] ?? tagId,
        productCount: (current?.productCount ?? 0) + 1,
        isActive: true,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    });
  }

  return [...map.values()];
}

export function buildDummySellers(products: Product[]): SellerDocument[] {
  const timestamp = now();
  const map = new Map<string, SellerDocument>();

  for (const product of products) {
    if (!product.seller?.sellerId || !product.seller.sellerName) continue;

    const current = map.get(product.seller.sellerId);
    map.set(product.seller.sellerId, {
      sellerId: product.seller.sellerId,
      platform: product.platform,
      sellerType: product.seller.sellerType ?? "circle",
      sourceSellerId: product.seller.sellerId,
      name: product.seller.sellerName,
      sourceUrl: `https://www.dlsite.com/girls/circle/profile/=/maker_id/${product.seller.sellerId}.html`,
      affiliateUrl: `https://www.dlsite.com/girls/circle/profile/=/maker_id/${product.seller.sellerId}.html?utm_source=mvp_affiliate_placeholder`,
      productCount: (current?.productCount ?? 0) + 1,
      isActive: true,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }

  return [...map.values()];
}
