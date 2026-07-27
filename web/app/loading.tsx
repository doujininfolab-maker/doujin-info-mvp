export default function LoadingPage() {
  return (
    <section className="routeLoading" aria-live="polite" aria-busy="true">
      <div className="routeLoading__header">
        <span className="routeLoading__eyebrow">LOADING</span>
        <div className="routeLoading__title" />
        <div className="routeLoading__text" />
      </div>
      <div className="routeLoading__grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="routeLoading__card" key={index}>
            <div className="routeLoading__image" />
            <div className="routeLoading__line routeLoading__line--wide" />
            <div className="routeLoading__line" />
            <div className="routeLoading__line routeLoading__line--short" />
          </div>
        ))}
      </div>
      <span className="srOnly">データを読み込んでいます。</span>
    </section>
  );
}
