import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodayView } from "./today-view";

const state = vi.hoisted(() => ({
  me: {
    id: "user-1",
    name: "Sabrina",
    email: "s@example.com",
    image: null,
    today: { date: "2026-10-06", count: 0, complete: false },
  },
  entries: {
    date: "2026-10-06",
    entries: [] as { id: number; content: string; entryDate: string; createdAt: string }[],
    complete: false,
  },
  posts: [] as { body: { content: string } }[],
  deletes: [] as { path: { id: number } }[],
  failNextPost: false,
  failNextDelete: false,
  hangQueries: false,
}));

vi.mock("@/api-client/@tanstack/react-query.gen", () => ({
  getMeOptions: () => ({
    queryKey: ["me"],
    queryFn: () =>
      state.hangQueries ? new Promise(() => {}) : Promise.resolve(state.me),
  }),
  getMeQueryKey: () => ["me"],
  getEntriesOptions: () => ({
    queryKey: ["entries"],
    queryFn: () =>
      state.hangQueries ? new Promise(() => {}) : Promise.resolve(state.entries),
  }),
  getEntriesQueryKey: () => ["entries"],
  postEntriesMutation: () => ({
    mutationFn: (args: { body: { content: string } }) => {
      if (state.failNextPost) return Promise.reject(new Error("boom"));
      state.posts.push(args);
      return Promise.resolve({});
    },
  }),
  deleteEntriesIdMutation: () => ({
    mutationFn: (args: { path: { id: number } }) => {
      if (state.failNextDelete) return Promise.reject(new Error("boom"));
      state.deletes.push(args);
      return Promise.resolve(undefined);
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function entry(id: number, content: string) {
  return { id, content, entryDate: "2026-10-06", createdAt: "2026-10-06T12:00:00.000Z" };
}

function renderTodayView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TodayView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.posts = [];
  state.deletes = [];
  state.failNextPost = false;
  state.failNextDelete = false;
  state.hangQueries = false;
  state.entries = { date: "2026-10-06", entries: [], complete: false };
  state.me = { ...state.me, today: { date: "2026-10-06", count: 0, complete: false } };
});

describe("TodayView", () => {
  it("shows the empty state with a counter badge and input placeholder", async () => {
    renderTodayView();

    expect(await screen.findByPlaceholderText("Something nice you did for yourself today...")).toBeInTheDocument();
    expect(screen.getByText("0 / 3")).toBeInTheDocument();
    expect(
      screen.getByText("Log 3 more by 7:00 PM or the accountability bot will hear about it."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/All three logged/)).not.toBeInTheDocument();
  });

  it("submits the typed content and clears the input", async () => {
    const user = userEvent.setup();
    renderTodayView();

    const input = await screen.findByPlaceholderText("Something nice you did for yourself today...");
    await user.type(input, "Went for a run");
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(state.posts).toEqual([{ body: { content: "Went for a run" } }]));
    expect(input).toHaveValue("");
  });

  it("blocks whitespace-only submissions", async () => {
    const user = userEvent.setup();
    renderTodayView();

    const input = await screen.findByPlaceholderText("Something nice you did for yourself today...");
    await user.type(input, "   ");
    const submit = screen.getByRole("button", { name: "Log it" });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(state.posts).toEqual([]);
  });

  it("shows a toast when saving fails", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    state.failNextPost = true;
    renderTodayView();

    const input = await screen.findByPlaceholderText("Something nice you did for yourself today...");
    await user.type(input, "doomed entry");
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save that. Try again."));
  });

  it("shows the completion message instead of the form at three entries", async () => {
    state.entries = {
      date: "2026-10-06",
      entries: [entry(1, "one"), entry(2, "two"), entry(3, "three")],
      complete: true,
    };
    state.me = { ...state.me, today: { ...state.me.today, count: 3, complete: true } };
    renderTodayView();

    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByText(/All three logged/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log it" })).not.toBeInTheDocument();
    expect(screen.getByText("The bot will leave you alone today.")).toBeInTheDocument();
  });

  it("renders each entry with a delete button", async () => {
    state.entries = { date: "2026-10-06", entries: [entry(7, "read a book")], complete: false };
    renderTodayView();

    expect(await screen.findByText("read a book")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeInTheDocument();
  });

  it("deletes an entry by id", async () => {
    const user = userEvent.setup();
    state.entries = { date: "2026-10-06", entries: [entry(7, "read a book")], complete: false };
    renderTodayView();

    await user.click(await screen.findByRole("button", { name: "Delete entry" }));

    await waitFor(() => expect(state.deletes).toEqual([{ path: { id: 7 } }]));
  });

  it("shows a toast when deleting fails", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    state.failNextDelete = true;
    state.entries = { date: "2026-10-06", entries: [entry(7, "read a book")], complete: false };
    renderTodayView();

    await user.click(await screen.findByRole("button", { name: "Delete entry" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't delete that entry."));
  });

  it("shows skeletons while the queries load", () => {
    state.hangQueries = true;
    const { container } = renderTodayView();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Log it" })).not.toBeInTheDocument();
  });
});
