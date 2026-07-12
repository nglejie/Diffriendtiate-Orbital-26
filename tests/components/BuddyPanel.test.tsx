import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BuddyPanel } from "../../apps/client/src/features/room/BuddyPanel.tsx";

const user = {
  id: "usr_buddy",
  name: "Buddy Tester",
};

function renderBuddyPanel(providerOptions, overrides = {}) {
  const onAskBuddy = overrides.onAskBuddy || vi.fn(async (_messages, _attachments, handlers) => {
    handlers.onToken?.("Mock");
    handlers.onToken?.(" OpenAI answer");
    handlers.onAnswer?.("Mock OpenAI answer");
    handlers.onChain?.([
      { role: "user", content: "Explain BYOK." },
      { role: "assistant", content: "Mock OpenAI answer" },
    ]);
  });
  const onError = overrides.onError || vi.fn();
  const onNotify = overrides.onNotify || vi.fn();
  const onUploadFiles = overrides.onUploadFiles || vi.fn(async () => []);

  function Harness() {
    const [messages, setMessages] = useState(overrides.initialMessages || []);

    return (
      <BuddyPanel
        isDraftThread
        messages={messages}
        onAskBuddy={onAskBuddy}
        onEnsureThread={vi.fn()}
        onError={onError}
        onMessagesChange={(updater) =>
          setMessages((current) => (typeof updater === "function" ? updater(current) : updater))
        }
        onNotify={onNotify}
        onPersistMessages={async (nextMessages) => setMessages(nextMessages)}
        onSelectedProviderIdChange={overrides.onSelectedProviderIdChange}
        onSyncResources={vi.fn()}
        onUploadFiles={onUploadFiles}
        providerOptions={providerOptions}
        resources={overrides.resources || []}
        selectedProviderId={overrides.selectedProviderId}
        syncingResources={false}
        threadId="buddy-thread"
        threadTitle="New Chat"
        user={user}
      />
    );
  }

  const rendered = render(<Harness />);
  return { ...rendered, onAskBuddy, onError, onNotify, onUploadFiles };
}

describe("BuddyPanel provider selection", () => {
  it("passes the @ picker provider per message and shows a model response header", async () => {
    const { onAskBuddy } = renderBuddyPanel([
      {
        id: "intelligrate",
        providerId: "intelligrate",
        providerName: "Intelligrate",
        label: "Intelligrate",
        model: "gemini-3.5-flash",
        builtIn: true,
        available: true,
      },
      {
        id: "llmkey_openai",
        providerId: "openai",
        providerName: "OpenAI",
        label: "Project OpenAI",
        model: "openai/gpt-4o-mini",
        builtIn: false,
        available: true,
      },
    ]);
    const tester = userEvent.setup();

    await tester.click(screen.getByRole("button", { name: "Choose Model: Intelligrate" }));
    expect(screen.getByRole("option", { name: "Use Intelligrate" })).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI | gpt-4o-mini")).not.toBeInTheDocument();
    await tester.click(screen.getByRole("option", { name: "Use Project OpenAI" }));
    await tester.type(screen.getByPlaceholderText("Ask anything"), "Explain BYOK.");
    await tester.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onAskBuddy).toHaveBeenCalled());
    expect(onAskBuddy.mock.calls[0][2].provider).toMatchObject({
      providerKeyId: "llmkey_openai",
      providerId: "openai",
      providerName: "OpenAI",
      model: "openai/gpt-4o-mini",
    });
    expect(await screen.findByText("Mock OpenAI answer")).toBeInTheDocument();
    expect(screen.getAllByText("Project OpenAI").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Choose Model: Project OpenAI" })).toBeInTheDocument();
    expect(screen.queryByText("OpenAI | gpt-4o-mini")).not.toBeInTheDocument();
  });

  it("opens the model picker when @ is typed into the composer", async () => {
    renderBuddyPanel([
      {
        id: "intelligrate",
        providerId: "intelligrate",
        providerName: "Intelligrate",
        label: "Intelligrate",
        model: "gemini-3.5-flash",
        builtIn: true,
        available: true,
      },
      {
        id: "llmkey_openai",
        providerId: "openai",
        providerName: "OpenAI",
        label: "Project OpenAI",
        model: "openai/gpt-4o-mini",
        builtIn: false,
        available: true,
      },
    ]);
    const tester = userEvent.setup();
    const composer = screen.getByPlaceholderText("Ask anything");

    await tester.type(composer, "@");
    expect(await screen.findByRole("dialog", { name: "Choose Intelligrate model" })).toBeInTheDocument();

    await tester.click(screen.getByRole("option", { name: "Use Project OpenAI" }));
    expect(screen.getByRole("button", { name: "Choose Model: Project OpenAI" })).toBeInTheDocument();
    expect(composer).toHaveValue("");
  });

  it("keeps the selected model when the chat panel remounts", async () => {
    const providerOptions = [
      {
        id: "intelligrate",
        providerId: "intelligrate",
        providerName: "Intelligrate",
        label: "Intelligrate",
        model: "gemini-3.5-flash",
        builtIn: true,
        available: true,
      },
      {
        id: "llmkey_openai",
        providerId: "openai",
        providerName: "OpenAI",
        label: "Project OpenAI",
        model: "openai/gpt-4o-mini",
        builtIn: false,
        available: true,
      },
    ];

    function PersistentHarness() {
      const [messages, setMessages] = useState([]);
      const [selectedProviderId, setSelectedProviderId] = useState("intelligrate");
      const [visible, setVisible] = useState(true);

      return (
        <>
          <button type="button" onClick={() => setVisible((current) => !current)}>
            {visible ? "Hide panel" : "Show panel"}
          </button>
          {visible ? (
            <BuddyPanel
              isDraftThread
              messages={messages}
              onAskBuddy={vi.fn()}
              onEnsureThread={vi.fn()}
              onError={vi.fn()}
              onMessagesChange={(updater) =>
                setMessages((current) => (typeof updater === "function" ? updater(current) : updater))
              }
              onNotify={vi.fn()}
              onPersistMessages={async (nextMessages) => setMessages(nextMessages)}
              onSelectedProviderIdChange={setSelectedProviderId}
              onSyncResources={vi.fn()}
              onUploadFiles={vi.fn(async () => [])}
              providerOptions={providerOptions}
              resources={[]}
              selectedProviderId={selectedProviderId}
              syncingResources={false}
              threadId="buddy-thread"
              threadTitle="New Chat"
              user={user}
            />
          ) : null}
        </>
      );
    }

    render(<PersistentHarness />);
    const tester = userEvent.setup();

    await tester.click(screen.getByRole("button", { name: "Choose Model: Intelligrate" }));
    await tester.click(screen.getByRole("option", { name: "Use Project OpenAI" }));
    expect(screen.getByRole("button", { name: "Choose Model: Project OpenAI" })).toBeInTheDocument();

    await tester.click(screen.getByRole("button", { name: "Hide panel" }));
    await tester.click(screen.getByRole("button", { name: "Show panel" }));

    expect(screen.getByRole("button", { name: "Choose Model: Project OpenAI" })).toBeInTheDocument();
  });

  it("submits the provider shown in the selector even before parent state catches up", async () => {
    const onAskBuddy = vi.fn(async (_messages, _attachments, handlers) => {
      handlers.onAnswer?.("Built-in response");
    });
    renderBuddyPanel(
      [
        {
          id: "intelligrate",
          providerId: "intelligrate",
          providerName: "Intelligrate",
          label: "Intelligrate",
          model: "gemini-3.5-flash",
          builtIn: true,
          available: true,
        },
        {
          id: "llmkey_gemini",
          providerId: "gemini",
          providerName: "Gemini",
          label: "Gemini",
          model: "gemini-flash-lite-latest",
          builtIn: false,
          available: true,
        },
      ],
      {
        onAskBuddy,
        onSelectedProviderIdChange: vi.fn(),
        selectedProviderId: "llmkey_gemini",
      },
    );
    const tester = userEvent.setup();

    expect(screen.getByRole("button", { name: "Choose Model: Gemini" })).toBeInTheDocument();
    await tester.click(screen.getByRole("button", { name: "Choose Model: Gemini" }));
    await tester.click(screen.getByRole("option", { name: "Use Intelligrate" }));
    expect(screen.getByRole("button", { name: "Choose Model: Intelligrate" })).toBeInTheDocument();

    await tester.type(screen.getByPlaceholderText("Ask anything"), "Use the built-in model.");
    await tester.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onAskBuddy).toHaveBeenCalled());
    expect(onAskBuddy.mock.calls[0][2].provider).toMatchObject({
      providerKeyId: "intelligrate",
      providerId: "intelligrate",
      providerName: "Intelligrate",
    });
  });

  it("does not render standalone punctuation artifacts in model answers", async () => {
    renderBuddyPanel(
      [
        {
          id: "intelligrate",
          providerId: "intelligrate",
          providerName: "Intelligrate",
          label: "Intelligrate",
          model: "gemini-3.5-flash",
          builtIn: true,
          available: true,
        },
      ],
      {
        onAskBuddy: vi.fn(async (_messages, _attachments, handlers) => {
          const answer = "First useful paragraph.\n\n.\n\nSecond useful paragraph.";
          handlers.onAnswer?.(answer);
          handlers.onChain?.([
            { role: "user", content: "Clean the answer." },
            { role: "assistant", content: answer },
          ]);
        }),
      },
    );
    const tester = userEvent.setup();

    await tester.type(screen.getByPlaceholderText("Ask anything"), "Clean the answer.");
    await tester.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("First useful paragraph.")).toBeInTheDocument();
    expect(await screen.findByText("Second useful paragraph.")).toBeInTheDocument();
    expect(screen.queryByText(".")).not.toBeInTheDocument();
  });

  it("keeps resource source pills and tool progress visible for grounded answers", async () => {
    renderBuddyPanel(
      [
        {
          id: "intelligrate",
          providerId: "intelligrate",
          providerName: "Intelligrate",
          label: "Intelligrate",
          model: "gemini-3.5-flash",
          builtIn: true,
          available: true,
        },
      ],
      {
        initialMessages: [
          {
            id: "assistant-grounded",
            role: "assistant",
            providerName: "Intelligrate",
            providerLabel: "Intelligrate",
            model: "gemini-3.5-flash",
            body: "From Static1Hazard.pdf: add the consensus term to remove the hazard.",
            sources: [],
            thinkingSteps: [
              {
                id: "search-static",
                type: "tool",
                tool: "search_corpus",
                status: "done",
                text: "Found 1 relevant room source: Static1Hazard.pdf",
              },
            ],
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        ],
        resources: [
          {
            id: "res_static",
            originalName: "Static1Hazard.pdf",
            storageName: "upload-static.pdf",
            title: "Static1Hazard.pdf",
            url: "/api/resources/res_static/file",
          },
        ],
      },
    );

    expect(screen.getByText("Intelligrate has finished processing your request")).toBeInTheDocument();
    expect(screen.getByText("Found 1 relevant room source: Static1Hazard.pdf")).toBeInTheDocument();
    const sourceLink = screen.getByRole("link", { name: /Static1Hazard\.pdf/i });
    expect(sourceLink).toHaveAttribute("href", expect.stringContaining("/api/resources/res_static/file"));
  });

  it("moves provider-leaked tool-call JSON into the progress timeline", async () => {
    const leakedToolAnswer = [
      "I need to inspect the Domain resources first.",
      "",
      '{ "action": "search_corpus", "action_input": { "query": "Orbital" } }',
      "",
      "Orbital is described in the uploaded notes.",
    ].join("\n");

    renderBuddyPanel(
      [
        {
          id: "llmkey_gemini",
          providerId: "gemini",
          providerName: "Gemini",
          label: "Gemini",
          model: "gemini-flash-lite-latest",
          builtIn: false,
          available: true,
        },
      ],
      {
        onAskBuddy: vi.fn(async (_messages, _attachments, handlers) => {
          handlers.onToken?.(leakedToolAnswer);
          handlers.onAnswer?.(leakedToolAnswer);
          handlers.onChain?.([
            { role: "user", content: "What is Orbital?" },
            { role: "assistant", content: leakedToolAnswer },
          ]);
        }),
      },
    );
    const tester = userEvent.setup();

    await tester.type(screen.getByPlaceholderText("Ask anything"), "What is Orbital?");
    await tester.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("I need to inspect the Domain resources first.")).toBeInTheDocument();
    expect(await screen.findByText('Searching room resources for "Orbital"')).toBeInTheDocument();
    expect(await screen.findByText("Orbital is described in the uploaded notes.")).toBeInTheDocument();
    expect(screen.queryByText(/"action":\s*"search_corpus"/)).not.toBeInTheDocument();
  });

  it("keeps the selected model for the next prompt until the member changes it", async () => {
    const { onAskBuddy } = renderBuddyPanel([
      {
        id: "intelligrate",
        providerId: "intelligrate",
        providerName: "Intelligrate",
        label: "Intelligrate",
        model: "gemini-3.5-flash",
        builtIn: true,
        available: true,
      },
      {
        id: "llmkey_openai",
        providerId: "openai",
        providerName: "OpenAI",
        label: "Project OpenAI",
        model: "openai/gpt-4o-mini",
        builtIn: false,
        available: true,
      },
    ]);
    const tester = userEvent.setup();

    await tester.click(screen.getByRole("button", { name: "Choose Model: Intelligrate" }));
    await tester.click(screen.getByRole("option", { name: "Use Project OpenAI" }));
    await tester.type(screen.getByPlaceholderText("Ask anything"), "First prompt");
    await tester.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onAskBuddy).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: "Choose Model: Project OpenAI" })).toBeInTheDocument();
    await tester.type(screen.getByPlaceholderText("Ask anything"), "Second prompt");
    await tester.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onAskBuddy).toHaveBeenCalledTimes(2));
    expect(onAskBuddy.mock.calls[1][2].provider.providerKeyId).toBe("llmkey_openai");
  });

  it("opens the native file input directly and filters unsupported attachment formats", async () => {
    const onNotify = vi.fn();
    const onUploadFiles = vi.fn(async () => []);
    const { container } = renderBuddyPanel(
      [
        {
          id: "intelligrate",
          providerId: "intelligrate",
          providerName: "Intelligrate",
          label: "Intelligrate",
          model: "gemini-3.5-flash",
          builtIn: true,
          available: true,
        },
      ],
      { onNotify, onUploadFiles },
    );
    const tester = userEvent.setup();
    const input = container.querySelector('input[type="file"]');

    expect(input).toBeInstanceOf(HTMLInputElement);
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected the Intelligrate file input to render.");
    expect(input).toHaveAttribute("accept", expect.stringContaining(".pdf"));
    expect(input).toHaveAttribute("accept", expect.stringContaining(".docx"));
    expect(input).toHaveAttribute("accept", expect.stringContaining(".pptx"));

    fireEvent.change(input, {
      target: {
        files: [
          new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
          new File(["slides"], "deck.pptx", {
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          }),
          new File(["image"], "diagram.png", { type: "image/png" }),
        ],
      },
    });
    await tester.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onUploadFiles).toHaveBeenCalled());
    expect(onUploadFiles.mock.calls[0][0].map((file) => file.name)).toEqual([
      "brief.pdf",
      "deck.pptx",
    ]);
    expect(onNotify).toHaveBeenCalledWith(
      "Intelligrate attachments currently support PDF, DOCX, and PPTX files.",
    );
  });
});
