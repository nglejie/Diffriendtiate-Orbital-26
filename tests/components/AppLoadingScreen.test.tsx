import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppLoadingScreen from "../../apps/client/src/shared/ui/AppLoadingScreen.tsx";

describe("AppLoadingScreen", () => {
  it("renders the mascot loading page with the default message", () => {
    render(<AppLoadingScreen />);

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Loading...")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(document.querySelector(".loading-mascot")).toHaveAttribute(
      "src",
      "/brand/mascot-drawing-loading.gif",
    );
  });

  it("can render inside an existing page landmark", () => {
    render(<AppLoadingScreen as="section" message="Preparing Your Study Space" />);

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Preparing Your Study Space")).toBeInTheDocument();
    expect(screen.getByText("Preparing Your Study Space")).toBeInTheDocument();
  });
});
