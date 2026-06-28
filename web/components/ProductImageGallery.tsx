import type { ProductImage } from "@/lib/types";

export function ProductImageGallery({ title, images }: { title: string; images: ProductImage[] }) {
  const sortedImages = [...images].sort((a, b) => a.displayOrder - b.displayOrder);
  const mainImage = sortedImages[0];

  if (!mainImage) {
    return <img className="gallery__main" src="/no-image.svg" alt={title} />;
  }

  return (
    <div className="gallery">
      <img className="gallery__main" src={mainImage.url} alt={title} />
      {sortedImages.length > 1 ? (
        <div className="gallery__thumbs">
          {sortedImages.map((image) => (
            <a key={`${image.displayOrder}_${image.url}`} href={image.url} target="_blank" rel="noreferrer" className="gallery__thumbLink">
              <img className="gallery__thumb" src={image.thumbnailUrl || image.url} alt={`${title} サンプル${image.displayOrder + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
