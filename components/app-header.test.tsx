import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./app-header";

const state = vi.hoisted(() => ({
  session: { user: { name: "Sabrina", image: null as string | null } },
  isPending: false,
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: state.session, isPending: state.isPending }),
  signOut: vi.fn(),
}));

function renderHeader() {
  return render(<AppHeader />);
}

beforeEach(() => {
  state.session = { user: { name: "Sabrina", image: null } };
  state.isPending = false;
});

describe("AppHeader", () => {
  it("shows the app name", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "3 Nice Things" })).toHaveAttribute("href", "/");
  });

  it("shows the user's name and avatar fallback initial", () => {
    renderHeader();
    expect(screen.getByText("Sabrina")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("signs out when the button is clicked", async () => {
    const { signOut } = await import("@/lib/auth-client");
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("shows a skeleton while the session is loading", () => {
    state.isPending = true;
    const { container } = renderHeader();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("renders nothing when there is no session", () => {
    state.session = { user: null as never };
    renderHeader();

    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3 Nice Things" })).toBeInTheDocument();
  });
});
