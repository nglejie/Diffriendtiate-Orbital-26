type AppLoadingScreenProps = {
  as?: "main" | "section";
  message?: string;
};

export default function AppLoadingScreen({ as: Element = "main", message = "Loading..." }: AppLoadingScreenProps) {
  return (
    <Element className="loading-screen" aria-busy="true" aria-live="polite">
      <section className="loading-panel" aria-label={message}>
        <img
          className="loading-mascot"
          src="/brand/mascot-drawing-loading.gif"
          alt=""
          aria-hidden="true"
        />
        <p>{message}</p>
      </section>
    </Element>
  );
}
