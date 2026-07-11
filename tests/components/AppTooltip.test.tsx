import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppTooltip from "../../apps/client/src/shared/ui/AppTooltip.tsx";

function mockRect(element: HTMLElement, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.bottom ?? 0,
      height: rect.height ?? 0,
      left: rect.left ?? 0,
      right: rect.right ?? 0,
      top: rect.top ?? 0,
      width: rect.width ?? 0,
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("AppTooltip", () => {
  it("renders a single shared tooltip from data-tooltip", async () => {
    render(
      <>
        <AppTooltip />
        <button data-tooltip="More Options" type="button">
          More
        </button>
      </>,
    );

    const button = screen.getByRole("button", { name: "More" });
    mockRect(button, { bottom: 120, height: 32, left: 140, right: 172, top: 88, width: 32 });

    fireEvent.pointerOver(button);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("More Options");
    expect(tooltip).toHaveClass("app-tooltip-floating--top");
    expect(tooltip.querySelector(".app-tooltip-floating__caret")).toBeInTheDocument();
  });

  it("uses collision-aware placement near the viewport edge", async () => {
    render(
      <>
        <AppTooltip />
        <button data-tooltip="Go To My Location" data-tooltip-placement="left" type="button">
          Locate
        </button>
      </>,
    );

    const button = screen.getByRole("button", { name: "Locate" });
    mockRect(button, { bottom: 90, height: 36, left: 8, right: 44, top: 54, width: 36 });

    fireEvent.pointerOver(button);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveClass("app-tooltip-floating--right");
  });

  it("suppresses native title while the custom tooltip is active", async () => {
    render(
      <>
        <AppTooltip />
        <button data-tooltip="Domain" title="Domain" type="button">
          Domain
        </button>
      </>,
    );

    const button = screen.getByRole("button", { name: "Domain" });
    mockRect(button, { bottom: 120, height: 32, left: 140, right: 172, top: 88, width: 32 });

    fireEvent.pointerOver(button);
    await screen.findByRole("tooltip");
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveAttribute("data-native-title", "Domain");

    fireEvent.pointerOut(button);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(button).toHaveAttribute("title", "Domain");
  });
});
