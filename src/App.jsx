import Hero from "./components/Hero.jsx";

const features = [
  {
    title: "Project workspace",
    description:
      "A clean starting point for building out the product experience.",
  },
  {
    title: "Frontend foundation",
    description:
      "Vite and React are set up with a small component structure ready to extend.",
  },
  {
    title: "Next milestone",
    description:
      "Add project-specific screens, flows, and data models as the proposal becomes implementation.",
  },
];

function App() {
  return (
    <main className="app-shell">
      <Hero />

      <section
        className="feature-grid"
        id="next-steps"
        aria-label="Project features"
      >
        {features.map((feature) => (
          <article className="feature-card" key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

export default App;
