import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryCalendar } from "./history-calendar";

function isoDay(offsetFromToday = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetFromToday);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const state = vi.hoisted(() => ({
  month: { days: [] as { date: string; count: number; complete: boolean }[] },
  me: {
    id: "user-1",
    name: "Sabrina",
    email: "s@example.com",
    image: null,
    today: { date: "", count: 0, complete: false },
  },
  hangQueries: false,
}));

vi.mock("@/api-client/@tanstack/react-query.gen", () => ({
  getEntriesMonthOptions: () => ({
    queryKey: ["month"],
    queryFn: () => (state.hangQueries ? new Promise(() => {}) : Promise.resolve(state.month)),
  }),
  getMeOptions: () => ({
    queryKey: ["me"],
    queryFn: () => (state.hangQueries ? new Promise(() => {}) : Promise.resolve(state.me)),
  }),
  getEntriesOptions: () => ({
    queryKey: ["entries"],
    queryFn: () => (state.hangQueries ? new Promise(() => {}) : Promise.resolve({ date: "", entries: [] })),
  }),
}));

function renderHistory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HistoryCalendar />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.month = { days: [] };
  state.me = { ...state.me, today: { date: isoDay(0), count: 0, complete: false } };
  state.hangQueries = false;
});

describe("HistoryCalendar", () => {
  it("renders the header and a back link", async () => {
    renderHistory();

    expect(await screen.findByText("History")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to today" })).toHaveAttribute("href", "/");
  });

  it("renders the calendar once loaded", async () => {
    state.month = { days: [{ date: isoDay(0), count: 3, complete: true }] };
    renderHistory();

    expect(await screen.findByRole("grid")).toBeInTheDocument();
  });

  it("computes the streak and all-time total", async () => {
    state.month = {
      days: [
        { date: isoDay(0), count: 3, complete: true },
        { date: isoDay(-1), count: 3, complete: true },
        { date: isoDay(-2), count: 2, complete: false },
        { date: isoDay(-5), count: 1, complete: false },
      ],
    };
    renderHistory();

    await screen.findByRole("grid"); // wait for the data to arrive
    expect(screen.getByText(/day streak/).textContent).toBe("2 day streak");
    expect(screen.getByText(/nice things all-time/).textContent).toBe("9 nice things all-time");
  });

  it("does not break the streak when today is not logged yet", async () => {
    state.month = {
      days: [
        { date: isoDay(-1), count: 3, complete: true },
        { date: isoDay(-2), count: 3, complete: true },
      ],
    };
    renderHistory();
    await screen.findByRole("grid");

    expect(screen.getByText(/day streak/).textContent).toBe("2 day streak");
  });

  it("shows nothing streak-wise for empty history", async () => {
    renderHistory();
    await screen.findByRole("grid");

    expect(screen.getByText(/day streak/).textContent).toBe("0 day streak");
    expect(screen.getByText(/nice things all-time/).textContent).toBe("0 nice things all-time");
  });

  it("shows a skeleton while loading", () => {
    state.hangQueries = true;
    const { container } = renderHistory();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});
